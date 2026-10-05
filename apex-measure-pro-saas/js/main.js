/*
 * main.js — wiring, view switching, rendering. The only module that touches
 * the DOM. Logic lives in the pure modules:
 *   ApexReduce (1/8" math + formats)   ApexCapture (arm/lock/advance)
 *   ApexStore (model + IndexedDB)      ApexProfile (sheet config)
 *   ApexSheet (xlsx / preview)         ApexBle (laser)
 */
(function () {
  "use strict";

  var R = window.ApexReduce, C = window.ApexCapture, S = window.ApexStore,
      P = window.ApexProfile, Sheet = window.ApexSheet, B = window.ApexBle;

  var X = window.ApexExt, CFG = window.ApexConfig || { VERSION: "2.0.0" };
  var VERSION = CFG.VERSION;
  var MAX_PHOTOS = 4;
  var PHOTO_EDGE = 1600, PHOTO_QUALITY = 0.75;
  var UNIT_NAMES = { "in": "Inches", ftin: "Feet-inches", cm: "Centimetres" };
  var CONTROL_TYPE_LABELS = {
    "cord loop": "Cord loop", "continuous cord loop": "Continuous cord loop", wand: "Wand",
    cordless: "Cordless", motorized: "Motorized", "top-down/bottom-up": "Top-down/bottom-up", other: "Other"
  };

  var app = {
    persistent: true,
    rows: [],                 // project list rows
    project: null,            // loaded project
    room: null, win: null,    // capture context
    capture: C.initialState(),
    answered: {},             // windowId → { controlSide: true } (explicit "n/a")
    laser: null,
    laserState: { status: "idle", message: "" },
    profile: P.defaultProfile(),
    profileEnabled: false,
    settings: { defaultUnit: "in" },
    largeWarned: {},
    ticker: null,
    captureDom: null,
    routeName: ""
  };

  // --- tiny DOM helpers ------------------------------------------------------

  function h(tag, props) {
    var node = document.createElement(tag);
    if (props) Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (v === null || v === undefined || v === false) return;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k === "html") node.innerHTML = v;
      else if (k.slice(0, 2) === "on") node.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === "value") node.value = v;
      else if (k === "checked") node.checked = v;
      else node.setAttribute(k, v === true ? "" : v);
    });
    for (var i = 2; i < arguments.length; i++) append(node, arguments[i]);
    return node;
  }
  function append(node, c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { append(node, x); }); return; }
    node.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function plural(n, w) { return n + " " + w + (n === 1 ? "" : "s"); }

  var ICONS = {
    back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
    home: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11l8-7 8 7M6 10v10h12V10"/></svg>',
    gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg>',
    trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/></svg>'
  };
  function iconBtn(icon, label, onclick) {
    return h("button", { class: "icon-btn", type: "button", "aria-label": label, html: ICONS[icon], onclick: onclick });
  }

  // --- announcements, snackbar ------------------------------------------------

  function announce(text) {
    var live = $("#live");
    live.textContent = "";
    setTimeout(function () { live.textContent = text; }, 30);
  }

  var snackTimer = null;
  function snack(text, opts) {
    opts = opts || {};
    var bar = $("#snackbar");
    clearTimeout(snackTimer);
    bar.innerHTML = "";
    var node = h("div", { class: "snack" + (opts.bad ? " snack-bad" : "") }, h("p", { text: text }));
    var done = false;
    var finish = function (undone) {
      if (done) return;
      done = true;
      bar.innerHTML = "";
      if (!undone && opts.onExpire) opts.onExpire();
    };
    if (opts.action) {
      node.appendChild(h("button", { class: "btn", type: "button", text: opts.action, onclick: function () {
        finish(true);
        opts.onAction();
      } }));
    }
    bar.appendChild(node);
    snackTimer = setTimeout(function () { finish(false); }, opts.timeout || (opts.action ? 5000 : 3000));
  }

  function confirmDialog(text, okLabel) {
    var dlg = $("#confirm");
    $("#confirm-text").textContent = text;
    $("#confirm-ok").textContent = okLabel || "Delete";
    return new Promise(function (resolve) {
      var onClose = function () { dlg.removeEventListener("close", onClose); resolve(dlg.returnValue === "ok"); };
      dlg.addEventListener("close", onClose);
      dlg.returnValue = "";
      if (dlg.showModal) dlg.showModal();
      else resolve(window.confirm(text));
    });
  }

  // --- storage wrappers -------------------------------------------------------

  function saveProject() {
    if (!app.project) return Promise.resolve();
    return S.saveProject(app.project).then(function () {
      if (X) X.fire(X.onProjectSaved, app.project);
    }).catch(function () {
      snack("Couldn't save — storage error. Export a backup.", { bad: true });
    });
  }

  function refreshRows() {
    return S.listProjects().then(function (rows) { app.rows = rows; }).catch(function () { app.rows = []; });
  }

  function loadProject(pid) {
    if (app.project && app.project.id === pid) return Promise.resolve(app.project);
    return S.getProject(pid).then(function (r) {
      if (!r || !r.ok) return null;
      app.project = r.project;
      return app.project;
    }).catch(function () { return null; });
  }

  function activeProfile() { return app.profileEnabled ? app.profile : P.defaultProfile(); }

  function saveProfile() {
    return Promise.all([S.setKV("profile", app.profile), S.setKV("profileEnabled", app.profileEnabled)])
      .catch(function () { snack("Couldn't save the profile.", { bad: true }); });
  }

  function warnIfLarge() {
    var p = app.project;
    if (p && !app.largeWarned[p.id] && S.isLarge(p)) {
      app.largeWarned[p.id] = true;
      snack("This project is large — export a backup.", { timeout: 5000 });
    }
  }

  // --- downloads (always the LAST step: a download can background the tab) --

  function download(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = h("a", { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 4000);
  }

  function blobToDataUrl(blob) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
      r.readAsDataURL(blob);
    });
  }
  function dataUrlToBlob(u) {
    var parts = String(u).split(",");
    var mime = (/data:([^;]+)/.exec(parts[0]) || [])[1] || "application/octet-stream";
    var bin = atob(parts[1] || "");
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  function photoIdsOf(p) {
    var ids = [];
    p.rooms.forEach(function (r) { r.windows.forEach(function (w) { ids = ids.concat(w.photos || []); }); });
    return ids;
  }

  function exportBackup(p) {
    return Promise.all(photoIdsOf(p).map(function (id) {
      return S.getPhoto(id).then(function (rec) {
        return rec ? blobToDataUrl(rec.blob).then(function (d) { return { id: id, windowId: rec.windowId, dataUrl: d }; }) : null;
      });
    })).then(function (photos) {
      var text = S.exportFile("project", p, { photos: photos.filter(Boolean) });
      var name = "apex-project-" + (p.client || p.name || "job").toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + p.date + ".json";
      download(new Blob([text], { type: "application/json;charset=utf-8" }), name);
    });
  }

  function downloadRaw(row) {
    var text = JSON.stringify(row.raw, null, 2);
    download(new Blob([text], { type: "application/json;charset=utf-8" }), "apex-raw-" + (row.id || "project") + ".json");
  }

  // --- theme --------------------------------------------------------------------

  function readToken(name, lightOnly) {
    var probe = h("div", { "data-theme": lightOnly ? "light" : null, style: "display:none" });
    document.body.appendChild(probe);
    var v = getComputedStyle(lightOnly ? probe : document.documentElement).getPropertyValue(name).trim();
    probe.remove();
    return v;
  }
  function readPalette() {
    return {
      paper: readToken("--paper", true), ink: readToken("--ink", true), ink2: readToken("--ink-2", true),
      ink3: readToken("--ink-3", true), rule: readToken("--rule", true), ruleStrong: readToken("--rule-strong", true)
    };
  }
  function syncThemeColor() {
    var meta = $('meta[name="theme-color"]');
    if (!meta) { meta = h("meta", { name: "theme-color" }); document.head.appendChild(meta); }
    // A brand layer may set --theme-color (e.g. a dark app bar); otherwise match the page.
    meta.setAttribute("content", readToken("--theme-color", false) || readToken("--paper", false));
  }
  function getTheme() { try { return localStorage.getItem("apex-theme") || "system"; } catch (e) { return "system"; } }
  function setTheme(t) {
    try { if (t === "system") localStorage.removeItem("apex-theme"); else localStorage.setItem("apex-theme", t); } catch (e) { /* per-viewer only */ }
    if (t === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", t);
    syncThemeColor();
  }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }

  // --- banners (global) ---------------------------------------------------------

  var dismissedStorageBanner = false;
  function renderBanners() {
    var box = $("#banners");
    box.innerHTML = "";
    if (!app.persistent && !dismissedStorageBanner) {
      box.appendChild(h("div", { class: "banner banner-bad", role: "status" },
        h("p", { text: "Storage unavailable — this session won't be saved. Export before closing." }),
        h("button", { class: "btn btn-ghost", type: "button", text: "Dismiss", onclick: function () { dismissedStorageBanner = true; renderBanners(); } })));
    }
    if (app.laserState.status === "unsupported" && !app.laserState.message && lsGet("apex-bt-notice") !== "dismissed") {
      box.appendChild(h("div", { class: "banner", role: "status" },
        h("p", { text: "Laser capture needs Android or desktop Chrome/Edge. Everything else works here — type measurements in by hand." }),
        h("button", { class: "btn btn-ghost", type: "button", text: "Dismiss", onclick: function () { lsSet("apex-bt-notice", "dismissed"); renderBanners(); } })));
    }
  }

  // --- app bar ------------------------------------------------------------------

  function setBar(opts) {
    var bar = $("#appbar");
    bar.innerHTML = "";
    if (opts.home) {
      bar.appendChild(h("span", { class: "wordmark", text: "APEX MEASURE PRO" }));
      bar.appendChild(iconBtn("gear", "Settings", function () { go("#/settings"); }));
      return;
    }
    bar.appendChild(iconBtn("back", "Back", function () { go(opts.back || "#/"); }));
    bar.appendChild(h("h1", { class: "title", text: opts.title || "" }));
    (opts.actions || []).forEach(function (a) { bar.appendChild(a); });
    bar.appendChild(iconBtn("home", "Home", function () { go("#/"); }));
  }

  // "Export" in the app bar on the room and window screens, so it's always one tap away.
  function exportAction(p) {
    return h("button", { class: "icon-btn", type: "button", text: "Export", "aria-label": "Export sheet",
      onclick: function () { go("#/p/" + p.id + "/export"); } });
  }

  function mount(node) {
    var view = $("#view");
    view.innerHTML = "";
    view.appendChild(node);
  }

  // --- extension context (see js/ext.js) ------------------------------------------

  function ctx() {
    var c = {
      h: h, mount: mount, setBar: setBar, snack: snack, go: go, announce: announce,
      confirmDialog: confirmDialog, S: S, R: R, C: C, app: app, dispatch: dispatch,
      laser: function () { return app.laser; }, saveProject: saveProject, iconBtn: iconBtn, config: CFG
    };
    if (X) X.ctx = c;
    return c;
  }

  // --- routing -------------------------------------------------------------------

  function go(hash) {
    if (location.hash === hash) route();
    else location.hash = hash;
  }

  function parseRoute() {
    var parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
    if (!parts.length) return { name: "home" };
    if (parts[0] === "new") return { name: "new" };
    if (parts[0] === "settings") return { name: "settings" };
    if (parts[0] === "profile") return { name: "profile" };
    if (parts[0] === "p" && parts[1]) {
      var r = { pid: decodeURIComponent(parts[1]) };
      if (parts[2] === "export") { r.name = "export"; return r; }
      if (parts[2] === "r" && parts[3]) {
        r.rid = decodeURIComponent(parts[3]);
        if (parts[4] === "w" && parts[5]) { r.name = "capture"; r.wid = decodeURIComponent(parts[5]); return r; }
        r.name = "room";
        return r;
      }
      r.name = "project";
      return r;
    }
    var extra = X && X.parseRoute(parts);
    if (extra) return extra;
    return { name: "home" };
  }

  function leaveCapture() {
    if (app.capture.armed) dispatch({ type: "disarm" }, { quiet: true });
    app.capture = C.initialState();
    stopTicker();
    app.captureDom = null;
    app.win = null;
    app.room = null;
  }

  function route() {
    var r = parseRoute();
    if (app.routeName === "capture") leaveCapture();
    document.body.classList.toggle("printing", r.name === "export");
    document.body.setAttribute("data-route", r.name);   // brand layer hook
    app.routeName = r.name;
    if (X && X.runGates) {
      X.runGates(r, ctx()).then(function (ok) { if (ok) renderRoute(r); });
    } else renderRoute(r);
  }

  function renderRoute(r) {
    var done;
    switch (r.name) {
      case "new": done = Promise.resolve(viewNew()); break;
      case "settings": done = viewSettings(); break;
      case "profile": done = Promise.resolve(viewProfile()); break;
      case "project": done = withProject(r, viewProject); break;
      case "export": done = withProject(r, viewExport); break;
      case "room": done = withProject(r, viewRoom); break;
      case "capture": done = withProject(r, viewCapture); break;
      default:
        if (X && X.routes[r.name]) { try { done = X.routes[r.name](r, ctx()); } catch (e) { console.error(e); done = viewHome(); } }
        else done = viewHome();
    }
    Promise.resolve(done).then(function () { window.scrollTo(0, 0); });
  }

  function withProject(r, fn) {
    return loadProject(r.pid).then(function (p) {
      if (!p) { viewMissing(); return; }
      var room = r.rid ? p.rooms.filter(function (x) { return x.id === r.rid; })[0] : null;
      if (r.rid && !room) { go("#/p/" + p.id); return; }
      var win = r.wid && room ? room.windows.filter(function (x) { return x.id === r.wid; })[0] : null;
      if (r.wid && !win) { go("#/p/" + p.id + "/r/" + room.id); return; }
      fn(p, room, win);
    });
  }

  function viewMissing() {
    setBar({ title: "Not found" });
    mount(h("div", { class: "stack" },
      h("p", { text: "This project couldn't be loaded. Its raw data has been preserved." }),
      h("button", { class: "btn", type: "button", text: "Back to projects", onclick: function () { go("#/"); } })));
  }

  // --- swipe to delete ----------------------------------------------------------

  function swipeable(row, onSwipe) {
    var x0 = null, y0 = null, dx = 0, tracking = false;
    row.addEventListener("pointerdown", function (e) { x0 = e.clientX; y0 = e.clientY; dx = 0; tracking = true; });
    row.addEventListener("pointermove", function (e) {
      if (!tracking || x0 === null) return;
      dx = e.clientX - x0;
      if (Math.abs(e.clientY - y0) > 24 && Math.abs(dx) < 24) { tracking = false; row.style.transform = ""; return; }
      if (dx < -8) { row.classList.add("swiping"); row.style.transform = "translateX(" + Math.max(dx, -96) + "px)"; }
    });
    var end = function () {
      if (!tracking) return;
      tracking = false;
      row.classList.remove("swiping");
      row.style.transform = "";
      if (dx < -72) {
        row.dataset.swiped = "1";
        setTimeout(function () { delete row.dataset.swiped; }, 400);
        onSwipe();
      }
    };
    row.addEventListener("pointerup", end);
    row.addEventListener("pointercancel", function () { tracking = false; row.style.transform = ""; });
    // swallow the click that ends a swipe
    row.addEventListener("click", function (e) { if (row.dataset.swiped) { e.stopPropagation(); e.preventDefault(); } }, true);
  }

  // === HOME ==========================================================================

  function viewHome() {
    setBar({ home: true });
    app.project = null;
    return Promise.all([refreshRows(), S.getKV("profile").catch(function () { return null; })]).then(function (res) {
      var hasProfile = Boolean(res[1]);
      if (!app.rows.length && !hasProfile) {
        mount(h("div", { class: "empty" },
          h("p", { class: "lede", text: "Measure a window, get a sheet." }),
          h("ol", { class: "explainer", "aria-label": "How it works" },
            h("li", null, h("strong", { text: "Start a project. " }), "Name the job, then add rooms and windows."),
            h("li", null, h("strong", { text: "Measure each window. " }), "Shoot it with a Bluetooth laser, say it out loud, or type it. Spoken values are read back for you to confirm. Everything locks to the nearest 1/8″, rounded down, never up."),
            h("li", null, h("strong", { text: "Send the sheet. " }), "Export a branded Excel or PDF order sheet. Works offline in the field.")),
          X ? X.collect(X.homeBlocks, ctx()) : null,
          h("div", { class: "form-grid" },
            h("button", { class: "btn btn-primary btn-block", type: "button", text: "New Project", onclick: function () { go("#/new"); } }),
            h("button", { class: "btn btn-block", type: "button", text: "Set Up Company Profile", onclick: function () { go("#/profile"); } }))));
        return;
      }
      var list = h("ul", { class: "list", "aria-label": "Projects" });
      app.rows.forEach(function (row) { list.appendChild(projectRow(row)); });
      mount(h("div", null,
        X ? X.collect(X.homeBlocks, ctx()) : null,
        h("button", { class: "btn btn-primary btn-block", type: "button", text: "New Project", onclick: function () { go("#/new"); } }),
        h("div", { class: "section" }, h("div", { class: "section-head" }, h("span", { class: "label", text: "Projects" })), list)));
    });
  }

  function projectRow(row) {
    if (!row.ok) {
      var raw = row.raw || {};
      return h("li", { class: "list-row row-error" },
        h("div", { class: "row-main" },
          h("span", { class: "row-title", text: (raw.client || raw.name || raw.date || "Project") + " — unreadable" }),
          h("span", { class: "row-sub", text: row.error })),
        h("button", { class: "btn", type: "button", text: "Download raw data", onclick: function () { downloadRaw(row); } }));
    }
    var p = row.project, st = S.projectStats(p);
    var li = h("li", { class: "list-row" },
      h("button", { class: "row-main", type: "button", onclick: function () { app.project = p; go("#/p/" + p.id); } },
        h("span", { class: "row-title", text: S.displayName(p) }),
        h("span", { class: "row-sub num", text: p.date + " · " + plural(st.rooms, "room") + " · " + plural(st.windows, "window") +
          (st.windows ? " · " + st.complete + " complete" : "") })),
      iconBtn("trash", "Delete project " + S.displayName(p), function () { deleteProject(p); }));
    swipeable(li, function () { deleteProject(p); });
    return li;
  }

  function deleteProject(p) {
    var st = S.projectStats(p);
    confirmDialog("Delete project? This removes " + plural(st.windows, "window") + " and all photos.").then(function (ok) {
      if (!ok) return;
      S.deleteProject(p.id).then(function () {
        if (app.project && app.project.id === p.id) app.project = null;
        snack("Project deleted.");
        viewHome();
      });
    });
  }

  // === NEW PROJECT ======================================================================

  function unitSegment(current, onPick) {
    var seg = h("div", { class: "segmented", role: "group", "aria-label": "Unit" });
    S.UNITS.forEach(function (u) {
      seg.appendChild(h("button", { type: "button", "aria-pressed": String(u === current), text: UNIT_NAMES[u], onclick: function () {
        Array.prototype.forEach.call(seg.children, function (b) { b.setAttribute("aria-pressed", "false"); });
        this.setAttribute("aria-pressed", "true");
        onPick(u);
      } }));
    });
    return seg;
  }

  function textField(label, value, oninput, opts) {
    opts = opts || {};
    var id = "f-" + Math.random().toString(36).slice(2, 8);
    var input = opts.multiline
      ? h("textarea", { class: "textarea", id: id, value: value || "", oninput: function () { oninput(this.value); } })
      : h("input", { class: "input", id: id, type: opts.type || "text", value: value || "", autocomplete: "off",
          inputmode: opts.inputmode, oninput: function () { oninput(this.value); } });
    if (opts.multiline) input.value = value || "";
    return h("div", { class: "field" }, h("label", { class: "label", for: id, text: label }), input);
  }

  function viewNew() {
    setBar({ title: "New Project", back: "#/" });
    var f = { client: "", address: "", date: S.today(), unit: app.settings.defaultUnit || "in", notes: "" };
    mount(h("form", { class: "form-grid", onsubmit: function (e) {
      e.preventDefault();
      var p = S.newProject({ client: f.client.trim(), address: f.address.trim(), date: f.date || S.today(), unit: f.unit,
        notes: f.notes, measurer: app.profile && app.profile.measurerName || "" });
      app.project = p;
      saveProject().then(function () { go("#/p/" + p.id + "/r/" + p.rooms[0].id); });
    } },
      textField("Client (optional)", "", function (v) { f.client = v; }),
      textField("Address (optional)", "", function (v) { f.address = v; }),
      textField("Date", f.date, function (v) { f.date = v; }, { type: "date" }),
      h("div", { class: "field" }, h("span", { class: "label", text: "Unit" }), unitSegment(f.unit, function (u) { f.unit = u; })),
      textField("Notes (optional)", "", function (v) { f.notes = v; }, { multiline: true }),
      h("button", { class: "btn btn-primary btn-block", type: "submit", text: "Create and start measuring" })));
  }

  // === PROJECT DETAIL ======================================================================

  var saveSoon = (function () {
    var t = null;
    return function () { clearTimeout(t); t = setTimeout(saveProject, 300); };
  })();

  function completeLine(done, total) {
    return h("p", { class: "complete num" }, h("strong", { text: String(done) }), " of " + total + " windows complete");
  }

  function viewProject(p) {
    setBar({ title: S.displayName(p), back: "#/" });
    var st = S.projectStats(p);
    var rooms = h("ul", { class: "list", "aria-label": "Rooms" });
    p.rooms.forEach(function (room) {
      var rs = S.roomStats(room);
      rooms.appendChild(h("li", { class: "list-row" },
        h("button", { class: "row-main", type: "button", onclick: function () { go("#/p/" + p.id + "/r/" + room.id); } },
          h("span", { class: "row-title", text: room.name }),
          h("span", { class: "row-sub num", text: rs.complete + " of " + rs.total + " windows complete" }))));
    });
    var details = h("div", { class: "form-grid" },
      textField("Client", p.client, function (v) { p.client = v; saveSoon(); }),
      textField("Address", p.address, function (v) { p.address = v; saveSoon(); }),
      textField("Date", p.date, function (v) { p.date = v || S.today(); saveSoon(); }, { type: "date" }),
      textField("Job reference", p.name, function (v) { p.name = v; saveSoon(); }),
      textField("Measurer", p.measurer, function (v) { p.measurer = v; saveSoon(); }),
      h("div", { class: "field" }, h("span", { class: "label", text: "Unit (display only — never changes a recorded measurement)" }),
        unitSegment(p.unit, function (u) { p.unit = u; saveProject(); })),
      textField("Notes", p.notes, function (v) { p.notes = v; saveSoon(); }, { multiline: true }));

    mount(h("div", null,
      completeLine(st.complete, st.windows),
      h("div", { class: "row-actions", style: "margin-top:12px" },
        h("button", { class: "btn btn-primary", type: "button", text: "Export sheet", onclick: function () { go("#/p/" + p.id + "/export"); } })),
      h("div", { class: "section" },
        h("div", { class: "section-head" }, h("span", { class: "label", text: "Rooms" })),
        rooms,
        h("button", { class: "btn btn-block", type: "button", style: "margin-top:12px", text: "Add Room", onclick: function () {
          var room = S.newRoom("Room " + (p.rooms.length + 1));
          p.rooms.push(room);
          saveProject().then(function () { warnIfLarge(); go("#/p/" + p.id + "/r/" + room.id); });
        } })),
      h("div", { class: "section" },
        h("div", { class: "section-head" }, h("span", { class: "label", text: "Project details" })),
        details),
      h("div", { class: "section" },
        h("div", { class: "section-head" }, h("span", { class: "label", text: "Backup" })),
        h("div", { class: "row-actions" },
          h("button", { class: "btn", type: "button", text: "Export backup (.json)", onclick: function () {
            saveProject().then(function () { return exportBackup(p); });
          } }),
          h("button", { class: "btn btn-danger", type: "button", text: "Delete project", onclick: function () {
            var s2 = S.projectStats(p);
            confirmDialog("Delete project? This removes " + plural(s2.windows, "window") + " and all photos.").then(function (ok) {
              if (!ok) return;
              S.deleteProject(p.id).then(function () { app.project = null; snack("Project deleted."); go("#/"); });
            });
          } })))));
  }

  // === ROOM DETAIL ============================================================================

  function windowSummary(w, unit) {
    var parts = [];
    parts.push((w.width.ordered !== null ? R.formatLength(w.width.ordered, unit) : "—") + " × " +
      (w.height.ordered !== null ? R.formatLength(w.height.ordered, unit) : "—"));
    if (w.mountType) parts.push(w.mountType);
    return parts.join(" · ");
  }

  function viewRoom(p, room) {
    setBar({ title: room.name, back: "#/p/" + p.id, actions: [exportAction(p)] });
    var rs = S.roomStats(room);
    var list = h("ul", { class: "list", "aria-label": "Windows" });
    room.windows.forEach(function (w) {
      var done = S.isWindowComplete(w);
      var li = h("li", { class: "list-row" },
        h("button", { class: "row-main", type: "button", onclick: function () { go(captureHash(p, room, w)); } },
          h("span", { class: "row-title" }, w.label, done ? h("span", { class: "check", "aria-label": " complete", text: "  ✓" }) : null),
          h("span", { class: "row-sub measurement", text: windowSummary(w, p.unit) })),
        iconBtn("trash", "Delete window " + w.label, function () { deleteWindow(p, room, w); }));
      swipeable(li, function () { deleteWindow(p, room, w); });
      list.appendChild(li);
    });
    mount(h("div", null,
      completeLine(rs.complete, rs.total),
      h("button", { class: "btn btn-primary btn-block", type: "button", style: "margin-top:12px", text: "Add Window", onclick: function () {
        var w = S.addWindow(room);
        saveProject().then(function () { warnIfLarge(); go(captureHash(p, room, w)); });
      } }),
      h("div", { class: "section" },
        h("div", { class: "section-head" }, h("span", { class: "label", text: "Windows" })),
        room.windows.length ? list : h("p", { class: "muted", text: "No windows yet." })),
      h("div", { class: "section form-grid" },
        h("div", { class: "section-head" }, h("span", { class: "label", text: "Room" })),
        textField("Room name", room.name, function (v) { room.name = v || "Room"; $(".appbar .title").textContent = room.name; saveSoon(); }),
        textField("Room notes", room.notes, function (v) { room.notes = v; saveSoon(); }, { multiline: true }),
        h("button", { class: "btn btn-danger", type: "button", text: "Delete room", onclick: function () { deleteRoom(p, room); } }))));
  }

  function captureHash(p, room, w) { return "#/p/" + p.id + "/r/" + room.id + "/w/" + w.id; }

  function purgePhotos(ids) { ids.forEach(function (id) { S.deletePhoto(id).catch(function () {}); }); }

  function deleteWindow(p, room, w) {
    confirmDialog("Delete window " + w.label + "?").then(function (ok) {
      if (!ok) return;
      var snapshot = clone(p);
      room.windows = room.windows.filter(function (x) { return x.id !== w.id; });
      saveProject().then(function () {
        if (app.routeName === "capture") go("#/p/" + p.id + "/r/" + room.id); else viewRoom(p, room);
        snack("Window " + w.label + " deleted.", {
          action: "Undo",
          onAction: function () { restore(snapshot); },
          onExpire: function () { purgePhotos(w.photos || []); }
        });
      });
    });
  }

  function deleteRoom(p, room) {
    confirmDialog("Delete room and " + plural(room.windows.length, "window") + "?").then(function (ok) {
      if (!ok) return;
      var snapshot = clone(p);
      var ids = [];
      room.windows.forEach(function (w) { ids = ids.concat(w.photos || []); });
      p.rooms = p.rooms.filter(function (x) { return x.id !== room.id; });
      saveProject().then(function () {
        go("#/p/" + p.id);
        snack("Room " + room.name + " deleted.", {
          action: "Undo",
          onAction: function () { restore(snapshot); },
          onExpire: function () { purgePhotos(ids); }
        });
      });
    });
  }

  function restore(snapshot) {
    app.project = S.normalizeProject(snapshot);
    saveProject().then(route);
  }

  // === CAPTURE ================================================================================

  function dimOf(w, dim) { return w[dim]; }

  function isFilled(field) {
    var w = app.win;
    if (!w) return false;
    var shot = C.parseShot(field);
    if (shot) { var d = dimOf(w, shot.dim); return Boolean(d && d.shots.length > shot.slot); }
    if (field === "controlSide") return w.controlSide !== null || Boolean(app.answered[w.id] && app.answered[w.id].controlSide);
    if (field === "controlType") return Boolean(w.controlType);
    return Boolean(w[field]);
  }

  function firstUnfilled() {
    for (var i = 0; i < C.SEQUENCE.length; i++) if (!isFilled(C.SEQUENCE[i])) return C.SEQUENCE[i];
    return null;
  }

  function viewCapture(p, room, w) {
    app.room = room;
    app.win = w;
    app.capture = C.initialState();
    var idx = room.windows.indexOf(w);
    var prev = room.windows[idx - 1], next = room.windows[idx + 1];
    setBar({ title: room.name + " · " + w.label, back: "#/p/" + p.id + "/r/" + room.id, actions: [exportAction(p)] });

    var dom = app.captureDom = {};
    dom.laser = h("div", { class: "laser-area" });
    dom.complete = h("span", { class: "complete" });
    dom.dims = {};
    ["width", "height", "depth"].forEach(function (d) { dom.dims[d] = h("section", { class: "dim", "aria-label": d }); });

    var labelInput = h("input", { class: "input", value: w.label, "aria-label": "Window label", autocomplete: "off",
      oninput: function () { w.label = this.value || w.label; saveSoon(); } });

    // Mount
    dom.mount = choiceGroup("mountType", "Mount", [["IB", "IB — inside"], ["OB", "OB — outside"]], function () { return w.mountType; });
    dom.side = choiceGroup("controlSide", "Control side", [["left", "Left"], ["right", "Right"], [null, "N/A"]],
      function () { return w.controlSide === null && !(app.answered[w.id] && app.answered[w.id].controlSide) ? undefined : w.controlSide; });

    // Control type
    var typeSelect = h("select", { class: "select", id: "f-controlType", "data-field": "controlType",
      onfocus: function () { armIfNeeded("controlType"); },
      onchange: function () {
        var v = this.value || null;
        otherWrap.hidden = v !== "other";
        dispatch({ type: "set", field: "controlType", value: v });
      } },
      h("option", { value: "", text: "—" }),
      S.CONTROL_TYPES.map(function (t) { return h("option", { value: t, text: CONTROL_TYPE_LABELS[t] || t }); }));
    typeSelect.value = w.controlType || "";
    var otherWrap = h("div", { style: "margin-top:6px" },
      textField("Other control type", w.controlTypeOther, function (v) { w.controlTypeOther = v; saveSoon(); }));
    otherWrap.hidden = w.controlType !== "other";
    dom.type = h("div", { class: "choice", "data-block": "controlType" },
      h("label", { class: "label", for: "f-controlType", text: "Control type" }), typeSelect, otherWrap);

    dom.obst = textBlock("obstructions", "Obstructions (optional)", false);
    dom.notes = textBlock("notes", "Notes (optional)", true);
    dom.photos = h("section", { class: "section" });
    dom.trigger = h("div");
    dom.tools = h("div", { class: "capture-tools" }, X ? X.collect(X.captureTools, ctx()) : null);

    var view = h("div", null,
      dom.laser,
      h("div", { class: "win-head" },
        labelInput,
        h("span", { class: "spacer" }),
        dom.complete),
      dom.trigger,
      dom.tools,
      dom.dims.width, dom.dims.height, dom.dims.depth,
      dom.mount, dom.side, dom.type, dom.obst, dom.notes,
      dom.photos,
      h("div", { class: "section row-actions" },
        prev ? h("button", { class: "btn", type: "button", text: "‹ " + prev.label, onclick: function () { go(captureHash(p, room, prev)); } }) : null,
        h("button", { class: "btn btn-ghost", type: "button", text: "Delete window " + w.label, onclick: function () { deleteWindow(p, room, w); } })),
      h("div", { class: "next-bar" },
        h("button", { class: "btn btn-primary", type: "button", text: next ? "Next window › " + next.label : "Next window ›",
          onclick: function () { dispatch({ type: "disarm" }, { quiet: true }); goNextWindow(); } })));
    mount(view);
    updateCapture();
    renderLaserArea();
    renderPhotos();
    // Entering an incomplete window arms its first empty field (one less tap).
    if (!S.isWindowComplete(w)) {
      var f = firstUnfilled();
      if (f) dispatch({ type: "arm", field: f }, { focus: false });
    }
  }

  function choiceGroup(field, label, options, getValue) {
    var wrap = h("div", { class: "choice", "data-block": field, role: "group", "aria-label": label },
      h("span", { class: "label", text: label }));
    var seg = h("div", { class: "segmented" });
    options.forEach(function (o) {
      seg.appendChild(h("button", { type: "button", "data-field": field, "data-value": o[0] === null ? "" : o[0], text: o[1],
        onclick: function () {
          if (field === "controlSide" && o[0] === null) {
            app.answered[app.win.id] = app.answered[app.win.id] || {};
            app.answered[app.win.id].controlSide = true;
          }
          dispatch({ type: "set", field: field, value: o[0] });
        } }));
    });
    wrap.appendChild(seg);
    wrap._get = getValue;
    return wrap;
  }

  function textBlock(field, label, multiline) {
    var id = "f-" + field;
    var input = multiline
      ? h("textarea", { class: "textarea", id: id, "data-field": field })
      : h("input", { class: "input", id: id, "data-field": field, autocomplete: "off", enterkeyhint: "next" });
    input.value = app.win[field] || "";
    input.addEventListener("focus", function () { armIfNeeded(field); });
    input.addEventListener("input", function () { app.win[field] = input.value; saveSoon(); });
    if (!multiline) input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); dispatch({ type: "set", field: field, value: input.value }); }
    });
    // Multiline notes have no Enter-to-finish (Enter is a new line), so give them an explicit Done.
    var done = multiline ? h("button", { class: "btn btn-block notes-done", type: "button", text: "Done",
      onclick: function () {
        // Save, drop the keyboard, disarm — but do NOT auto-advance (that would silently create a blank window).
        app.win[field] = input.value; saveProject();
        input.blur(); dispatch({ type: "disarm" }, { quiet: true });
        snack("Notes saved.");
        var nb = document.querySelector(".next-bar");
        if (nb && nb.scrollIntoView) nb.scrollIntoView({ block: "end", behavior: "smooth" });
      } }) : null;
    return h("div", { class: "choice", "data-block": field }, h("label", { class: "label", for: id, text: label }), input, done);
  }

  function armIfNeeded(field) {
    if (app.capture.armed !== field) dispatch({ type: "arm", field: field }, { focus: false });
  }

  // Tapping an empty slot always arms the next free slot, so shots stay dense.
  function armSlot(dim, slot) {
    var d = dimOf(app.win, dim);
    if (!d) return;
    if (slot >= R.MAX_SHOTS) { snack("Maximum " + R.MAX_SHOTS + " shots per dimension."); return; }
    var target = slot < d.shots.length ? slot : d.shots.length;
    if (target >= R.MAX_SHOTS) { snack("Maximum " + R.MAX_SHOTS + " shots per dimension."); return; }
    dispatch({ type: "arm", field: dim + "." + target });
  }

  var DIM_TITLES = { width: "Width", height: "Height", depth: "Depth" };

  function buildDim(dim) {
    var p = app.project, w = app.win, d = dimOf(w, dim);
    var node = app.captureDom.dims[dim];
    var hadFocus = node.contains(document.activeElement) && document.activeElement.id === "manual";
    node.innerHTML = "";
    if (dim === "depth" && !d) {
      node.appendChild(h("button", { class: "btn", type: "button", text: "+ Depth", onclick: function () {
        w.depth = S.newDimension();
        saveProject();
        updateCapture();
        dispatch({ type: "arm", field: "depth.0" });
      } }));
      return;
    }
    var armed = C.parseShot(app.capture.armed);
    var armedHere = armed && armed.dim === dim;
    var win = R.winningIndex(d.shots);
    node.appendChild(h("div", { class: "dim-head" },
      h("span", { class: "label", text: DIM_TITLES[dim] }),
      h("span", { class: "hero measurement" + (d.ordered === null ? " empty-val" : ""),
        "aria-label": DIM_TITLES[dim] + " ordered " + (d.ordered === null ? "not measured" : R.speakInches(d.ordered, p.unit)),
        text: d.ordered === null ? "—" : R.formatLength(d.ordered, p.unit) })));
    if (dim === "depth") {
      node.querySelector(".dim-head").appendChild(h("button", { class: "link-btn", type: "button", text: "Remove", onclick: function () {
        var snapshot = clone(w.depth);
        if (app.capture.armed && app.capture.armed.indexOf("depth.") === 0) dispatch({ type: "disarm" }, { quiet: true });
        w.depth = null;
        saveProject(); updateCapture();
        if (snapshot.shots.length) snack("Depth removed.", { action: "Undo", onAction: function () { w.depth = snapshot; saveProject(); updateCapture(); } });
      } }));
    }

    var n = Math.max(C.SHOT_SLOTS, d.shots.length);
    var slots = h("div", { class: "slots" + (n > 3 ? " five" : "") });
    for (var i = 0; i < n; i++) slots.appendChild(slotButton(dim, d, i, win, armed));
    if (d.shots.length >= C.SHOT_SLOTS) {
      if (armedHere && armed.slot === d.shots.length) slots.appendChild(slotButton(dim, d, d.shots.length, win, armed));
      else slots.appendChild(h("button", { class: "slot slot-add", type: "button", "data-field": dim + "." + d.shots.length,
        text: "+ Shot", "aria-label": "Add " + DIM_TITLES[dim].toLowerCase() + " shot", onclick: function () { armSlot(dim, d.shots.length); } }));
    }
    node.appendChild(slots);

    var v = R.variance(d.shots);
    if (v.advisory) node.appendChild(h("p", { class: "advisory measurement", role: "note", style: "margin-top:8px", text: v.text }));

    if (armedHere) node.appendChild(armedPanel(dim, d, armed.slot));
    if (hadFocus && $("#manual")) $("#manual").focus();
  }

  function slotButton(dim, d, i, win, armed) {
    var s = d.shots[i];
    var isArmed = armed && armed.dim === dim && armed.slot === i;
    var isMin = i === win && d.shots.length > 1;
    var cls = "slot" + (s ? " locked" : "") + (isMin ? " winner" : "") + (isArmed ? " armed" : "");
    var label = isArmed ? "ARMED — SHOOT" : "SHOT " + (i + 1);
    var tags = [isMin ? "smallest" : "", s && s.source === "manual" ? "typed" : ""].filter(Boolean).join(" · ");
    var valText = s ? R.formatLength(s.rounded, app.project.unit) : "—";
    return h("button", { class: cls, type: "button", "data-field": dim + "." + i,
      "aria-label": DIM_TITLES[dim] + " shot " + (i + 1) + ": " + (s ? R.speakInches(s.rounded, app.project.unit) + (s.source === "manual" ? ", typed" : ", laser") + (isMin ? ", smallest" : "") : "empty") + (isArmed ? ", armed" : ""),
      onclick: function () { armSlot(dim, i); } },
      h("span", { class: "label", text: label }),
      h("span", { class: "val measurement" + (s ? "" : " none"), text: valText }),
      tags ? h("span", { class: "src", text: tags }) : null);
  }

  function armedPanel(dim, d, slot) {
    var unit = app.project.unit;
    var pending = app.capture.pending;
    var panel = h("div", { class: "armed-panel", "aria-label": "Armed field" });
    panel.appendChild(h("span", { class: "armed-label", text: "ARMED — SHOOT · " + C.fieldLabel(dim + "." + slot) }));
    panel.appendChild(h("div", { class: "live measurement" + (pending ? "" : " waiting"), id: "live-value",
      text: pending ? R.formatLength(pending.value, unit) : "Waiting for reading…" }));
    panel.appendChild(h("div", { class: "countdown", "aria-hidden": "true" }, h("i", { id: "countdown" })));

    var manual = h("input", { class: "input measurement", id: "manual", autocomplete: "off", enterkeyhint: "done",
      inputmode: unit === "cm" ? "decimal" : "text",
      placeholder: unit === "cm" ? "Type cm, e.g. 88.9" : unit === "ftin" ? "Type, e.g. 2' 10 7/8" : "Type, e.g. 34 7/8",
      "aria-label": "Type " + C.fieldLabel(dim + "." + slot).toLowerCase() + " in " + UNIT_NAMES[unit].toLowerCase() });
    manual.addEventListener("input", function () {
      dispatch({ type: "keystroke", value: R.parseManual(manual.value, unit) }, { quiet: true });
    });
    manual.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); commitTyped(); }
    });
    manual.addEventListener("blur", function (e) {
      // Tapping another field commits via tapOther; only commit here when focus
      // went somewhere that isn't a field.
      var to = e.relatedTarget;
      if (to && (to.getAttribute("data-field") || to.closest(".armed-panel"))) return;
      if (app.capture.typing) commitTyped();
    });
    var lockBtn = h("button", { class: "btn btn-primary", type: "button", text: "Lock", onclick: function () { commitTyped(); } });
    lockBtn.addEventListener("pointerdown", function (e) { e.preventDefault(); });
    panel.appendChild(h("div", { class: "manual-row" }, manual, lockBtn));

    if (unit !== "cm") {
      var fr = h("div", { class: "fracs", role: "group", "aria-label": "Add fraction" });
      ["1/8", "1/4", "3/8", "1/2", "5/8", "3/4", "7/8"].forEach(function (f) {
        var b = h("button", { type: "button", text: f, "aria-label": "Add " + f, onclick: function () {
          var base = manual.value.replace(/\s*\d+\/\d+\s*"?$/, "").trim();
          manual.value = (base ? base + " " : "") + f;
          manual.dispatchEvent(new Event("input"));
          manual.focus();
        } });
        b.addEventListener("pointerdown", function (e) { e.preventDefault(); });
        fr.appendChild(b);
      });
      panel.appendChild(fr);
    }

    if (slot < d.shots.length && !pending) {
      var confirmBox = h("div", { class: "inline-confirm" });
      var removeBtn = h("button", { class: "link-btn", type: "button", text: "Remove shot", onclick: function () {
        confirmBox.innerHTML = "";
        append(confirmBox, [h("span", { text: "Remove shot?" }),
          h("button", { class: "btn btn-danger", type: "button", text: "Remove", onclick: function () { removeShot(dim, slot); } }),
          h("button", { class: "btn", type: "button", text: "Cancel", onclick: function () { confirmBox.innerHTML = ""; confirmBox.appendChild(removeBtn); } })]);
      } });
      confirmBox.appendChild(removeBtn);
      panel.appendChild(confirmBox);
    }
    return panel;
  }

  function commitTyped() {
    var input = $("#manual");
    if (input && !app.capture.pending && input.value.trim()) {
      snack("Couldn't read that value. Try 34 7/8 or 34.875.", { bad: true });
      return;
    }
    dispatch({ type: "commit" });
  }

  function removeShot(dim, slot) {
    var w = app.win, d = dimOf(w, dim);
    var before = clone(d.shots);
    d.shots.splice(slot, 1);
    S.recomputeOrdered(d);
    app.capture = C.initialState();
    saveProject();
    updateCapture();
    snack("Shot removed.", { action: "Undo", onAction: function () {
      if (app.win !== w) return;
      d.shots = before; S.recomputeOrdered(d); saveProject(); updateCapture();
    } });
  }

  function updateCapture() {
    if (!app.captureDom || !app.win) return;
    var w = app.win, dom = app.captureDom;
    buildDim("width"); buildDim("height"); buildDim("depth");
    [dom.mount, dom.side].forEach(function (block) {
      var field = block.getAttribute("data-block");
      var val = block._get();
      block.classList.toggle("armed-field", app.capture.armed === field);
      Array.prototype.forEach.call(block.querySelectorAll("button"), function (b) {
        var bv = b.getAttribute("data-value") || null;
        b.setAttribute("aria-pressed", String(val !== undefined && bv === val));
      });
    });
    [dom.type, dom.obst, dom.notes].forEach(function (block) {
      block.classList.toggle("armed-field", app.capture.armed === block.getAttribute("data-block"));
    });
    var done = S.isWindowComplete(w);
    dom.complete.innerHTML = "";
    dom.complete.appendChild(done ? h("span", { class: "pill pill-good", text: "✓ Complete" })
      : h("span", { class: "pill", text: "Needs width, height, mount" }));
    dom.trigger.innerHTML = "";
    if (app.laser && app.laser.snapshot().canTrigger) {
      dom.trigger.appendChild(h("button", { class: "btn btn-block", type: "button", style: "margin-top:12px", text: "Measure", onclick: function () {
        app.laser.trigger().catch(function () { snack("The laser didn't respond.", { bad: true }); });
      } }));
    }
    updateLive();
  }

  function updateLive() {
    var live = $("#live-value"), bar = $("#countdown");
    var pending = app.capture.pending;
    if (live) {
      live.textContent = pending ? R.formatLength(pending.value, app.project.unit) : (app.capture.typing ? "?" : "Waiting for reading…");
      live.classList.toggle("waiting", !pending);
    }
    if (bar) bar.style.width = (C.remaining(app.capture, performance.now()) * 100) + "%";
  }

  function focusField(field) {
    var el = null;
    if (C.isShotField(field)) el = document.querySelector('.slot[data-field="' + field + '"]');
    else if (field === "mountType" || field === "controlSide") el = document.querySelector('[data-block="' + field + '"] button');
    else el = document.getElementById("f-" + field);
    if (el) {
      el.focus({ preventScroll: true });
      var target = C.isShotField(field) ? el.closest(".dim") : el.closest(".choice") || el;
      if (target && target.scrollIntoView) target.scrollIntoView({ block: "center", behavior: "auto" });
    }
  }

  // Apply a committed value to the window being captured.
  function applyCommit(e) {
    var w = app.win, wasComplete = S.isWindowComplete(w), msg = "";
    var shot = C.parseShot(e.field);
    if (shot) {
      if (shot.dim === "depth" && !w.depth) w.depth = S.newDimension();
      var d = dimOf(w, shot.dim);
      var made = R.makeShot(e.value, e.source);
      if (!made) return "";
      if (shot.slot < d.shots.length) d.shots[shot.slot] = made;
      else if (d.shots.length < R.MAX_SHOTS) d.shots.push(made);
      else { snack("Maximum " + R.MAX_SHOTS + " shots per dimension."); return ""; }
      S.recomputeOrdered(d);
      msg = C.fieldLabel(e.field) + " locked at " + R.speakInches(made.rounded, app.project.unit);
    } else if (e.field === "controlType") {
      w.controlType = e.value || null;
    } else if (e.field === "mountType") {
      w.mountType = e.value;
    } else if (e.field === "controlSide") {
      w.controlSide = e.value;
    } else if (e.field === "obstructions" || e.field === "notes") {
      w[e.field] = e.value || "";
    }
    saveProject();
    if (!wasComplete && S.isWindowComplete(w)) msg = (msg ? msg + ". " : "") + "Window " + w.label + " complete";
    return msg;
  }

  var IGNORED_MSG = {
    "not-armed": "Tap a width or height shot to arm it, then shoot.",
    "not-shot-field": "Arm a width, height or depth shot to take a reading.",
    cap: "Maximum 5 shots per dimension."
  };

  function dispatch(ev, opts) {
    opts = opts || {};
    if (!app.win) return;
    var r = C.step(app.capture, ev, { isFilled: isFilled });
    app.capture = r.state;
    var speech = [], rebuild = false, endOfWindow = false, focusTarget = null;
    r.effects.forEach(function (e) {
      switch (e.type) {
        case "armed":
          rebuild = true;
          focusTarget = e.field;
          speech.push(C.fieldLabel(e.field) + " armed");
          break;
        case "reading":
          speech.push(R.speakInches(e.value, app.project.unit));
          break;
        case "commit": {
          var m = applyCommit(e);
          if (m) speech.push(m);
          rebuild = true;
          break;
        }
        case "advance":
          // End of the §7.1 path wraps to the next window; depth just ends.
          if (e.to === null && e.from && e.from.indexOf("depth.") !== 0) endOfWindow = true;
          rebuild = true;
          break;
        case "disarmed":
          rebuild = true;
          break;
        case "ignored":
          if (!opts.quiet) snack(IGNORED_MSG[e.reason] || "Ignored.");
          break;
      }
    });
    if (!opts.quiet && speech.length) announce(speech.join(". "));
    if (rebuild) updateCapture(); else updateLive();
    syncTicker();
    if (focusTarget && opts.focus !== false) focusField(focusTarget);
    if (endOfWindow) goNextWindow();
  }

  function goNextWindow() {
    var p = app.project, room = app.room, w = app.win;
    if (!p || !room || !w) return;
    var idx = room.windows.indexOf(w);
    var next = room.windows[idx + 1];
    if (!next) { next = S.addWindow(room); warnIfLarge(); }
    saveProject().then(function () { go(captureHash(p, room, next)); });
  }

  function syncTicker() {
    if (app.capture.deadline !== null && !app.ticker) {
      app.ticker = setInterval(function () {
        if (!app.win) { stopTicker(); return; }
        dispatch({ type: "tick", now: performance.now() }, { quiet: false });
        updateLive();
        if (app.capture.deadline === null) stopTicker();
      }, 100);
    } else if (app.capture.deadline === null) stopTicker();
  }
  function stopTicker() { if (app.ticker) { clearInterval(app.ticker); app.ticker = null; } }

  // Laser reading → capture state machine.
  function onLaserReading(meters) {
    var d = R.describeMeters(meters);
    if (d.invalid) { snack("The laser sent an invalid reading — ignored.", { bad: true }); return; }
    if (app.routeName !== "capture" || !app.win) { snack("Open a window and tap a field to capture a reading."); return; }
    var input = $("#manual");
    if (input) input.value = "";
    dispatch({ type: "reading", value: d.raw, source: "laser", now: performance.now() });
  }

  function onLaserState(snap) {
    var prev = app.laserState.status;
    app.laserState = snap;
    if (prev === "connected" && snap.status !== "connected") {
      if (app.win) dispatch({ type: "disconnect" }, { quiet: true });
      announce("Laser disconnected");
    }
    if (snap.status === "connected" && prev !== "connected") announce("Laser connected");
    renderLaserArea();
    renderBanners();
    if (app.captureDom) updateCapture();
  }

  function renderLaserArea() {
    var box = app.captureDom && app.captureDom.laser;
    if (!box) return;
    box.innerHTML = "";
    var s = app.laserState;
    if (s.status === "reconnecting" || s.status === "busy-elsewhere") {
      box.appendChild(h("div", { class: "banner banner-bad", role: "status" },
        h("p", { text: s.status === "reconnecting" && !s.message ? "Laser disconnected — reconnecting…" : s.message }),
        s.status === "reconnecting"
          ? h("button", { class: "btn", type: "button", text: "Reconnect", onclick: function () { app.laser.reconnectNow(); } })
          : h("button", { class: "btn", type: "button", text: "Try again", onclick: function () { app.laser.connect(); } })));
      return;
    }
    var status, action = null, dot = "dot";
    if (s.status === "unsupported") status = s.message || "Manual entry — no Bluetooth in this browser";
    else if (s.status === "connected") { status = "Laser connected" + (s.deviceName ? " · " + s.deviceName : ""); dot += " dot-on"; }
    else if (s.status === "connecting") { status = "Connecting…"; dot += " dot-wait"; }
    else {
      status = s.message || "Laser not connected — type values, or connect";
      action = h("button", { class: "btn", type: "button", text: "Connect laser", onclick: function () { app.laser.connect(); } });
    }
    box.appendChild(h("div", { class: "laser-bar" },
      h("span", { class: "status" }, h("span", { class: dot, "aria-hidden": "true" }), status), action));
  }

  // --- photos (§10.5) ---------------------------------------------------------------

  function renderPhotos() {
    var box = app.captureDom && app.captureDom.photos, w = app.win;
    if (!box || !w) return;
    box.innerHTML = "";
    var grid = h("div", { class: "photos" });
    (w.photos || []).forEach(function (id) {
      var cell = h("div", { class: "photo" });
      S.getPhoto(id).then(function (rec) {
        if (!rec) return;
        var url = URL.createObjectURL(rec.blob);
        cell.appendChild(h("img", { src: url, alt: "Photo of " + w.label, onload: function () { URL.revokeObjectURL(url); } }));
        cell.appendChild(h("button", { type: "button", "aria-label": "Delete photo", text: "✕", onclick: function () {
          w.photos = w.photos.filter(function (x) { return x !== id; });
          saveProject().then(function () { renderPhotos(); });
          snack("Photo deleted.", { action: "Undo",
            onAction: function () { w.photos.push(id); saveProject().then(renderPhotos); },
            onExpire: function () { S.deletePhoto(id).catch(function () {}); } });
        } }));
      }).catch(function () {});
      grid.appendChild(cell);
    });
    var input = h("input", { type: "file", accept: "image/jpeg,image/png,image/webp,image/*", capture: "environment", hidden: true,
      onchange: function () { if (this.files && this.files[0]) addPhoto(this.files[0]); this.value = ""; } });
    var add = h("button", { class: "btn", type: "button", text: "Add photo", onclick: function () {
      if ((w.photos || []).length >= MAX_PHOTOS) { snack("Up to " + MAX_PHOTOS + " photos per window."); return; }
      input.click();
    } });
    append(box, [h("div", { class: "section-head" }, h("span", { class: "label", text: "Photos (optional)" }),
      h("span", { class: "small muted num", text: (w.photos || []).length + " of " + MAX_PHOTOS })), grid, h("div", { style: "margin-top:8px" }, add, input)]);
  }

  function downscale(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        var s = Math.min(1, PHOTO_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
        var cw = Math.round(img.naturalWidth * s), ch = Math.round(img.naturalHeight * s);
        var c = h("canvas", { width: cw, height: ch });
        c.getContext("2d").drawImage(img, 0, 0, cw, ch);
        c.toBlob(function (b) { if (b) resolve(b); else reject(new Error("encode")); }, "image/jpeg", PHOTO_QUALITY);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("decode")); };
      img.src = url;
    });
  }

  function storageEstimate() {
    if (navigator.storage && navigator.storage.estimate) return navigator.storage.estimate().catch(function () { return null; });
    return Promise.resolve(null);
  }

  function addPhoto(file) {
    var w = app.win, p = app.project;
    if (!w) return;
    if ((w.photos || []).length >= MAX_PHOTOS) { snack("Up to " + MAX_PHOTOS + " photos per window."); return; }
    downscale(file).then(function (blob) {
      return storageEstimate().then(function (est) {
        if (est && est.quota) {
          var after = (est.usage + blob.size) / est.quota;
          if (after > 0.95) { snack("Storage is nearly full — photo not saved. Delete photos in Settings or export a backup.", { bad: true, timeout: 6000 }); return; }
          if (after > 0.8) snack("Storage is over 80% full. Consider deleting old photos in Settings.", { timeout: 5000 });
        }
        var id = S.uid();
        return S.putPhoto({ id: id, projectId: p.id, windowId: w.id, blob: blob, size: blob.size }).then(function () {
          w.photos = (w.photos || []).concat(id);
          return saveProject();
        }).then(renderPhotos);
      });
    }).catch(function () { snack("That photo couldn't be saved. The window is unaffected.", { bad: true }); });
  }

  // === EXPORT ====================================================================================

  var excelLoading = null;
  function loadExcel() {
    if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
    if (excelLoading) return excelLoading;
    excelLoading = new Promise(function (resolve, reject) {
      var s = h("script", { src: "./vendor/exceljs.min.js" });
      s.onload = function () { resolve(window.ExcelJS); };
      s.onerror = function () { excelLoading = null; reject(new Error("load")); };
      document.head.appendChild(s);
    });
    return excelLoading;
  }

  function viewExport(p) {
    setBar({ title: "Export", back: "#/p/" + p.id });
    var model = Sheet.buildModel(p, activeProfile());
    var html = Sheet.renderHtml(model);
    $("#print-root").innerHTML = html;
    var status = h("p", { class: "small muted", role: "status" });
    var xlsxBtn = h("button", { class: "btn btn-primary", type: "button", text: "Generate .xlsx", onclick: function () {
      xlsxBtn.disabled = true;
      status.textContent = "Building spreadsheet…";
      saveProject()
        .then(loadExcel)
        .then(function (ExcelJS) { return Sheet.generateXlsx(Sheet.buildModel(p, activeProfile()), ExcelJS, readPalette()); })
        .then(function (buf) {
          status.textContent = "Spreadsheet ready.";
          download(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), Sheet.fileName(p, "xlsx"));
        })
        .catch(function () { status.textContent = ""; snack("Couldn't build the spreadsheet.", { bad: true }); })
        .then(function () { xlsxBtn.disabled = false; });
    } });
    var pdfBtn = h("button", { class: "btn", type: "button", text: "Generate PDF", onclick: function () {
      $("#print-root").innerHTML = Sheet.renderHtml(Sheet.buildModel(p, activeProfile()));
      saveProject().then(function () { window.print(); });
    } });
    var st = S.projectStats(p);
    mount(h("div", null,
      h("p", { class: "small muted" }, app.profileEnabled ? "Company profile: " + (app.profile.companyName || "") : "Base sheet",
        " · ", h("button", { class: "link-btn", type: "button", text: "Edit profile", onclick: function () { go("#/profile"); } })),
      h("p", { class: "complete num" }, plural(st.windows, "window") + " across " + plural(st.rooms, "room") +
        (st.windows - st.complete ? " · " + (st.windows - st.complete) + " incomplete" : "")),
      h("div", { class: "row-actions", style: "margin-top:12px" }, xlsxBtn, pdfBtn),
      status,
      h("p", { class: "small muted", text: "PDF opens your browser's print dialog — choose “Save as PDF”." }),
      h("div", { class: "preview", "data-theme": "light", html: html })));
  }

  // === SETTINGS ===================================================================================

  function formatBytes(n) {
    if (!n) return "0 KB";
    if (n < 1024 * 1024) return Math.ceil(n / 1024) + " KB";
    return (n / 1024 / 1024).toFixed(1) + " MB";
  }

  function importFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var r = S.validateImport(String(reader.result));
      if (!r.ok) { snack(r.error, { bad: true, timeout: 6000 }); return; }
      if (r.type === "profile") {
        app.profile = P.normalizeProfile(r.data);
        app.profileEnabled = true;
        saveProfile().then(function () { snack("Company profile imported."); route(); });
        return;
      }
      var p = S.normalizeProject(r.data);
      var photos = Array.isArray(r.file.photos) ? r.file.photos : [];
      S.getProject(p.id).then(function (existing) {
        var copy = Boolean(existing);
        if (copy) p.id = S.uid();
        return Promise.all(photos.map(function (ph) {
          if (!ph || typeof ph.dataUrl !== "string" || typeof ph.id !== "string") return null;
          var blob = dataUrlToBlob(ph.dataUrl);
          return S.putPhoto({ id: ph.id, projectId: p.id, windowId: ph.windowId, blob: blob, size: blob.size });
        })).then(function () {
          app.project = p;
          return saveProject();
        }).then(function () {
          snack(copy ? "Imported as a copy." : "Project imported.");
          go("#/p/" + p.id);
        });
      }).catch(function () { snack("Import failed — storage error.", { bad: true }); });
    };
    reader.onerror = function () { snack("That file couldn't be read.", { bad: true }); };
    reader.readAsText(file);
  }

  function viewSettings() {
    setBar({ title: "Settings", back: "#/" });
    var theme = getTheme();
    var themeSeg = h("div", { class: "segmented", role: "group", "aria-label": "Theme" });
    [["system", "System"], ["light", "Light"], ["dark", "Dark"]].forEach(function (t) {
      themeSeg.appendChild(h("button", { type: "button", "aria-pressed": String(theme === t[0]), text: t[1], onclick: function () {
        setTheme(t[0]);
        Array.prototype.forEach.call(themeSeg.children, function (b) { b.setAttribute("aria-pressed", "false"); });
        this.setAttribute("aria-pressed", "true");
      } }));
    });
    var storageBox = h("div", { class: "form-grid" }, h("p", { class: "muted small", text: "Measuring storage…" }));
    var fileInput = h("input", { type: "file", accept: "application/json,.json", hidden: true, onchange: function () {
      if (this.files && this.files[0]) importFile(this.files[0]);
      this.value = "";
    } });

    mount(h("div", null,
      X ? X.collect(X.settingsBlocks, ctx()) : null,
      h("div", { class: "section form-grid" },
        h("div", { class: "section-head" }, h("span", { class: "label", text: "Appearance" })),
        themeSeg),
      h("div", { class: "section form-grid" },
        h("div", { class: "section-head" }, h("span", { class: "label", text: "Default unit for new projects" })),
        unitSegment(app.settings.defaultUnit, function (u) { app.settings.defaultUnit = u; S.setKV("settings", app.settings).catch(function () {}); })),
      h("div", { class: "section form-grid" },
        h("div", { class: "section-head" }, h("span", { class: "label", text: "Company profile" })),
        h("p", { class: "small muted", text: app.profileEnabled ? "On — sheets use " + (app.profile.companyName || "your profile") + "." : "Off — sheets use the base layout." }),
        h("button", { class: "btn", type: "button", text: "Company profile", onclick: function () { go("#/profile"); } })),
      h("div", { class: "section form-grid" },
        h("div", { class: "section-head" }, h("span", { class: "label", text: "Import" })),
        h("p", { class: "small muted", text: "Open a project backup or a company profile (.json). Project backups are exported from each project's page." }),
        h("button", { class: "btn", type: "button", text: "Import file", onclick: function () { fileInput.click(); } }), fileInput),
      h("div", { class: "section" },
        h("div", { class: "section-head" }, h("span", { class: "label", text: "Storage" })),
        storageBox),
      h("div", { class: "section form-grid" },
        h("div", { class: "section-head" }, h("span", { class: "label", text: "About" })),
        h("p", { class: "small" }, "Apex Measure Pro " + VERSION + " · © Apex Installations LLC. ",
          h("a", { href: "#/terms", text: "Terms" }), " · ", h("a", { href: "#/privacy", text: "Privacy" }), " · ",
          h("a", { href: "./NOTICES", text: "Notices" })),
        h("p", { class: "small muted", text: "Provided as is, without warranty of any kind. Check critical measurements before ordering." }),
        h("p", { class: "small muted", text: "Your measurements are saved on this device first and work offline. Cloud sync and sharing are optional and only run on plans that include them." }))));

    return Promise.all([storageEstimate(), S.allPhotos().catch(function () { return []; }), refreshRows()]).then(function (res) {
      var est = res[0], photos = res[1];
      storageBox.innerHTML = "";
      storageBox.appendChild(h("p", { class: "num", text: est && est.quota
        ? "Using " + formatBytes(est.usage) + " of about " + formatBytes(est.quota) + " (" + Math.round(est.usage / est.quota * 100) + "%)."
        : "Storage use can't be measured in this browser." }));
      if (!app.persistent) storageBox.appendChild(h("p", { class: "advisory", text: "Storage unavailable — nothing is saved this session." }));
      var byProject = {};
      photos.forEach(function (ph) { (byProject[ph.projectId] = byProject[ph.projectId] || []).push(ph); });
      var list = h("ul", { class: "list", "aria-label": "Photo storage by project" });
      app.rows.forEach(function (row) {
        if (!row.ok) return;
        var ph = byProject[row.project.id] || [];
        if (!ph.length) return;
        var bytes = ph.reduce(function (a, x) { return a + (x.size || 0); }, 0);
        list.appendChild(h("li", { class: "list-row" },
          h("div", { class: "row-main" }, h("span", { class: "row-title", text: S.displayName(row.project) }),
            h("span", { class: "row-sub num", text: plural(ph.length, "photo") + " · " + formatBytes(bytes) })),
          h("button", { class: "btn", type: "button", text: "Delete photos", onclick: function () {
            confirmDialog("Delete " + plural(ph.length, "photo") + " from " + S.displayName(row.project) + "? Measurements are kept.").then(function (ok) {
              if (!ok) return;
              var p = row.project;
              p.rooms.forEach(function (r) { r.windows.forEach(function (w) { w.photos = []; }); });
              S.saveProject(p).then(function () {
                return Promise.all(ph.map(function (x) { return S.deletePhoto(x.id); }));
              }).then(function () { if (app.project && app.project.id === p.id) app.project = p; snack("Photos deleted."); viewSettings(); });
            });
          } })));
      });
      if (list.children.length) storageBox.appendChild(list);
    });
  }

  // === PROFILE SETUP ================================================================================

  function viewProfile() {
    setBar({ title: "Company Profile", back: "#/settings" });
    var prof = app.profile;
    var saveP = (function () { var t; return function () { clearTimeout(t); t = setTimeout(saveProfile, 300); }; })();

    var logoBox = h("div", { class: "form-grid" });
    function renderLogo() {
      logoBox.innerHTML = "";
      var input = h("input", { type: "file", accept: "image/png,image/jpeg,image/svg+xml,.svg", hidden: true, onchange: function () {
        var f = this.files && this.files[0];
        this.value = "";
        if (!f) return;
        P.importLogo(f).then(function (logo) { prof.logo = logo; saveP(); renderLogo(); })
          .catch(function (e) { snack(e && e.message || "That logo couldn't be used.", { bad: true, timeout: 6000 }); });
      } });
      if (prof.logo) logoBox.appendChild(h("img", { class: "logo-preview", src: prof.logo.dataUrl, alt: "Current logo" }));
      logoBox.appendChild(h("div", { class: "row-actions" },
        h("button", { class: "btn", type: "button", text: prof.logo ? "Replace logo" : "Add logo", onclick: function () { input.click(); } }),
        prof.logo ? h("button", { class: "btn", type: "button", text: "Remove logo", onclick: function () { prof.logo = null; saveP(); renderLogo(); } }) : null,
        input));
      logoBox.appendChild(h("p", { class: "small muted", text: "PNG or JPEG. SVG only with explicit width and height. Shown up to 200 × 80 on the sheet." }));
    }
    renderLogo();

    var colsBox = h("div");
    function renderCols() {
      colsBox.innerHTML = "";
      prof.columns.forEach(function (col, i) {
        var keySel = h("select", { class: "select", "aria-label": "Field for column " + (i + 1), onchange: function () {
          var d = P.defaultColumn(this.value);
          col.key = this.value;
          delete col.dropdown; delete col.omitIfAllEmpty;
          if (d.dropdown) col.dropdown = d.dropdown;
          if (d.omitIfAllEmpty) col.omitIfAllEmpty = true;
          saveP();
        } }, P.VALID_KEYS.map(function (k) { return h("option", { value: k, text: P.KEY_NAMES[k] }); }));
        keySel.value = col.key;
        var alignSel = h("select", { class: "select", "aria-label": "Alignment for column " + (i + 1), onchange: function () { col.align = this.value; saveP(); } },
          ["left", "center", "right"].map(function (a) { return h("option", { value: a, text: a[0].toUpperCase() + a.slice(1) }); }));
        alignSel.value = col.align;
        colsBox.appendChild(h("div", { class: "col-row" },
          h("input", { class: "input", value: col.label, "aria-label": "Header for column " + (i + 1), oninput: function () { col.label = this.value; saveP(); } }),
          keySel,
          h("input", { class: "input num", type: "number", min: "4", max: "60", value: String(col.width), "aria-label": "Width for column " + (i + 1),
            oninput: function () { var v = Number(this.value); if (v > 0) { col.width = v; saveP(); } } }),
          alignSel,
          h("div", { class: "row-actions" },
            h("button", { class: "btn", type: "button", text: "↑", "aria-label": "Move column up", disabled: i === 0 || null, onclick: function () {
              prof.columns.splice(i - 1, 0, prof.columns.splice(i, 1)[0]); saveP(); renderCols(); } }),
            h("button", { class: "btn", type: "button", text: "↓", "aria-label": "Move column down", disabled: i === prof.columns.length - 1 || null, onclick: function () {
              prof.columns.splice(i + 1, 0, prof.columns.splice(i, 1)[0]); saveP(); renderCols(); } }),
            h("button", { class: "btn", type: "button", text: "Remove", onclick: function () { prof.columns.splice(i, 1); saveP(); renderCols(); } }))));
      });
      colsBox.appendChild(h("button", { class: "btn btn-block", type: "button", style: "margin-top:8px", text: "Add column", onclick: function () {
        var used = prof.columns.map(function (c) { return c.key; });
        var key = P.VALID_KEYS.filter(function (k) { return used.indexOf(k) === -1; })[0] || "notes";
        prof.columns.push(P.defaultColumn(key)); saveP(); renderCols();
      } }));
    }
    renderCols();

    var pasteArea = h("textarea", { class: "textarea", id: "f-paste", placeholder: "Room\tWindow\tWidth\tHeight\tMount" });
    var mapBox = h("div");
    var mapBtn = h("button", { class: "btn", type: "button", text: "Match headers", onclick: function () {
      var mapped = P.parseHeaderPaste(pasteArea.value);
      mapBox.innerHTML = "";
      if (!mapped.length) { snack("Paste some column headers first."); return; }
      mapped.forEach(function (m, i) {
        var sel = h("select", { class: "select", "aria-label": "Field for " + m.label, onchange: function () { m.key = this.value || null; } },
          h("option", { value: "", text: "Skip this column" }),
          P.VALID_KEYS.map(function (k) { return h("option", { value: k, text: P.KEY_NAMES[k] }); }));
        sel.value = m.key || "";
        mapBox.appendChild(h("div", { class: "col-row" }, h("span", { class: "row-title", text: (i + 1) + ". " + m.label }), sel));
      });
      mapBox.appendChild(h("button", { class: "btn btn-primary btn-block", type: "button", style: "margin-top:8px", text: "Use these columns", onclick: function () {
        var cols = P.columnsFromPaste(mapped);
        if (!cols.length) { snack("None of those headers are matched to a field."); return; }
        prof.columns = cols; saveP(); renderCols(); mapBox.innerHTML = ""; pasteArea.value = "";
        snack("Columns updated.");
      } }));
    } });

    function toggle(label, key) {
      return h("label", { class: "check-row" },
        h("input", { type: "checkbox", checked: prof[key] !== false, onchange: function () { prof[key] = this.checked; saveP(); } }), label);
    }

    var enable = h("label", { class: "check-row" },
      h("input", { type: "checkbox", checked: app.profileEnabled, onchange: function () { app.profileEnabled = this.checked; saveProfile(); } }),
      h("span", null, h("strong", { text: "Use this profile for sheets" }), h("br"),
        h("span", { class: "small muted", text: "Off: the base Apex Measure Pro sheet." })));

    mount(h("div", null,
      h("div", { class: "section form-grid" }, enable),
      h("div", { class: "section form-grid" },
        h("div", { class: "section-head" }, h("span", { class: "label", text: "Header" })),
        textField("Company name", prof.companyName, function (v) { prof.companyName = v; saveP(); }),
        textField("Subtitle", prof.subtitle, function (v) { prof.subtitle = v; saveP(); }),
        textField("Measurer name (prefills new projects)", prof.measurerName, function (v) { prof.measurerName = v; saveP(); }),
        logoBox),
      h("div", { class: "section" },
        h("div", { class: "section-head" }, h("span", { class: "label", text: "Columns" })),
        colsBox),
      h("div", { class: "section form-grid" },
        h("div", { class: "section-head" }, h("span", { class: "label", text: "Paste column headers" })),
        h("label", { class: "small muted", for: "f-paste", text: "Paste a header row from your existing sheet (tab- or line-separated). Headers only — measurement data can't be pasted." }),
        pasteArea, mapBtn, mapBox),
      h("div", { class: "section form-grid" },
        h("div", { class: "section-head" }, h("span", { class: "label", text: "Layout" })),
        h("label", { class: "check-row" },
          h("input", { type: "checkbox", checked: prof.grouping !== "none", onchange: function () { prof.grouping = this.checked ? "room" : "none"; saveP(); } }),
          "Group rows by room"),
        toggle("Room and job totals", "showTotals"),
        toggle("Terms block", "showTerms"),
        toggle("Signature block", "showSignature"),
        toggle("Low-ink styling", "lowInk")),
      h("div", { class: "section form-grid" },
        h("div", { class: "section-head" }, h("span", { class: "label", text: "Terms" })),
        textField("Terms text", prof.terms, function (v) { prof.terms = v; saveP(); }, { multiline: true }),
        h("p", { class: "small muted", text: "A plain-language measurement disclaimer, not legal advice. Review it before relying on it commercially." }),
        h("p", { class: "small muted", text: "Every sheet ends with “Measured with Apex Measure Pro”. That line can't be removed." })),
      h("div", { class: "section row-actions" },
        h("button", { class: "btn", type: "button", text: "Export profile", onclick: function () {
          saveProfile().then(function () {
            download(new Blob([S.exportFile("profile", P.normalizeProfile(prof))], { type: "application/json;charset=utf-8" }), "apex-profile.json");
          });
        } }),
        h("button", { class: "btn", type: "button", text: "Reset to base sheet", onclick: function () {
          confirmDialog("Reset the profile to the base sheet? Your logo, columns and terms are replaced.", "Reset").then(function (ok) {
            if (!ok) return;
            app.profile = P.defaultProfile();
            saveProfile().then(viewProfile);
          });
        } }))));
  }

  // === BOOT =============================================================================================

  function boot() {
    syncThemeColor();
    if (window.matchMedia) {
      var mq = window.matchMedia("(prefers-color-scheme: dark)");
      if (mq.addEventListener) mq.addEventListener("change", syncThemeColor);
    }

    var LaserFactory = (window.ApexTransport && window.ApexTransport.createLaser) ? window.ApexTransport : B;
    app.laser = LaserFactory.createLaser({ onReading: onLaserReading, onState: onLaserState });
    app.laserState = app.laser.snapshot();

    document.addEventListener("visibilitychange", function () {
      if (document.hidden && app.win) dispatch({ type: "visibilityHidden" }, { quiet: true });
    });
    window.addEventListener("pagehide", function () { if (app.laser) app.laser.release(); });
    window.addEventListener("hashchange", route);

    S.open().then(function (r) {
      app.persistent = r.persistent;
      return Promise.all([
        S.getKV("profile").catch(function () { return null; }),
        S.getKV("profileEnabled").catch(function () { return false; }),
        S.getKV("settings").catch(function () { return null; })
      ]);
    }).then(function (res) {
      if (res[0]) app.profile = P.normalizeProfile(res[0]);
      app.profileEnabled = Boolean(res[1]);
      if (res[2] && S.UNITS.indexOf(res[2].defaultUnit) !== -1) app.settings.defaultUnit = res[2].defaultUnit;
      renderBanners();
      if (X) X.fire(X.onBoot, ctx());
      route();
    });

    // Offline: service worker (not available from file://). No skipWaiting —
    // a new version applies silently on the next cold start (§13.4).
    if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register("./sw.js").catch(function () {});
    }
  }

  // test hook for tests/browser.html
  window.ApexApp = { app: app, dispatch: dispatch, onLaserReading: onLaserReading };

  boot();
})();
