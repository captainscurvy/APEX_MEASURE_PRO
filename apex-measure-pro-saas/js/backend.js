/*
 * backend.js — ApexBackend: Supabase (GoTrue + PostgREST + Storage) over plain fetch, NO SDK,
 * plus an in-memory mock with identical semantics (used by tests and `?mock=1` demos).
 *
 * UNTESTED against a live Supabase project (none exists yet). The mock exercises the client
 * logic; the HTTP layer follows the documented GoTrue / PostgREST / Storage wire formats.
 * The server side lives in supabase/schema.sql — rules (roles, seats, entitlement) are enforced
 * THERE; this file never decides entitlement.
 *
 * Errors: every rejection is an Error with .code in
 *   offline | unauthorized | forbidden | not-configured | conflict | server
 * (and .detail = a short machine-readable reason such as "seat-limit" when the server gave one).
 *
 * Record shape returned by pull/get:  { id, project, rev, deleted, ownerId }
 *   rev = the server's updated_at string for the row; it is the optimistic-concurrency token:
 *   pushProject(project, { baseRev }) succeeds only if the row still has that rev.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ApexBackend = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  var SESSION_KEY = "apex-backend-session";
  var ROLES = ["owner", "admin", "member", "viewer"];
  var INVITE_ROLES = ["admin", "member", "viewer"];
  var ACTIVE = { active: 1, trialing: 1, past_due: 1 };

  function mkErr(code, message, detail) {
    var e = new Error(message || code);
    e.code = code;
    if (detail) e.detail = detail;
    return e;
  }
  function clone(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }
  function lc(s) { return String(s || "").trim().toLowerCase(); }
  function validEmail(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || "").trim()); }

  function normEntitlement(e) {
    e = e || {};
    var plan = ["manual", "laser", "crew"].indexOf(e.plan) !== -1 ? e.plan : "none";
    var status = ["trialing", "active", "past_due", "canceled"].indexOf(e.status) !== -1 ? e.status : "none";
    return {
      plan: plan,
      status: status,
      currentPeriodEnd: e.currentPeriodEnd || null,
      seats: typeof e.seats === "number" ? e.seats : 0,
      orgId: e.orgId || null,
      role: ROLES.indexOf(e.role) !== -1 ? e.role : null
    };
  }

  function safeStorage(opts) {
    if (opts && opts.storage !== undefined) return opts.storage;
    try { return root.localStorage || null; } catch (e) { return null; }
  }

  // ====================================================================================
  // Real backend
  // ====================================================================================

  function createBackend(opts) {
    opts = opts || {};
    var listeners = [];
    var sess = null;            // in-memory copy of the persisted session
    var loaded = false;
    var refreshing = null;
    var ent = null, entAt = 0;  // short-lived cache of the entitlement (org id, role)

    function cfg() { return opts.config || root.ApexConfig || { demo: true, backend: {} }; }
    function baseUrl() { return String((cfg().backend || {}).url || "").replace(/\/+$/, ""); }
    function anonKey() { return (cfg().backend || {}).anonKey || ""; }
    function now() { return opts.now ? opts.now() : Date.now(); }
    function configured() { return Boolean(baseUrl() && anonKey()) && cfg().demo !== true; }
    function doFetch(url, init) {
      var f = opts.fetch || (root.fetch ? root.fetch.bind(root) : null);
      if (!f) return Promise.reject(mkErr("offline", "fetch is unavailable"));
      return f(url, init);
    }

    // --- session persistence ---------------------------------------------------------
    function load() {
      if (loaded) return;
      loaded = true;
      var st = safeStorage(opts);
      try {
        var raw = st && st.getItem(SESSION_KEY);
        if (raw) {
          var s = JSON.parse(raw);
          if (s && s.accessToken && s.refreshToken && s.userId) sess = s;
        }
      } catch (e) { sess = null; }
    }
    function persist() {
      var st = safeStorage(opts);
      try {
        if (!st) return;
        if (sess) st.setItem(SESSION_KEY, JSON.stringify(sess));
        else st.removeItem(SESSION_KEY);
      } catch (e) { /* private mode / blocked storage: session lives in memory only */ }
    }
    function setSession(s) {
      var changed = (sess && sess.userId) !== (s && s.userId);
      sess = s;
      persist();
      if (changed) { ent = null; entAt = 0; }
      listeners.slice().forEach(function (fn) { try { fn(sess); } catch (e) { /* listener bug */ } });
    }
    function toSession(body) {
      var user = body.user || {};
      var exp = body.expires_at ? body.expires_at * 1000 : now() + (body.expires_in || 3600) * 1000;
      return { userId: user.id, email: user.email, accessToken: body.access_token,
        refreshToken: body.refresh_token, expiresAt: exp };
    }
    function session() { load(); return sess ? clone(sess) : null; }
    function onAuthChange(fn) {
      listeners.push(fn);
      return function () { var i = listeners.indexOf(fn); if (i !== -1) listeners.splice(i, 1); };
    }

    // --- HTTP -------------------------------------------------------------------------
    function readBody(res) {
      return res.text().then(function (t) {
        if (!t) return null;
        try { return JSON.parse(t); } catch (e) { return t; }
      }, function () { return null; });
    }
    function errFrom(res, body) {
      var msg = (body && (body.message || body.msg || body.error_description || body.error)) || ("HTTP " + res.status);
      var s = res.status;
      if (s === 401) return mkErr("unauthorized", msg);
      if (s === 403) return mkErr("forbidden", msg, typeof msg === "string" ? msg : "");
      if (s === 409) return mkErr("conflict", msg);
      return mkErr("server", msg);
    }
    function netFail(e) {
      if (e && e.code) return e;
      return mkErr("offline", "Can't reach the server.");
    }
    function offlineNow() {
      try { return root.navigator && root.navigator.onLine === false; } catch (e) { return false; }
    }

    // Raw request (no auth refresh logic). init.headers are merged over the defaults.
    function raw(path, init) {
      if (!configured()) return Promise.reject(mkErr("not-configured", "Cloud server is not configured."));
      if (offlineNow()) return Promise.reject(mkErr("offline", "You're offline."));
      return doFetch(baseUrl() + path, init).then(function (res) { return res; }, function (e) { throw netFail(e); });
    }
    function authHeaders(token, extra) {
      var h = { apikey: anonKey(), Authorization: "Bearer " + (token || anonKey()) };
      Object.keys(extra || {}).forEach(function (k) { h[k] = extra[k]; });
      return h;
    }

    function refresh() {
      load();
      if (!sess) return Promise.reject(mkErr("unauthorized", "Not signed in."));
      if (refreshing) return refreshing;
      var rt = sess.refreshToken;
      refreshing = raw("/auth/v1/token?grant_type=refresh_token", {
        method: "POST",
        headers: authHeaders(null, { "Content-Type": "application/json" }),
        body: JSON.stringify({ refresh_token: rt })
      }).then(function (res) {
        return readBody(res).then(function (body) {
          if (res.status >= 200 && res.status < 300 && body && body.access_token) {
            setSession(toSession(body));
            return sess;
          }
          // 400/401: the refresh token is dead → signed out. 5xx → transient.
          if (res.status === 400 || res.status === 401 || res.status === 403) {
            setSession(null);
            throw mkErr("unauthorized", "Your session expired. Sign in again.");
          }
          throw errFrom(res, body);
        });
      }).then(function (s) { refreshing = null; return s; }, function (e) { refreshing = null; throw e; });
      return refreshing;
    }

    function ensureFresh() {
      load();
      if (!sess) return Promise.reject(mkErr("unauthorized", "Not signed in."));
      if (sess.expiresAt - now() < 60000) return refresh();
      return Promise.resolve(sess);
    }

    // Authenticated request with one refresh-and-retry on 401. `want`: "json" | "blob" | "raw".
    function authed(path, init, want) {
      var tried = false;
      function attempt() {
        return ensureFresh().then(function (s) {
          var i = { method: init.method || "GET", body: init.body, headers: authHeaders(s.accessToken, init.headers) };
          return raw(path, i);
        }).then(function (res) {
          if (res.status === 401 && !tried) { tried = true; return refresh().then(attempt); }
          if (res.status >= 200 && res.status < 300) {
            if (want === "blob") return res.blob();
            if (want === "raw") return res;
            return readBody(res);
          }
          return readBody(res).then(function (body) {
            var e = errFrom(res, body);
            e.status = res.status;
            throw e;
          });
        });
      }
      return attempt();
    }

    function rest(path, init) {
      init = init || {};
      init.headers = init.headers || {};
      if (init.body !== undefined && typeof init.body !== "string") {
        init.body = JSON.stringify(init.body);
        if (!init.headers["Content-Type"]) init.headers["Content-Type"] = "application/json";
      }
      return authed("/rest/v1/" + path, init, "json");
    }
    function rpc(name, args) { return rest("rpc/" + name, { method: "POST", body: args || {} }); }
    function q(v) { return encodeURIComponent(v); }

    // --- auth -------------------------------------------------------------------------
    function signInWithEmail(email) {
      email = String(email || "").trim();
      if (!validEmail(email)) return Promise.reject(mkErr("server", "Enter a valid email address.", "bad-email"));
      return raw("/auth/v1/otp", {
        method: "POST",
        headers: authHeaders(null, { "Content-Type": "application/json" }),
        body: JSON.stringify({ email: email, create_user: true })
      }).then(function (res) {
        return readBody(res).then(function (body) {
          if (res.status >= 200 && res.status < 300) return { sent: true };
          throw errFrom(res, body);
        });
      });
    }
    function verifyCode(email, code) {
      return raw("/auth/v1/verify", {
        method: "POST",
        headers: authHeaders(null, { "Content-Type": "application/json" }),
        body: JSON.stringify({ type: "email", email: String(email || "").trim(), token: String(code || "").trim() })
      }).then(function (res) {
        return readBody(res).then(function (body) {
          if (res.status >= 200 && res.status < 300 && body && body.access_token) {
            setSession(toSession(body));
            return session();
          }
          if (res.status === 400 || res.status === 401 || res.status === 403 || res.status === 422) {
            throw mkErr("unauthorized", "That code didn't work. Check it or request a new one.");
          }
          throw errFrom(res, body);
        });
      });
    }
    function signOut() {
      load();
      var s = sess;
      setSession(null);   // local sign-out always succeeds, even offline
      if (!s || !configured()) return Promise.resolve();
      return doFetch(baseUrl() + "/auth/v1/logout", { method: "POST", headers: authHeaders(s.accessToken) })
        .then(function () { /* best effort */ }, function () { /* offline: token expires on its own */ });
    }

    // --- entitlement ------------------------------------------------------------------
    function getEntitlement() {
      return rpc("get_entitlement", {}).then(function (body) {
        ent = normEntitlement(Array.isArray(body) ? body[0] : body);
        entAt = now();
        return clone(ent);
      });
    }
    function cachedEnt() {
      if (ent && now() - entAt < 10 * 60000) return Promise.resolve(ent);
      return getEntitlement().then(function () { return ent; });
    }
    function needOrg() {
      return cachedEnt().then(function (e) {
        if (!e.orgId) throw mkErr("forbidden", "No team found for this account.", "no-org");
        return e;
      });
    }

    // --- projects ---------------------------------------------------------------------
    function toRecord(r) {
      return { id: r.id, project: r.data, rev: r.updated_at, deleted: Boolean(r.deleted_at), ownerId: r.owner_id || null };
    }
    var SEL = "select=id,data,updated_at,deleted_at,owner_id";

    function pushProject(project, o) {
      o = o || {};
      if (!project || !project.id) return Promise.reject(mkErr("server", "Project has no id."));
      return needOrg().then(function (e) {
        if (e.role === "viewer") throw mkErr("forbidden", "Viewers can't edit jobs.", "viewer");
        var id = String(project.id);
        if (o.baseRev) {
          // Update only if the row still has the rev the caller last saw (optimistic concurrency).
          var path = "projects?org_id=eq." + q(e.orgId) + "&id=eq." + q(id) + "&updated_at=eq." + q(o.baseRev) + "&" + SEL;
          return rest(path, { method: "PATCH", headers: { Prefer: "return=representation" },
            body: { data: project, deleted_at: null } }).then(function (rows) {
            if (rows && rows.length) return { id: id, rev: rows[0].updated_at };
            // 0 rows: either someone else changed it (conflict) or RLS hid it from us (forbidden).
            return rest("projects?org_id=eq." + q(e.orgId) + "&id=eq." + q(id) + "&select=updated_at").then(function (cur) {
              if (cur && cur.length && cur[0].updated_at === o.baseRev) throw mkErr("forbidden", "You can't edit this job.", "rls");
              throw mkErr("conflict", "This job changed on the server.");
            });
          });
        }
        // New row: plain insert (a duplicate primary key → 409 → conflict, never a blind overwrite).
        return rest("projects?" + SEL, { method: "POST", headers: { Prefer: "return=representation" },
          body: { id: id, org_id: e.orgId, data: project } }).then(function (rows) {
          return { id: id, rev: rows && rows[0] ? rows[0].updated_at : null };
        });
      });
    }

    function pullProjects(sinceISO) {
      return needOrg().then(function (e) {
        var out = [];
        function page(since) {
          var path = "projects?org_id=eq." + q(e.orgId) + "&" + SEL + "&order=updated_at.asc&limit=500" +
            (since ? "&updated_at=gt." + q(since) : "");
          return rest(path).then(function (rows) {
            rows = rows || [];
            rows.forEach(function (r) { out.push(toRecord(r)); });
            if (rows.length === 500) return page(rows[rows.length - 1].updated_at);
            return out;
          });
        }
        return page(sinceISO || "");
      });
    }

    function getProject(id) {
      return needOrg().then(function (e) {
        return rest("projects?org_id=eq." + q(e.orgId) + "&id=eq." + q(String(id)) + "&" + SEL).then(function (rows) {
          return rows && rows.length ? toRecord(rows[0]) : null;
        });
      });
    }

    function deleteProject(id) {
      return needOrg().then(function (e) {
        if (e.role === "viewer") throw mkErr("forbidden", "Viewers can't delete jobs.", "viewer");
        return rest("projects?org_id=eq." + q(e.orgId) + "&id=eq." + q(String(id)) + "&select=updated_at",
          { method: "PATCH", headers: { Prefer: "return=representation" }, body: { deleted_at: new Date(now()).toISOString() } })
          .then(function (rows) {
            if (!rows || !rows.length) throw mkErr("forbidden", "You can't delete this job.", "rls");
            return { id: String(id), rev: rows[0].updated_at };
          });
      });
    }

    // --- photos (Storage bucket "photos", path <orgId>/<projectId>/<photoId>) --------------
    function photoPath(orgId, projectId, photoId) {
      return "/storage/v1/object/photos/" + q(orgId) + "/" + q(projectId) + "/" + q(photoId);
    }
    function putPhoto(projectId, photoId, blob) {
      return needOrg().then(function (e) {
        if (e.role === "viewer") throw mkErr("forbidden", "Viewers can't add photos.", "viewer");
        return authed(photoPath(e.orgId, String(projectId), String(photoId)), {
          method: "POST", body: blob,
          headers: { "Content-Type": (blob && blob.type) || "application/octet-stream", "x-upsert": "true" }
        }, "json").then(function () { return { id: String(photoId) }; });
      });
    }
    function getPhoto(projectId, photoId) {
      return needOrg().then(function (e) {
        var p = photoPath(e.orgId, String(projectId), String(photoId)).replace("/object/", "/object/authenticated/");
        return authed(p, { method: "GET" }, "blob").then(function (b) { return b; }, function (err) {
          if (err.status === 404 || err.status === 400) return null;   // not uploaded (yet)
          throw err;
        });
      });
    }

    // --- team -------------------------------------------------------------------------
    function listMembers() {
      return rpc("list_members", {}).then(function (rows) {
        return (rows || []).map(function (r) {
          return { userId: r.user_id, email: r.email, role: r.role, joinedAt: r.joined_at };
        });
      });
    }
    function listInvites() {
      return rpc("list_invites", {}).then(function (rows) {
        return (rows || []).map(function (r) {
          return { code: r.code, email: r.email, role: r.role, expiresAt: r.expires_at };
        });
      });
    }
    function invite(email, role) {
      if (!validEmail(email)) return Promise.reject(mkErr("server", "Enter a valid email address.", "bad-email"));
      if (INVITE_ROLES.indexOf(role) === -1) return Promise.reject(mkErr("server", "Unknown role.", "bad-role"));
      return rpc("create_invite", { p_email: String(email).trim(), p_role: role }).then(function (r) {
        return { code: r.code, email: lc(email), role: role, expiresAt: r.expiresAt };
      });
    }
    function acceptInvite(code) {
      return rpc("accept_invite", { p_code: String(code || "").trim() }).then(function (r) {
        ent = null; entAt = 0;
        return r;
      });
    }
    function removeMember(userId) {
      return rpc("remove_member", { p_user: userId }).then(function () { ent = null; entAt = 0; return { ok: true }; });
    }
    function setRole(userId, role) {
      if (INVITE_ROLES.indexOf(role) === -1) return Promise.reject(mkErr("server", "Unknown role.", "bad-role"));
      return rpc("set_member_role", { p_user: userId, p_role: role }).then(function () { return { ok: true }; });
    }
    function recordConsent(terms, privacy) {
      return rpc("record_consent", { p_terms: String(terms || ""), p_privacy: String(privacy || "") }).then(function () { return { ok: true }; });
    }
    function revokeInvite(code) { return rpc("revoke_invite", { p_code: code }).then(function () { return { ok: true }; }); }

    return {
      configured: configured, createMock: createMock, isMock: false,
      session: session, onAuthChange: onAuthChange, signInWithEmail: signInWithEmail, verifyCode: verifyCode,
      signOut: signOut, refresh: refresh,
      getEntitlement: getEntitlement,
      pushProject: pushProject, pullProjects: pullProjects, getProject: getProject, deleteProject: deleteProject,
      putPhoto: putPhoto, getPhoto: getPhoto,
      listMembers: listMembers, listInvites: listInvites, invite: invite, acceptInvite: acceptInvite,
      removeMember: removeMember, setRole: setRole, revokeInvite: revokeInvite, recordConsent: recordConsent
    };
  }

  // ====================================================================================
  // In-memory mock — SAME semantics as supabase/schema.sql (roles, seats, rev concurrency,
  // team-plan-gated writes, soft deletes). Several clients can share one `server`.
  // ====================================================================================

  function createMockServer(sopts) {
    sopts = sopts || {};
    var s = {
      users: {},        // email → { id, email }
      codes: {},        // email → code
      orgs: {},         // id → { id, name }
      members: [],      // { orgId, userId, role, joinedAt }
      subs: {},         // orgId → { plan, status, seats, currentPeriodEnd }
      projects: {},     // orgId + "|" + id → { id, orgId, ownerId, data, rev, deleted }
      invites: {},      // code → { code, orgId, email, role, expiresAt, accepted }
      photos: {},       // orgId/projectId/photoId → blob
      seq: 0, lastRev: 0,
      code: sopts.code || "123456",
      now: sopts.now || function () { return Date.now(); }
    };
    s.id = function (p) { s.seq++; return p + "-" + s.seq; };
    s.nextRev = function () {
      s.lastRev = Math.max(s.now(), s.lastRev + 1);
      return new Date(s.lastRev).toISOString();
    };
    s.membership = function (userId) {
      for (var i = 0; i < s.members.length; i++) if (s.members[i].userId === userId) return s.members[i];
      return null;
    };
    s.hasTeam = function (orgId) {
      var sub = s.subs[orgId];
      return Boolean(sub && sub.plan === "crew" && s.live(sub));
    };
    // active/trialing always; past_due only for 7 days after the period end (mirrors _sub_live in schema.sql)
    s.live = function (sub) {
      if (sub.status === "active" || sub.status === "trialing") return true;
      if (sub.status !== "past_due") return false;
      return !sub.currentPeriodEnd || Date.parse(sub.currentPeriodEnd) + 7 * 86400000 > s.now();
    };
    s.consents = [];
    s.seatsUsed = function (orgId) {
      var n = 0;
      s.members.forEach(function (m) { if (m.orgId === orgId && m.role !== "viewer") n++; });
      Object.keys(s.invites).forEach(function (c) {
        var i = s.invites[c];
        if (i.orgId === orgId && !i.accepted && i.expiresAt > s.now() && i.role !== "viewer") n++;
      });
      return n;
    };
    s.ensureUser = function (email) {
      email = lc(email);
      if (!s.users[email]) {
        var id = s.id("user");
        s.users[email] = { id: id, email: email };
        s.makePersonalOrg(id, email);
      }
      return s.users[email];
    };
    s.makePersonalOrg = function (userId, email) {
      var orgId = s.id("org");
      s.orgs[orgId] = { id: orgId, name: email.split("@")[0] + "'s company" };
      s.members.push({ orgId: orgId, userId: userId, role: "owner", joinedAt: new Date(s.now()).toISOString() });
      return orgId;
    };
    // Test helper = what the Stripe webhook does.
    s.setSubscription = function (email, sub) {
      var u = s.users[lc(email)];
      if (!u) throw new Error("no such user");
      var m = s.membership(u.id);
      s.subs[m.orgId] = {
        plan: sub.plan || "crew", status: sub.status || "active", seats: sub.seats === undefined ? 3 : sub.seats,
        currentPeriodEnd: sub.currentPeriodEnd || new Date(s.now() + 30 * 86400000).toISOString()
      };
      return m.orgId;
    };
    return s;
  }

  function createMock(mopts) {
    mopts = mopts || {};
    var server = mopts.server || createMockServer(mopts);
    var sess = null;
    var online = true;
    var listeners = [];
    var failNext = null;
    var calls = [];

    function now() { return server.now(); }
    function gate(name) {
      calls.push(name);
      if (!online) return mkErr("offline", "You're offline.");
      if (failNext) { var f = failNext; failNext = null; return mkErr(f, "Injected failure."); }
      return null;
    }
    function authed(name) {
      var e = gate(name);
      if (e) return e;
      if (!sess) return mkErr("unauthorized", "Not signed in.");
      return null;
    }
    function done(fn) {
      try { return Promise.resolve(fn()); } catch (e) { return Promise.reject(e); }
    }
    function emit() { listeners.slice().forEach(function (fn) { try { fn(sess ? clone(sess) : null); } catch (e) { /* ignore */ } }); }
    function me() { return server.membership(sess.userId); }
    function can(role) { return role === "owner" || role === "admin" || role === "member"; }
    function isAdmin(role) { return role === "owner" || role === "admin"; }
    function key(orgId, id) { return orgId + "|" + id; }
    function rec(r) { return { id: r.id, project: clone(r.data), rev: r.rev, deleted: r.deleted, ownerId: r.ownerId }; }

    function wrap(name, fn) {
      return function () {
        var args = arguments;
        var err = authed(name);
        if (err) return Promise.reject(err);
        return done(function () { return fn.apply(null, args); });
      };
    }

    var api = {
      isMock: true,
      server: server,
      configured: function () { return true; },
      createMock: createMock,
      setOnline: function (v) { online = Boolean(v); },
      failNext: function (code) { failNext = code; },
      calls: calls,

      session: function () { return sess ? clone(sess) : null; },
      onAuthChange: function (fn) {
        listeners.push(fn);
        return function () { var i = listeners.indexOf(fn); if (i !== -1) listeners.splice(i, 1); };
      },
      signInWithEmail: function (email) {
        var e = gate("signInWithEmail");
        if (e) return Promise.reject(e);
        if (!validEmail(email)) return Promise.reject(mkErr("server", "Enter a valid email address.", "bad-email"));
        server.codes[lc(email)] = server.code;
        return Promise.resolve({ sent: true });
      },
      verifyCode: function (email, code) {
        var e = gate("verifyCode");
        if (e) return Promise.reject(e);
        if (server.codes[lc(email)] !== String(code || "").trim()) {
          return Promise.reject(mkErr("unauthorized", "That code didn't work. Check it or request a new one."));
        }
        delete server.codes[lc(email)];
        var isNew = !server.users[lc(email)];
        var u = server.ensureUser(email);
        if (isNew && mopts.autoPlan) server.setSubscription(email, { plan: mopts.autoPlan, status: "active", seats: 3 });   // demo convenience
        sess = { userId: u.id, email: u.email, accessToken: "tok-" + server.id("t"), refreshToken: "ref-" + server.id("r"),
          expiresAt: now() + 3600000 };
        emit();
        return Promise.resolve(clone(sess));
      },
      signOut: function () { sess = null; emit(); return Promise.resolve(); },
      refresh: function () { return Promise.resolve(sess ? clone(sess) : null); },

      getEntitlement: wrap("getEntitlement", function () {
        var m = me();
        var sub = server.subs[m.orgId];
        return normEntitlement({
          plan: sub ? sub.plan : "none", status: sub ? sub.status : "none",
          currentPeriodEnd: sub ? sub.currentPeriodEnd : null, seats: sub ? sub.seats : 0,
          orgId: m.orgId, role: m.role
        });
      }),

      pushProject: wrap("pushProject", function (project, o) {
        o = o || {};
        var m = me();
        if (m.role === "viewer") throw mkErr("forbidden", "Viewers can't edit jobs.", "viewer");
        if (!can(m.role) || !server.hasTeam(m.orgId)) throw mkErr("forbidden", "Team plan required to sync.", "plan-required");
        var k = key(m.orgId, project.id), cur = server.projects[k];
        if (o.baseRev) {
          if (!cur || cur.rev !== o.baseRev) throw mkErr("conflict", "This job changed on the server.");
          cur.data = clone(project); cur.deleted = false; cur.rev = server.nextRev();
          return { id: cur.id, rev: cur.rev };
        }
        if (cur) throw mkErr("conflict", "A job with this id already exists.");
        server.projects[k] = { id: String(project.id), orgId: m.orgId, ownerId: sess.userId, data: clone(project),
          rev: server.nextRev(), deleted: false };
        return { id: String(project.id), rev: server.projects[k].rev };
      }),
      pullProjects: wrap("pullProjects", function (since) {
        var m = me();
        return Object.keys(server.projects).map(function (k) { return server.projects[k]; })
          .filter(function (r) { return r.orgId === m.orgId && (!since || r.rev > since); })
          .sort(function (a, b) { return a.rev < b.rev ? -1 : 1; }).map(rec);
      }),
      getProject: wrap("getProject", function (id) {
        var r = server.projects[key(me().orgId, String(id))];
        return r ? rec(r) : null;
      }),
      deleteProject: wrap("deleteProject", function (id) {
        var m = me(), r = server.projects[key(m.orgId, String(id))];
        if (m.role === "viewer" || !r || !can(m.role) || !server.hasTeam(m.orgId)) throw mkErr("forbidden", "You can't delete this job.");
        r.deleted = true; r.data = { id: r.id }; r.rev = server.nextRev();   // tombstone, like the DB trigger
        Object.keys(server.photos).forEach(function (k) { if (k.indexOf(m.orgId + "/" + r.id + "/") === 0) delete server.photos[k]; });
        return { id: r.id, rev: r.rev };
      }),
      putPhoto: wrap("putPhoto", function (projectId, photoId, blob) {
        var m = me();
        if (m.role === "viewer" || !server.hasTeam(m.orgId)) throw mkErr("forbidden", "You can't add photos.", "viewer");
        server.photos[m.orgId + "/" + projectId + "/" + photoId] = blob;
        return { id: String(photoId) };
      }),
      getPhoto: wrap("getPhoto", function (projectId, photoId) {
        return server.photos[me().orgId + "/" + projectId + "/" + photoId] || null;
      }),

      listMembers: wrap("listMembers", function () {
        var m = me(), out = [];
        server.members.forEach(function (x) {
          if (x.orgId !== m.orgId) return;
          var email = "";
          Object.keys(server.users).forEach(function (e) { if (server.users[e].id === x.userId) email = e; });
          out.push({ userId: x.userId, email: email, role: x.role, joinedAt: x.joinedAt });
        });
        return out;
      }),
      listInvites: wrap("listInvites", function () {
        var m = me();
        if (!isAdmin(m.role)) throw mkErr("forbidden", "Only owners and admins can see invites.");
        return Object.keys(server.invites).map(function (c) { return server.invites[c]; })
          .filter(function (i) { return i.orgId === m.orgId && !i.accepted && i.expiresAt > now(); })
          .map(function (i) { return { code: i.code, email: i.email, role: i.role, expiresAt: new Date(i.expiresAt).toISOString() }; });
      }),
      invite: wrap("invite", function (email, role) {
        var m = me();
        if (!validEmail(email)) throw mkErr("server", "Enter a valid email address.", "bad-email");
        if (INVITE_ROLES.indexOf(role) === -1) throw mkErr("server", "Unknown role.", "bad-role");
        if (!isAdmin(m.role)) throw mkErr("forbidden", "Only owners and admins can invite.", "not-admin");
        if (role === "admin" && m.role !== "owner") throw mkErr("forbidden", "Only the owner can add admins.", "owner-only");
        if (!server.hasTeam(m.orgId)) throw mkErr("forbidden", "The Crew plan is needed to add people.", "plan-required");
        // replace any pending invite for the same email
        Object.keys(server.invites).forEach(function (c) {
          var i = server.invites[c];
          if (i.orgId === m.orgId && i.email === lc(email) && !i.accepted) delete server.invites[c];
        });
        if (role !== "viewer" && server.seatsUsed(m.orgId) + 1 > server.subs[m.orgId].seats) {
          throw mkErr("forbidden", "All paid seats are in use. Add seats in billing, or invite as a free viewer.", "seat-limit");
        }
        var code = ("ABCD-" + String(server.id("c")).replace(/\D/g, "").padStart(4, "0") + "-" + (1000 + server.seq)).toUpperCase();
        server.invites[code] = { code: code, orgId: m.orgId, email: lc(email), role: role, expiresAt: now() + 7 * 86400000, accepted: false };
        return { code: code, email: lc(email), role: role, expiresAt: new Date(server.invites[code].expiresAt).toISOString() };
      }),
      acceptInvite: wrap("acceptInvite", function (code) {
        var i = server.invites[String(code || "").trim().toUpperCase()];
        if (!i || i.accepted || i.expiresAt <= now()) throw mkErr("forbidden", "That invite code is invalid or has expired.", "invalid-invite");
        if (lc(sess.email) !== i.email) throw mkErr("forbidden", "This invite was sent to a different email address.", "email-mismatch");
        var old = me();
        if (old.orgId === i.orgId) { i.accepted = true; return { orgId: i.orgId, role: old.role }; }
        var oldSub = server.subs[old.orgId];
        var mates = server.members.some(function (x) { return x.orgId === old.orgId && x.userId !== sess.userId; });
        if (old.role === "owner" && mates) throw mkErr("forbidden", "Hand over ownership before leaving your team.", "transfer-ownership-first");
        if (oldSub && server.live(oldSub)) {
          throw mkErr("forbidden", "Cancel your personal subscription first, then accept the invite.", "cancel-plan-first");
        }
        server.members = server.members.filter(function (x) { return x.userId !== sess.userId; });
        server.members.push({ orgId: i.orgId, userId: sess.userId, role: i.role, joinedAt: new Date(now()).toISOString() });
        i.accepted = true;
        var left = server.members.some(function (x) { return x.orgId === old.orgId; });
        if (!left && !server.subs[old.orgId]) delete server.orgs[old.orgId];
        return { orgId: i.orgId, role: i.role };
      }),
      removeMember: wrap("removeMember", function (userId) {
        var m = me(), t = server.membership(userId);
        if (!t || t.orgId !== m.orgId) throw mkErr("forbidden", "That person isn't on your team.");
        var self = userId === sess.userId;
        if (t.role === "owner") throw mkErr("forbidden", "The owner can't be removed.", "owner");
        if (!self && !(m.role === "owner" || (m.role === "admin" && (t.role === "member" || t.role === "viewer")))) {
          throw mkErr("forbidden", "You can't remove this person.", "not-allowed");
        }
        server.members = server.members.filter(function (x) { return x.userId !== userId; });
        var email = "";
        Object.keys(server.users).forEach(function (e) { if (server.users[e].id === userId) email = e; });
        server.makePersonalOrg(userId, email);
        return { ok: true };
      }),
      setRole: wrap("setRole", function (userId, role) {
        var m = me(), t = server.membership(userId);
        if (INVITE_ROLES.indexOf(role) === -1) throw mkErr("server", "Unknown role.", "bad-role");
        if (!t || t.orgId !== m.orgId) throw mkErr("forbidden", "That person isn't on your team.");
        if (t.role === "owner") throw mkErr("forbidden", "The owner's role can't change.", "owner");
        if (!isAdmin(m.role)) throw mkErr("forbidden", "Only owners and admins can change roles.", "not-admin");
        if (m.role === "admin" && (role === "admin" || t.role === "admin")) throw mkErr("forbidden", "Only the owner can manage admins.", "owner-only");
        if (t.role === "viewer" && role !== "viewer") {
          var sub = server.subs[m.orgId];
          if (!sub || server.seatsUsed(m.orgId) + 1 > sub.seats) throw mkErr("forbidden", "All paid seats are in use.", "seat-limit");
        }
        t.role = role;
        return { ok: true };
      }),
      recordConsent: wrap("recordConsent", function (terms, privacy) {
        if (!terms || !privacy) throw mkErr("server", "Missing version.", "bad-version");
        server.consents.push({ userId: sess.userId, terms: String(terms), privacy: String(privacy), at: new Date(now()).toISOString() });
        return { ok: true };
      }),
      revokeInvite: wrap("revokeInvite", function (code) {
        var m = me(), i = server.invites[String(code).toUpperCase()];
        if (!isAdmin(m.role)) throw mkErr("forbidden", "Only owners and admins can revoke invites.");
        if (i && i.orgId === m.orgId) delete server.invites[i.code];
        return { ok: true };
      })
    };
    return api;
  }

  // ====================================================================================
  // Default instance (reads ApexConfig lazily, so load order doesn't matter)
  // ====================================================================================
  var instance = createBackend({});
  // `?mock=1` in the page URL → run the whole app against the in-memory mock (demo/training only;
  // any email works, the code is 123456, new accounts get a Crew plan). Nothing leaves the device.
  try {
    var loc = root.location || {};
    var localHost = /^(localhost|127\.0\.0\.1|\[::1\]|::1)$/.test(String(loc.hostname || ""));
    // Never on a production hostname: only localhost/127.0.0.1/[::1] or a file:// page.
    if ((localHost || loc.protocol === "file:") && /[?&]mock=1(&|$)/.test(loc.search || "")) {
      instance = createMock({ autoPlan: "crew" });
    }
  } catch (e) { /* not a browser */ }
  var out = {};
  Object.keys(instance).forEach(function (k) { out[k] = instance[k]; });
  out.createBackend = createBackend;
  out.createMock = createMock;
  out.createMockServer = createMockServer;
  out.SESSION_KEY = SESSION_KEY;
  return out;
});
