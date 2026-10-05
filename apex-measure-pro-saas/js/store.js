/*
 * store.js — data model (§6), IndexedDB with memory-only fallback (§14.1),
 * versioned files (§10.3), migrations (§10.4), import validation (§14.3).
 *
 * The model helpers and validators are pure and run in Node; the database
 * functions need a browser.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ApexStore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  var R = root.ApexReduce || (typeof require === "function" ? require("./reduce.js") : null);

  var CURRENT_SCHEMA = 1;
  // Pure functions keyed by SOURCE version, applied in sequence: 1 → 2 → …
  var MIGRATIONS = { /* 1: function (data) { return data2; }  ← none yet; add as versions ship */ };

  var MOUNT_TYPES = ["IB", "OB"];
  var CONTROL_SIDES = ["left", "right", null];
  var CONTROL_TYPES = ["cord loop", "continuous cord loop", "wand", "cordless",
    "motorized", "top-down/bottom-up", "other"];
  var UNITS = ["in", "ftin", "cm"];
  var SOFT_WINDOWS = 500, SOFT_ROOMS = 50;
  var MSG_NEWER = "This file was created by a newer version of the app. Update to open it.";

  function uid() {
    if (root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID();
    return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  function today() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  // --- model ----------------------------------------------------------------

  function newDimension() { return { shots: [], ordered: null }; }

  function newWindow(label) {
    return {
      id: uid(),
      label: label,
      width: newDimension(),
      height: newDimension(),
      depth: null,
      mountType: null,
      controlSide: null,
      controlType: null,
      controlTypeOther: "",
      obstructions: "",
      notes: "",
      photos: [],
      history: []   // reserved: { timestamp, reason, width, height, depth, note } — DO NOT change shape
    };
  }

  function newRoom(name) {
    return { id: uid(), name: name || "Room", notes: "", windows: [], nextWindowNumber: 1 };
  }

  function newProject(fields) {
    fields = fields || {};
    var p = {
      schemaVersion: CURRENT_SCHEMA,
      id: uid(),
      name: fields.name || "",
      client: fields.client || "",
      address: fields.address || "",
      date: fields.date || today(),
      measurer: fields.measurer || "",
      notes: fields.notes || "",
      unit: UNITS.indexOf(fields.unit) !== -1 ? fields.unit : "in",
      createdAt: Date.now(),
      rooms: []
    };
    p.rooms.push(newRoom("Room 1"));   // §10.2 — one tap from measuring
    return p;
  }

  // W1, W2… assigned at creation and never recomputed (§8.5).
  function addWindow(room) {
    var n = room.nextWindowNumber || (room.windows.length + 1);
    var w = newWindow("W" + n);
    room.nextWindowNumber = n + 1;
    room.windows.push(w);
    return w;
  }

  function recomputeOrdered(dim) {
    if (!dim) return;
    var raws = dim.shots.map(function (s) { return s.raw; });
    dim.ordered = R.orderedValue(raws);   // smallest wins, floored to 1/8" (§4.1)
  }

  function isWindowComplete(w) {
    return Boolean(w && w.width.shots.length >= 1 && w.height.shots.length >= 1 && w.mountType);
  }

  function roomStats(room) {
    var done = room.windows.filter(isWindowComplete).length;
    return { complete: done, total: room.windows.length };
  }

  function projectStats(p) {
    var total = 0, done = 0;
    (p.rooms || []).forEach(function (r) {
      total += r.windows.length;
      done += r.windows.filter(isWindowComplete).length;
    });
    return { rooms: (p.rooms || []).length, windows: total, complete: done };
  }

  function displayName(p) { return p.client ? p.client + " — " + p.date : p.date; }

  function isLarge(p) {
    var s = projectStats(p);
    return s.windows >= SOFT_WINDOWS || s.rooms >= SOFT_ROOMS;
  }

  // --- migrations (§10.4) ---------------------------------------------------

  // Returns { ok, data } or { ok:false, error }. Never partially loads.
  function migrate(data, storedVersion) {
    var v = storedVersion;
    if (typeof v !== "number") return { ok: false, error: "This file is missing a version and can't be read." };
    if (v > CURRENT_SCHEMA) return { ok: false, error: MSG_NEWER, newer: true };
    var out = data;
    while (v < CURRENT_SCHEMA) {
      var fn = MIGRATIONS[v];
      if (!fn) return { ok: false, error: "No migration from version " + v + "." };
      out = fn(out);
      v++;
    }
    if (out && typeof out === "object") out.schemaVersion = CURRENT_SCHEMA;
    return { ok: true, data: out };
  }

  // --- validation (§14.3) ---------------------------------------------------

  function isObj(x) { return x !== null && typeof x === "object" && !Array.isArray(x); }
  function isStr(x) { return typeof x === "string"; }
  function optStr(x) { return x === undefined || x === null || typeof x === "string"; }

  function checkDimension(d, where, bad) {
    if (!isObj(d) || !Array.isArray(d.shots)) { bad.push(where); return; }
    if (d.shots.length > 5) bad.push(where + ".shots");
    d.shots.forEach(function (s, i) {
      if (!isObj(s) || typeof s.raw !== "number" || !isFinite(s.raw) || s.raw < 0 ||
          typeof s.rounded !== "number" || (s.source !== "laser" && s.source !== "manual")) {
        bad.push(where + ".shots[" + i + "]");
      }
    });
    if (d.ordered !== null && d.ordered !== undefined && typeof d.ordered !== "number") bad.push(where + ".ordered");
  }

  function projectTypeErrors(d) {
    var bad = [];
    ["id", "date"].forEach(function (k) { if (!isStr(d[k])) bad.push(k); });
    ["name", "client", "address", "notes", "measurer"].forEach(function (k) { if (!optStr(d[k])) bad.push(k); });
    if (UNITS.indexOf(d.unit) === -1) bad.push("unit");
    if (!Array.isArray(d.rooms)) { bad.push("rooms"); return bad; }
    d.rooms.forEach(function (r, ri) {
      var rw = "rooms[" + ri + "]";
      if (!isObj(r) || !isStr(r.id) || !isStr(r.name) || !Array.isArray(r.windows)) { bad.push(rw); return; }
      r.windows.forEach(function (w, wi) {
        var ww = rw + ".windows[" + wi + "]";
        if (!isObj(w) || !isStr(w.id) || !isStr(w.label)) { bad.push(ww); return; }
        checkDimension(w.width, ww + ".width", bad);
        checkDimension(w.height, ww + ".height", bad);
        if (w.depth !== null && w.depth !== undefined) checkDimension(w.depth, ww + ".depth", bad);
        if (w.mountType !== null && w.mountType !== undefined && MOUNT_TYPES.indexOf(w.mountType) === -1) bad.push(ww + ".mountType");
        if (w.controlSide !== undefined && CONTROL_SIDES.indexOf(w.controlSide) === -1) bad.push(ww + ".controlSide");
        if (w.controlType !== null && w.controlType !== undefined && CONTROL_TYPES.indexOf(w.controlType) === -1) bad.push(ww + ".controlType");
        if (!optStr(w.obstructions)) bad.push(ww + ".obstructions");
        if (!optStr(w.notes)) bad.push(ww + ".notes");
        if (w.photos !== undefined && !Array.isArray(w.photos)) bad.push(ww + ".photos");
        if (w.history !== undefined && !Array.isArray(w.history)) bad.push(ww + ".history");
      });
    });
    return bad;
  }

  var REQUIRED = {
    project: ["id", "date", "unit", "rooms"],
    profile: ["companyName", "columns"]
  };

  function profileTypeErrors(d) {
    var bad = [];
    if (!isStr(d.companyName)) bad.push("companyName");
    if (!Array.isArray(d.columns)) bad.push("columns");
    else d.columns.forEach(function (c, i) {
      if (!isObj(c) || !isStr(c.key) || !isStr(c.label)) bad.push("columns[" + i + "]");
    });
    ["subtitle", "terms", "measurerName"].forEach(function (k) { if (!optStr(d[k])) bad.push(k); });
    if (d.logo !== null && d.logo !== undefined && (!isObj(d.logo) || !isStr(d.logo.dataUrl))) bad.push("logo");
    ["showTotals", "showTerms", "showSignature", "lowInk"].forEach(function (k) {
      if (d[k] !== undefined && typeof d[k] !== "boolean") bad.push(k);
    });
    if (d.grouping !== undefined && d.grouping !== "room" && d.grouping !== "none") bad.push("grouping");
    return bad;
  }

  // Six ordered checks; first failure wins; never a partial import.
  // → { ok:true, type, data, file } | { ok:false, error }
  function validateImport(text) {
    var file;
    try { file = JSON.parse(text); } catch (e) { return { ok: false, error: "That file isn't valid JSON." }; }
    if (!isObj(file) || typeof file.schemaVersion !== "number" || !isFinite(file.schemaVersion)) {
      return { ok: false, error: "This file is missing a version and can't be read." };
    }
    if (file.schemaVersion > CURRENT_SCHEMA) return { ok: false, error: MSG_NEWER };
    if (file.type !== "project" && file.type !== "profile") return { ok: false, error: "Unrecognized file type." };
    var d = file.data;
    var missing = isObj(d) ? REQUIRED[file.type].filter(function (k) { return d[k] === undefined; })
                           : ["data"];
    if (missing.length) return { ok: false, error: "This file is missing required fields: " + missing.join(", ") + "." };
    var m = migrate(d, file.schemaVersion);
    if (!m.ok) return { ok: false, error: m.error };
    d = m.data;
    var bad = file.type === "project" ? projectTypeErrors(d) : profileTypeErrors(d);
    if (bad.length) return { ok: false, error: "Unexpected data in: " + bad.slice(0, 6).join(", ") + (bad.length > 6 ? "…" : "") + "." };
    return { ok: true, type: file.type, data: d, file: file };
  }

  function exportFile(type, data, extra) {
    var f = { schemaVersion: CURRENT_SCHEMA, type: type, exportedAt: new Date().toISOString(), data: data };
    if (extra) Object.keys(extra).forEach(function (k) { f[k] = extra[k]; });
    return JSON.stringify(f, null, 2);
  }

  // Fill defaults a well-formed but older/minimal record may lack.
  function normalizeProject(p) {
    p.name = p.name || ""; p.client = p.client || ""; p.address = p.address || "";
    p.notes = p.notes || ""; p.measurer = p.measurer || "";
    p.createdAt = p.createdAt || 0;
    p.rooms.forEach(function (r) {
      r.notes = r.notes || "";
      r.nextWindowNumber = r.nextWindowNumber || r.windows.length + 1;
      r.windows.forEach(function (w) {
        if (w.depth === undefined) w.depth = null;
        if (w.controlSide === undefined) w.controlSide = null;
        if (w.controlType === undefined) w.controlType = null;
        w.controlTypeOther = w.controlTypeOther || "";
        w.obstructions = w.obstructions || "";
        w.notes = w.notes || "";
        w.photos = w.photos || [];
        w.history = w.history || [];
        recomputeOrdered(w.width); recomputeOrdered(w.height); recomputeOrdered(w.depth);
      });
    });
    return p;
  }

  // --- database -------------------------------------------------------------

  var DB_NAME = "apex-measure-pro";
  var DB_VERSION = 1;
  var db = null;
  var memory = null;   // { projects: Map, kv: Map, photos: Map } when IndexedDB is unavailable

  function reqP(req) {
    return new Promise(function (res, rej) {
      req.onsuccess = function () { res(req.result); };
      req.onerror = function () { rej(req.error); };
    });
  }

  function useMemory() {
    db = null;
    memory = { projects: new Map(), kv: new Map(), photos: new Map() };
    return { persistent: false };
  }

  // → { persistent: boolean }
  function open(opts) {
    var idb = (opts && opts.indexedDB !== undefined) ? opts.indexedDB : root.indexedDB;
    if (opts && opts.name) DB_NAME = opts.name;
    if (!idb) return Promise.resolve(useMemory());
    return new Promise(function (resolve) {
      var done = false;
      var finish = function (r) { if (!done) { done = true; resolve(typeof r === "function" ? r() : r); } };
      try {
        var req = idb.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = function () {
          var d = req.result;
          if (!d.objectStoreNames.contains("projects")) d.createObjectStore("projects", { keyPath: "id" });
          if (!d.objectStoreNames.contains("kv")) d.createObjectStore("kv", { keyPath: "key" });
          if (!d.objectStoreNames.contains("photos")) d.createObjectStore("photos", { keyPath: "id" });
        };
        req.onsuccess = function () { db = req.result; memory = null; finish({ persistent: true }); };
        req.onerror = function () { finish(useMemory); };
        req.onblocked = function () { finish(useMemory); };
        setTimeout(function () { finish(useMemory); }, 4000);
      } catch (e) {
        finish(useMemory);
      }
    });
  }

  function tx(store, mode) { return db.transaction(store, mode).objectStore(store); }
  function clone(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }

  function rawAll(store) {
    if (memory) return Promise.resolve(Array.from(memory[store].values()).map(function (v) { return store === "photos" ? v : clone(v); }));
    return reqP(tx(store, "readonly").getAll());
  }
  function rawGet(store, key) {
    if (memory) { var v = memory[store].get(key); return Promise.resolve(store === "photos" ? v : clone(v)); }
    return reqP(tx(store, "readonly").get(key));
  }
  function rawPut(store, value, keyName) {
    if (memory) { memory[store].set(value[keyName], store === "photos" ? value : clone(value)); return Promise.resolve(); }
    return reqP(tx(store, "readwrite").put(value));
  }
  function rawDelete(store, key) {
    if (memory) { memory[store].delete(key); return Promise.resolve(); }
    return reqP(tx(store, "readwrite").delete(key));
  }

  // Load one stored record → { ok, project } | { ok:false, id, raw, error }.
  function loadRecord(rec) {
    try {
      if (!isObj(rec)) throw new Error("not an object");
      var m = migrate(rec, rec.schemaVersion);
      if (!m.ok) return { ok: false, id: rec.id, raw: rec, error: m.error };
      var bad = projectTypeErrors(m.data);
      if (bad.length) throw new Error("Unexpected data in: " + bad.slice(0, 4).join(", "));
      return { ok: true, project: normalizeProject(m.data) };
    } catch (e) {
      return { ok: false, id: rec && rec.id, raw: rec, error: "This project couldn't be loaded. Its raw data has been preserved." };
    }
  }

  function listProjects() {
    return rawAll("projects").then(function (recs) {
      var rows = recs.map(loadRecord);
      rows.sort(function (a, b) {
        var pa = a.ok ? a.project : a.raw || {}, pb = b.ok ? b.project : b.raw || {};
        var da = String(pa.date || ""), dbb = String(pb.date || "");
        if (da !== dbb) return da < dbb ? 1 : -1;
        return (pb.createdAt || 0) - (pa.createdAt || 0);
      });
      return rows;
    });
  }

  function getProject(id) { return rawGet("projects", id).then(function (r) { return r ? loadRecord(r) : null; }); }
  function saveProject(p) { return rawPut("projects", clone(p), "id"); }

  function deleteProject(id) {
    return rawGet("projects", id).then(function (rec) {
      var photoIds = [];
      try {
        (rec.rooms || []).forEach(function (r) { r.windows.forEach(function (w) { photoIds = photoIds.concat(w.photos || []); }); });
      } catch (e) { /* corrupted: still delete the record */ }
      return Promise.all(photoIds.map(function (pid) { return rawDelete("photos", pid); }))
        .then(function () { return rawDelete("projects", id); });
    });
  }

  function getKV(key) { return rawGet("kv", key).then(function (r) { return r ? r.value : undefined; }); }
  function setKV(key, value) { return rawPut("kv", { key: key, value: clone(value) }, "key"); }

  function putPhoto(rec) { return rawPut("photos", rec, "id"); }        // { id, projectId, windowId, blob, size }
  function getPhoto(id) { return rawGet("photos", id); }
  function deletePhoto(id) { return rawDelete("photos", id); }
  function allPhotos() { return rawAll("photos"); }

  function isPersistent() { return db !== null; }

  return {
    CURRENT_SCHEMA: CURRENT_SCHEMA,
    MIGRATIONS: MIGRATIONS,
    MOUNT_TYPES: MOUNT_TYPES,
    CONTROL_SIDES: CONTROL_SIDES,
    CONTROL_TYPES: CONTROL_TYPES,
    UNITS: UNITS,
    MSG_NEWER: MSG_NEWER,
    uid: uid,
    today: today,
    newProject: newProject,
    newRoom: newRoom,
    newWindow: newWindow,
    newDimension: newDimension,
    addWindow: addWindow,
    recomputeOrdered: recomputeOrdered,
    isWindowComplete: isWindowComplete,
    roomStats: roomStats,
    projectStats: projectStats,
    displayName: displayName,
    isLarge: isLarge,
    migrate: migrate,
    validateImport: validateImport,
    exportFile: exportFile,
    normalizeProject: normalizeProject,
    loadRecord: loadRecord,
    open: open,
    isPersistent: isPersistent,
    listProjects: listProjects,
    getProject: getProject,
    saveProject: saveProject,
    deleteProject: deleteProject,
    getKV: getKV,
    setKV: setKV,
    putPhoto: putPhoto,
    getPhoto: getPhoto,
    deletePhoto: deletePhoto,
    allPhotos: allPhotos
  };
});
