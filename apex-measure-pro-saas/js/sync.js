/*
 * sync.js — ApexSync: local-first team sync.
 *
 *   core     pure helpers (hashProject, decide, conflict naming, queue) — unit tested
 *   engine   createEngine({ backend, store, ... }) — the sync cycle, testable against
 *            ApexBackend.createMock() with an in-memory store
 *   runtime  a thin hook-up (ApexExt.onBoot / onProjectSaved, online/visibility events),
 *            active ONLY when ApexPlans.has("team") and a backend session exist
 *
 * IndexedDB stays the source of truth. A remote change is never allowed to overwrite a local
 * edit silently: when a job was edited on two devices the NEWER edit stays as the job and the
 * older one is kept as a visible copy named "<name> (conflict <date>)".
 * Local deletes are NOT propagated (there is no delete hook, and an automatic "delete for the
 * whole crew" is too dangerous); a job deleted here stays deleted here unless a teammate edits it.
 *
 * UNTESTED against a live Supabase project — see backend.js.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ApexSync = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  var STATE_KEY = "sync.state";
  var PHOTO_BATCH = 6;
  var PHOTO_RETRY_MS = 10 * 60000;

  function clone(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }
  function defaultUid() {
    if (root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID();
    return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function dateStr(ms) {
    var d = new Date(ms);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  // ====================================================================================
  // core (pure)
  // ====================================================================================

  function canon(x) {
    if (x === null || typeof x !== "object") return JSON.stringify(x === undefined ? null : x);
    if (Array.isArray(x)) return "[" + x.map(canon).join(",") + "]";
    return "{" + Object.keys(x).sort().map(function (k) {
      return x[k] === undefined ? "" : JSON.stringify(k) + ":" + canon(x[k]);
    }).filter(Boolean).join(",") + "}";
  }
  function fnv(str, seed) {
    var h = seed >>> 0;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h;
  }
  // 64-bit content hash of a project, ignoring the sync-owned top-level `updatedAt`.
  function hashProject(p) {
    var c = clone(p) || {};
    delete c.updatedAt;
    var s = canon(c);
    return ("00000000" + fnv(s, 2166136261).toString(16)).slice(-8) + ("00000000" + fnv(s, 3266489917).toString(16)).slice(-8);
  }

  function conflictName(name, ms) {
    var base = String(name || "").replace(/\s*\(conflict [^)]*\)\s*$/, "") || "Job";
    return base + " (conflict " + dateStr(ms) + ")";
  }
  // A copy that is safe to store next to the original: new id, visibly labelled, no sync stamp.
  function makeConflictCopy(p, newId, ms) {
    var c = clone(p);
    delete c.updatedAt;
    c.id = newId;
    c.name = conflictName(p.name || p.client, ms);
    if (p.client) c.client = conflictName(p.client, ms);   // the home list shows client, so label it too
    return c;
  }

  function remoteTime(rec) {
    var u = rec && rec.project && rec.project.updatedAt;
    if (typeof u === "number" && isFinite(u)) return u;
    var t = Date.parse(rec && rec.rev);
    return isFinite(t) ? t : 0;
  }

  // Which side wins a true conflict: the newer edit; an exact tie is broken by hash so BOTH
  // devices pick the same winner.
  function remoteWins(localMs, rec, lh, rh) {
    var rt = remoteTime(rec);
    if (rt !== localMs) return rt > localMs;
    return rh > lh;
  }

  /*
   * decide(local, rec, meta, o) → { action }
   *   local  project|null    rec  { project, rev, deleted }    meta  { rev, hash }|undefined
   *   o.localMs  time of the last local change (ms)
   * actions: none | skip | same | adopt | push | orphan | push-over | conflict-remote-wins | conflict-local-wins
   */
  function decide(local, rec, meta, o) {
    o = o || {};
    if (!local) {
      if (rec.deleted) return { action: "skip" };
      if (meta && meta.rev === rec.rev) return { action: "skip" };   // deleted here, unchanged there
      return { action: "adopt" };
    }
    var lh = hashProject(local);
    if (rec.deleted) {
      if (meta && lh === meta.hash) return { action: "orphan" };     // unchanged here: keep it, stop tracking
      return { action: "push-over" };                                // edited here: our edit restores it
    }
    var rh = hashProject(rec.project || {});
    if (lh === rh) return { action: "same" };
    if (!meta) return { action: remoteWins(o.localMs || 0, rec, lh, rh) ? "conflict-remote-wins" : "conflict-local-wins" };
    var localChanged = lh !== meta.hash, remoteChanged = rec.rev !== meta.rev;
    if (!remoteChanged) return { action: localChanged ? "push" : "none" };
    if (!localChanged) return { action: "adopt" };
    return { action: remoteWins(o.localMs || 0, rec, lh, rh) ? "conflict-remote-wins" : "conflict-local-wins" };
  }

  function emptyState(orgId) {
    // joinedAt: only jobs CREATED after joining this org auto-upload; shared: ids the user explicitly shared.
    return { v: 1, orgId: orgId || null, since: "", projects: {}, lu: {}, queue: [], photosUp: {}, photoMiss: {},
      remotePending: {}, lastSyncedAt: null, joinedAt: null, shared: {} };
  }
  function enqueue(queue, id, at) {
    for (var i = 0; i < queue.length; i++) if (queue[i].id === id) return queue;
    queue.push({ id: id, tries: 0, next: at || 0 });
    return queue;
  }
  // May this local job be uploaded to the current org without the user asking?
  //  - already tracked under this org (it came from, or was already pushed to, this team), or
  //  - explicitly shared, or
  //  - created after joining this org.
  // Jobs from before joining (another team's, or never synced) are NEVER auto-uploaded.
  function eligible(state, p) {
    if (state.projects[p.id] || state.shared[p.id]) return true;
    return state.joinedAt !== null && (p.createdAt || 0) >= state.joinedAt;
  }
  function backoffMs(tries) { return Math.min(5 * 60000, 2000 * Math.pow(2, tries)); }
  function photoRefs(p) {
    var out = [];
    ((p && p.rooms) || []).forEach(function (r) {
      (r.windows || []).forEach(function (w) {
        (w.photos || []).forEach(function (id, i) { out.push({ id: id, windowId: w.id, room: r, win: w, index: i }); });
      });
    });
    return out;
  }

  function series(items, fn) {
    var p = Promise.resolve();
    items.forEach(function (it) { p = p.then(function () { return fn(it); }); });
    return p;
  }

  // ====================================================================================
  // engine
  // ====================================================================================
  /*
   * o.backend   ApexBackend-shaped object
   * o.store     { listProjects()→[project], getProject(id)→project|null, saveProject(p),
   *               getPhoto(id)→rec|undefined, putPhoto(rec), getKV(k), setKV(k,v) }
   * o.enabled() → bool   (plan + session gate)        o.isOpen(id) → bool (job being edited)
   * o.accept(project) → bool  (can this app version read it?)
   */
  function createEngine(o) {
    var backend = o.backend, store = o.store;
    var now = o.now || function () { return Date.now(); };
    var uid = o.uid || defaultUid;
    var enabled = o.enabled || function () { return true; };
    var isOpen = o.isOpen || function () { return false; };
    var accept = o.accept || function () { return true; };
    var setT = o.setTimeout || (root.setTimeout ? root.setTimeout.bind(root) : null);
    var clearT = o.clearTimeout || (root.clearTimeout ? root.clearTimeout.bind(root) : null);
    var debounceMs = o.debounceMs === undefined ? 2500 : o.debounceMs;

    var state = null, loading = null, running = null, again = false, force = false;
    var timer = null, retryTimer = null, listeners = [];
    var canPush = true, photoBacklog = 0;
    var status = { state: "off", pending: 0, lastSyncedAt: null, error: null, readOnly: false };

    function emit() {
      listeners.slice().forEach(function (fn) { try { fn(api.status()); } catch (e) { /* listener bug */ } });
    }
    function setStatus(patch) {
      Object.keys(patch).forEach(function (k) { status[k] = patch[k]; });
      status.pending = (state ? state.queue.length : 0) + photoBacklog;
      status.lastSyncedAt = state ? state.lastSyncedAt : null;
      emit();
    }
    function ensureLoaded() {
      if (state) return Promise.resolve(state);
      if (!loading) {
        loading = Promise.resolve().then(function () { return store.getKV(STATE_KEY); }).then(function (s) {
          state = s && s.v === 1 ? s : emptyState(null);
          ["projects", "lu", "photosUp", "photoMiss", "remotePending", "shared"].forEach(function (k) { state[k] = state[k] || {}; });
          state.queue = state.queue || [];
          return state;
        }, function () { state = emptyState(null); return state; });
      }
      return loading;
    }
    function save() { return Promise.resolve(store.setKV(STATE_KEY, state)).catch(function () { /* kv unavailable */ }); }
    function schedule(ms) {
      if (!setT) return;
      if (timer && clearT) clearT(timer);
      timer = setT(function () { timer = null; api.syncNow(false); }, ms);
    }
    function scheduleRetry(ms) {
      if (!setT || retryTimer) return;
      retryTimer = setT(function () { retryTimer = null; api.syncNow(false); }, ms);
    }
    function luFor(id, h) {
      var e = state.lu[id];
      if (e && e.h === h) return e.at;
      state.lu[id] = { h: h, at: now() };
      return state.lu[id].at;
    }
    function drop(id) { state.queue = state.queue.filter(function (q) { return q.id !== id; }); }
    function bump(op) {
      op.tries++;
      op.next = now() + backoffMs(op.tries);
    }
    function isHard(e) { return e && (e.code === "offline" || e.code === "unauthorized"); }

    // --- conflict copies (photos duplicated under new ids so deleting one never harms the other)
    function saveCopy(p) {
      var copy = makeConflictCopy(p, uid(), now());
      return series(photoRefs(copy), function (ref) {
        return Promise.resolve(store.getPhoto(ref.id)).then(function (rec) {
          if (!rec) return;
          var nid = uid();
          return store.putPhoto({ id: nid, projectId: copy.id, windowId: rec.windowId, blob: rec.blob, size: rec.size })
            .then(function () { ref.win.photos[ref.index] = nid; });
        });
      }).then(function () { return store.saveProject(copy); }).then(function () {
        state.shared[copy.id] = true;   // a conflict copy belongs to the team job it came from
        enqueue(state.queue, copy.id, 0);
        return copy;
      });
    }

    // --- apply one remote record
    function applyRemote(rec) {
      return store.getProject(rec.id).then(function (local) {
        var meta = state.projects[rec.id];
        var h = local ? hashProject(local) : null;
        var d = decide(local, rec, meta, { localMs: local ? luFor(rec.id, h) : 0 });
        var a = d.action;
        if (local && (a === "adopt" || a.indexOf("conflict") === 0) && safe(isOpen, rec.id)) {
          state.remotePending[rec.id] = rec;       // user is editing this job right now: apply later
          return { deferred: true };
        }
        delete state.remotePending[rec.id];
        if ((a === "adopt" || a === "conflict-remote-wins") && !safe(accept, rec.project)) {
          state.unreadable = (state.unreadable || 0) + 1;
          return { skipped: true };
        }
        function adopt() {
          var p = clone(rec.project);
          return store.saveProject(p).then(function () {
            var nh = hashProject(p);
            state.projects[rec.id] = { rev: rec.rev, hash: nh };
            state.lu[rec.id] = { h: nh, at: remoteTime(rec) };
          });
        }
        switch (a) {
          case "skip": case "none": return {};
          case "same":
            state.projects[rec.id] = { rev: rec.rev, hash: h };
            return {};
          case "adopt": return adopt();
          case "orphan":
            state.projects[rec.id] = { rev: rec.rev, hash: h };
            return {};
          case "push": enqueue(state.queue, rec.id, 0); return {};
          case "push-over":
            state.projects[rec.id] = { rev: rec.rev, hash: meta ? meta.hash : null };
            enqueue(state.queue, rec.id, 0);
            return {};
          case "conflict-remote-wins":
            return saveCopy(local).then(adopt).then(function () { state.conflicts = (state.conflicts || 0) + 1; return { conflict: true }; });
          case "conflict-local-wins":
            return saveCopy(rec.project).then(function () {
              state.projects[rec.id] = { rev: rec.rev, hash: meta ? meta.hash : null };   // base = their version
              enqueue(state.queue, rec.id, 0);
              state.conflicts = (state.conflicts || 0) + 1;
              return { conflict: true };
            });
        }
        return {};
      });
    }
    function safe(fn, arg) { try { return fn(arg); } catch (e) { return false; } }

    // --- pull
    function pull() {
      var pending = Object.keys(state.remotePending).map(function (k) { return state.remotePending[k]; });
      // Re-read a 30 s overlap so a row committed just behind the cursor is never missed;
      // decide() ignores records we already have (same rev).
      var t = state.since ? Date.parse(state.since) : NaN;
      var from = isFinite(t) ? new Date(t - 30000).toISOString() : state.since;
      return backend.pullProjects(from).then(function (recs) {
        var byId = {};
        pending.concat(recs).forEach(function (r) { if (!byId[r.id] || r.rev >= byId[r.id].rev) byId[r.id] = r; });
        var maxRev = state.since;
        recs.forEach(function (r) { if (r.rev > maxRev) maxRev = r.rev; });
        return series(Object.keys(byId), function (id) { return applyRemote(byId[id]); }).then(function () {
          state.since = maxRev;
        });
      });
    }

    // --- push
    function pushOne(op, depth) {
      return store.getProject(op.id).then(function (local) {
        if (!local) { drop(op.id); return; }
        var meta = state.projects[op.id], h = hashProject(local);
        if (meta && meta.hash === h) { drop(op.id); return; }
        if (!eligible(state, local)) { drop(op.id); return; }
        var data = clone(local);
        data.updatedAt = luFor(op.id, h);
        return backend.pushProject(data, meta && meta.rev ? { baseRev: meta.rev } : {}).then(function (r) {
          state.projects[op.id] = { rev: r.rev, hash: h };
          drop(op.id);
          state.lastSyncedAt = now();
        }, function (e) {
          if (isHard(e)) throw e;
          if (e.code === "conflict" && depth < 2) {
            return backend.getProject(op.id).then(function (rec) {
              if (!rec) { delete state.projects[op.id]; return pushOne(op, depth + 1); }   // row gone: send as new
              return applyRemote(rec).then(function (res) {
                if (res && res.deferred) { bump(op); return; }
                return pushOne(op, depth + 1);
              });
            });
          }
          if (e.code === "forbidden") {
            drop(op.id);
            canPush = false;
            setStatus({ readOnly: true });
            return;
          }
          bump(op);
          status.error = e.message || "Sync problem";
        });
      });
    }
    function pushAll() {
      return store.listProjects().then(function (list) {
        list.forEach(function (p) {
          var meta = state.projects[p.id];
          if (!eligible(state, p)) return;
          if (!meta || meta.hash !== hashProject(p)) enqueue(state.queue, p.id, 0);
        });
        return series(state.queue.slice(), function (op) {
          if (!force && op.next > now()) return;
          return pushOne(op, 0);
        });
      });
    }

    // --- photos (lazy, a few per cycle)
    function photos() {
      var up = 0, down = 0;
      photoBacklog = 0;
      return store.listProjects().then(function (list) {
        return series(list, function (p) {
          if (!state.projects[p.id]) return;                 // only jobs that are shared
          return series(photoRefs(p), function (ref) {
            return Promise.resolve(store.getPhoto(ref.id)).then(function (rec) {
              if (rec) {
                if (state.photosUp[ref.id] || !canPush) return;
                if (up >= PHOTO_BATCH) { photoBacklog++; return; }
                up++;
                return backend.putPhoto(p.id, ref.id, rec.blob).then(function () { state.photosUp[ref.id] = true; }, function (e) {
                  if (isHard(e)) throw e;
                  if (e.code === "forbidden") canPush = false;
                  photoBacklog++;
                });
              }
              var miss = state.photoMiss[ref.id];
              if (miss && now() - miss < PHOTO_RETRY_MS) return;
              if (down >= PHOTO_BATCH) { photoBacklog++; return; }
              down++;
              return backend.getPhoto(p.id, ref.id).then(function (blob) {
                if (!blob) { state.photoMiss[ref.id] = now(); return; }
                delete state.photoMiss[ref.id];
                return store.putPhoto({ id: ref.id, projectId: p.id, windowId: ref.windowId, blob: blob, size: blob.size })
                  .then(function () { state.photosUp[ref.id] = true; });
              }, function (e) {
                if (isHard(e)) throw e;
                photoBacklog++;
              });
            });
          });
        });
      });
    }

    function cycle() {
      setStatus({ state: "syncing", error: null });
      return backend.getEntitlement().then(function (ent) {
        var cpe = ent.currentPeriodEnd ? Date.parse(ent.currentPeriodEnd) : NaN;
        var teamOk = ent.plan === "crew" && (ent.status === "active" || ent.status === "trialing" ||
          (ent.status === "past_due" && (!isFinite(cpe) || cpe + 7 * 86400000 > now())));
        if (!teamOk || !ent.orgId) {
          setStatus({ state: "off", error: null });
          return "off";
        }
        if (state.orgId !== ent.orgId) {   // different team (or first run): forget the old team's bookkeeping
          var keepQueue = [];
          state = emptyState(ent.orgId);
          state.queue = keepQueue;
          state.joinedAt = now();   // jobs older than this are NOT auto-shared with the new team
        }
        canPush = ent.role !== "viewer";
        status.readOnly = !canPush;
        return pull().then(function () {
          if (!canPush) { state.queue = []; return; }
          return pushAll();
        }).then(photos).then(function () {
          state.lastSyncedAt = now();
          return save().then(function () {
            var hasBackoff = state.queue.length > 0;
            setStatus({ state: "idle", error: status.error && hasBackoff ? status.error : null });
            if (hasBackoff) scheduleRetry(30000);
            if (photoBacklog > 0) scheduleRetry(1500);
            return "ok";
          });
        });
      });
    }

    function fail(e) {
      var code = e && e.code;
      return save().then(function () {
        if (code === "offline") { setStatus({ state: "offline", error: null }); scheduleRetry(60000); }
        else if (code === "unauthorized") setStatus({ state: "error", error: "Signed out. Sign in again to keep syncing." });
        else if (code === "not-configured") setStatus({ state: "off", error: null });
        else { setStatus({ state: "error", error: (e && e.message) || "Sync problem" }); scheduleRetry(60000); }
      });
    }

    var api = {
      core: null,
      status: function () { return { state: status.state, pending: status.pending, lastSyncedAt: status.lastSyncedAt, error: status.error, readOnly: status.readOnly,
        conflicts: state ? state.conflicts || 0 : 0, unreadable: state ? state.unreadable || 0 : 0 }; },
      onChange: function (fn) {
        listeners.push(fn);
        return function () { var i = listeners.indexOf(fn); if (i !== -1) listeners.splice(i, 1); };
      },
      // Call after every local save. Cheap: hashes, queues, debounces.
      localSaved: function (project) {
        if (!project || !project.id || !safe(enabled)) return Promise.resolve();
        return ensureLoaded().then(function () {
          var h = hashProject(project), meta = state.projects[project.id];
          if (meta && meta.hash === h) return;
          luFor(project.id, h);
          if (canPush && eligible(state, project)) enqueue(state.queue, project.id, 0);
          setStatus({});
          return save().then(function () { schedule(debounceMs); });
        }).catch(function () { /* never throw out of a hook */ });
      },
      syncNow: function (forceRetry) {
        if (!safe(enabled)) { setStatus({ state: "off", error: null }); return Promise.resolve(api.status()); }
        if (forceRetry !== false) force = true;
        if (running) { again = true; return running; }
        running = ensureLoaded().then(cycle).then(function () {}, fail).then(function () {
          running = null; force = false;
          if (again) { again = false; return api.syncNow(false); }
          return api.status();
        });
        return running;
      },
      // Start over from the server's copy (restores jobs deleted on this device).
      fullResync: function () {
        return ensureLoaded().then(function () {
          var org = state.orgId;
          var q = state.queue;
          var joined = state.joinedAt, shared = state.shared;
          state = emptyState(org);
          state.queue = q;
          state.joinedAt = joined;
          state.shared = shared;
          return save();
        }).then(function () { return api.syncNow(true); });
      },
      // Jobs on this phone that will NOT upload on their own (older than joining this team).
      unsharedJobs: function () {
        return ensureLoaded().then(function () { return store.listProjects(); }).then(function (list) {
          return list.filter(function (p) { return !eligible(state, p); }).map(function (p) { return p.id; });
        });
      },
      // Explicit opt-in: upload these existing jobs (all unshared ones when ids is omitted).
      shareJobs: function (ids) {
        return api.unsharedJobs().then(function (all) {
          var pick = ids ? all.filter(function (id) { return ids.indexOf(id) !== -1; }) : all;
          pick.forEach(function (id) { state.shared[id] = true; enqueue(state.queue, id, 0); });
          return save().then(function () { setStatus({}); return api.syncNow(true); }).then(function () { return pick.length; });
        });
      },
      // Mark a shared job as removed for the team (soft delete on the server).
      unshare: function (id) { return backend.deleteProject(id); },
      _state: function () { return state; }
    };
    return api;
  }

  // ====================================================================================
  // runtime (browser only)
  // ====================================================================================

  var core = {
    hashProject: hashProject, decide: decide, conflictName: conflictName, makeConflictCopy: makeConflictCopy,
    emptyState: emptyState, eligible: eligible, enqueue: enqueue, backoffMs: backoffMs, photoRefs: photoRefs, remoteTime: remoteTime
  };
  var runtime = null;

  function plansHasTeam() {
    try { return Boolean(root.ApexPlans && typeof root.ApexPlans.has === "function" && root.ApexPlans.has("team")); }
    catch (e) { return false; }
  }
  function runtimeEnabled() {
    try {
      var B = root.ApexBackend;
      return plansHasTeam() && Boolean(B && B.configured && B.configured() && B.session && B.session());
    } catch (e) { return false; }
  }

  function storeAdapter(S) {
    return {
      listProjects: function () {
        return S.listProjects().then(function (rows) {
          return rows.filter(function (r) { return r.ok; }).map(function (r) { return r.project; });
        });
      },
      getProject: function (id) { return S.getProject(id).then(function (r) { return r && r.ok ? r.project : null; }); },
      saveProject: function (p) { return S.saveProject(p); },
      getPhoto: function (id) { return S.getPhoto(id); },
      putPhoto: function (rec) { return S.putPhoto(rec); },
      getKV: function (k) { return S.getKV(k); },
      setKV: function (k, v) { return S.setKV(k, v); }
    };
  }

  function lateBound() {
    var out = {};
    ["getEntitlement", "pushProject", "pullProjects", "getProject", "deleteProject", "putPhoto", "getPhoto"].forEach(function (m) {
      out[m] = function () { return root.ApexBackend[m].apply(root.ApexBackend, arguments); };
    });
    return out;
  }

  function startRuntime() {
    var X = root.ApexExt, S = root.ApexStore;
    if (!X || !S || !root.document) return;
    var engine = createEngine({
      backend: lateBound(),   // late-bound: the backend may be swapped (mock) after load
      store: storeAdapter(S),
      enabled: runtimeEnabled,
      isOpen: function (id) {
        var c = X.ctx, app = c && c.app;
        return Boolean(app && app.project && app.project.id === id && /^#\/p\//.test(root.location ? root.location.hash : ""));
      },
      accept: function (p) { var r = S.loadRecord(p); return r && r.ok; }
    });
    runtime = engine;
    api.engine = engine;
    var lastKick = 0;
    function kick(why) {
      var t = Date.now();
      if (why !== "force" && t - lastKick < 15000) return;
      lastKick = t;
      engine.syncNow(false);
    }
    X.onBoot.push(function () { kick("boot"); });
    X.onProjectSaved.push(function (project) { engine.localSaved(project); });
    try {
      root.addEventListener("online", function () { kick("force"); });
      root.addEventListener("hashchange", function () {   // leaving an open job → apply deferred remote changes
        if (!/^#\/p\//.test(root.location.hash) && engine._state() && Object.keys(engine._state().remotePending).length) kick("force");
      });
      root.document.addEventListener("visibilitychange", function () { if (root.document.visibilityState === "visible") kick("visible"); });
      root.setInterval(function () { if (root.document.visibilityState === "visible") kick("tick"); }, 90000);
      if (root.ApexBackend && root.ApexBackend.onAuthChange) root.ApexBackend.onAuthChange(function () { kick("force"); });
    } catch (e) { /* non-browser */ }
  }

  var api = {
    core: core,
    createEngine: createEngine,
    hashProject: hashProject, decide: decide, conflictName: conflictName, makeConflictCopy: makeConflictCopy,
    engine: null,
    enabled: runtimeEnabled,
    status: function () { return runtime ? runtime.status() : { state: "off", pending: 0, lastSyncedAt: null }; },
    onChange: function (fn) { return runtime ? runtime.onChange(fn) : function () {}; },
    syncNow: function () { return runtime ? runtime.syncNow(true) : Promise.resolve(api.status()); },
    fullResync: function () { return runtime ? runtime.fullResync() : Promise.resolve(api.status()); },
    unshare: function (id) { return runtime ? runtime.unshare(id) : Promise.reject(new Error("sync is off")); },
    unsharedJobs: function () { return runtime ? runtime.unsharedJobs() : Promise.resolve([]); },
    shareJobs: function (ids) { return runtime ? runtime.shareJobs(ids) : Promise.resolve(0); }
  };

  try { startRuntime(); } catch (e) { if (root.console) console.error("[ApexSync]", e); }
  return api;
});
