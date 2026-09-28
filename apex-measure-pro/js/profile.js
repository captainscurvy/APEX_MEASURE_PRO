/*
 * profile.js — the sheet config object (§9.3), header paste (§9.2), logo
 * import (§9.4). Base mode is DEFAULT_PROFILE — not special-cased anywhere.
 * To change the base sheet (§20), edit DEFAULT_PROFILE below; no code change.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ApexProfile = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  var DEFAULT_TERMS =
    "Measurements taken on-site to the nearest 1/8 inch, floored. Mount type is recorded as " +
    "inside mount (IB) or outside mount (OB) as noted and no manufacturer deductions have been " +
    "applied — final product dimensions are subject to the manufacturer's own deduction and " +
    "tolerance rules. This sheet is a measurement record only and is not a quotation.";

  // The only keys the generator recognizes. Unknown keys are skipped with a warning.
  var VALID_KEYS = ["room", "label", "mountType", "widthOrdered", "heightOrdered",
    "depthOrdered", "controlSide", "controlType", "obstructions", "notes"];

  var KEY_NAMES = {
    room: "Room", label: "Window", mountType: "Mount", widthOrdered: "Width",
    heightOrdered: "Height", depthOrdered: "Depth", controlSide: "Control",
    controlType: "Type", obstructions: "Obstructions", notes: "Notes"
  };

  var DEFAULT_PROFILE = {
    schemaVersion: 1,
    type: "profile",

    companyName: "Apex Measure Pro",
    subtitle: "Measure Sheet",
    logo: null,
    terms: DEFAULT_TERMS,
    measurerName: "",

    columns: [
      { key: "room",          label: "Room",         width: 14, align: "left"   },
      { key: "label",         label: "Window",       width: 10, align: "center" },
      { key: "mountType",     label: "Mount",        width:  8, align: "center", dropdown: ["IB", "OB"] },
      { key: "widthOrdered",  label: "Width",        width: 10, align: "right"  },
      { key: "heightOrdered", label: "Height",       width: 10, align: "right"  },
      { key: "depthOrdered",  label: "Depth",        width: 10, align: "right",  omitIfAllEmpty: true },
      { key: "controlSide",   label: "Control",      width: 10, align: "center", dropdown: ["L", "R"] },
      { key: "controlType",   label: "Type",         width: 14, align: "left"   },
      { key: "obstructions",  label: "Obstructions", width: 20, align: "left"   },
      { key: "notes",         label: "Notes",        width: 20, align: "left"   }
    ],

    grouping: "room",
    showTotals: true,
    showTerms: true,
    showSignature: true,
    lowInk: true,
    attribution: true      // ALWAYS true; the generator ignores false
  };

  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  function defaultProfile() { return clone(DEFAULT_PROFILE); }

  function defaultColumn(key) {
    var c = DEFAULT_PROFILE.columns.filter(function (x) { return x.key === key; })[0];
    return c ? clone(c) : { key: key, label: KEY_NAMES[key] || key, width: 12, align: "left" };
  }

  // Fill any missing fields from the defaults; force attribution on.
  function normalizeProfile(p) {
    var d = defaultProfile();
    if (!p || typeof p !== "object") return d;
    var out = {};
    Object.keys(d).forEach(function (k) { out[k] = p[k] !== undefined ? p[k] : d[k]; });
    out.schemaVersion = 1;
    out.type = "profile";
    out.attribution = true;
    if (!Array.isArray(out.columns)) out.columns = d.columns;
    out.columns = out.columns.map(function (c) {
      var col = {
        key: String(c.key),
        label: c.label !== undefined ? String(c.label) : (KEY_NAMES[c.key] || String(c.key)),
        width: typeof c.width === "number" && c.width > 0 ? c.width : 12,
        align: ["left", "center", "right"].indexOf(c.align) !== -1 ? c.align : "left"
      };
      if (Array.isArray(c.dropdown) && c.dropdown.length) col.dropdown = c.dropdown.map(String);
      if (c.omitIfAllEmpty) col.omitIfAllEmpty = true;
      return col;
    });
    return out;
  }

  // Synonyms for guessing a key from a pasted header.
  var SYNONYMS = {
    room: ["room", "location", "area", "space"],
    label: ["window", "win", "label", "opening", "#", "no", "item", "line"],
    mountType: ["mount", "mount type", "ib/ob", "inside/outside", "mounting"],
    widthOrdered: ["width", "w", "wide"],
    heightOrdered: ["height", "h", "drop", "length", "high"],
    depthOrdered: ["depth", "d", "deep"],
    controlSide: ["control", "control side", "side", "controls", "lift side"],
    controlType: ["type", "control type", "operation", "lift", "lift type"],
    obstructions: ["obstructions", "obstruction", "obstacles", "clearance"],
    notes: ["notes", "note", "comments", "remarks", "memo"]
  };

  function guessKey(label, taken) {
    var l = String(label).trim().toLowerCase().replace(/[.:]$/, "");
    var keys = Object.keys(SYNONYMS);
    for (var i = 0; i < keys.length; i++) {
      if (taken[keys[i]]) continue;
      if (SYNONYMS[keys[i]].indexOf(l) !== -1) return keys[i];
    }
    return null;
  }

  // §9.2 — the one permitted "import": String.split on a pasted header list.
  // → [{ label, key|null }]; the setup screen lets the user fix each mapping.
  function parseHeaderPaste(text) {
    var taken = {};
    return String(text || "")
      .split(/[\t\r\n]+/)
      .map(function (s) { return s.trim(); })
      .filter(Boolean)
      .map(function (label) {
        var key = guessKey(label, taken);
        if (key) taken[key] = true;
        return { label: label, key: key };
      });
  }

  function columnsFromPaste(mapped) {
    return mapped.filter(function (m) { return m.key && VALID_KEYS.indexOf(m.key) !== -1; })
      .map(function (m) {
        var c = defaultColumn(m.key);
        c.label = m.label;
        return c;
      });
  }

  // --- logo (§9.4) — browser only ------------------------------------------

  var LOGO_MAX_W = 400, LOGO_MAX_H = 160;

  function fitWithin(w, h, maxW, maxH) {
    var s = Math.min(1, maxW / w, maxH / h);          // downscale only, never upscale
    return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
  }

  function readAsDataUrl(blob) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
      r.readAsDataURL(blob);
    });
  }

  function readAsText(blob) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
      r.readAsText(blob);
    });
  }

  function loadImage(src) {
    return new Promise(function (res, rej) {
      var img = new Image();
      img.onload = function () { res(img); };
      img.onerror = function () { rej(new Error("That image couldn't be read.")); };
      img.src = src;
    });
  }

  // → Promise<{ dataUrl, widthPx, heightPx }>; rejects with a user-facing message.
  function importLogo(file) {
    var type = (file.type || "").toLowerCase();
    var isSvg = type === "image/svg+xml" || /\.svg$/i.test(file.name || "");
    var isRaster = type === "image/png" || type === "image/jpeg";
    if (!isSvg && !isRaster) return Promise.reject(new Error("Logo must be a PNG, JPEG, or SVG."));
    var srcP;
    if (isSvg) {
      srcP = readAsText(file).then(function (txt) {
        var doc = new DOMParser().parseFromString(txt, "image/svg+xml");
        var svg = doc.documentElement;
        var w = parseFloat(svg.getAttribute("width")), h = parseFloat(svg.getAttribute("height"));
        if (svg.nodeName.toLowerCase() !== "svg" || !(w > 0) || !(h > 0)) {
          throw new Error("SVG logos need explicit width and height attributes. Export it as PNG instead.");
        }
        return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(txt);
      });
    } else {
      srcP = readAsDataUrl(file);
    }
    return srcP.then(loadImage).then(function (img) {
      var size = fitWithin(img.naturalWidth || img.width, img.naturalHeight || img.height, LOGO_MAX_W, LOGO_MAX_H);
      var canvas = document.createElement("canvas");
      canvas.width = size.width;
      canvas.height = size.height;
      canvas.getContext("2d").drawImage(img, 0, 0, size.width, size.height);
      return { dataUrl: canvas.toDataURL("image/png"), widthPx: size.width, heightPx: size.height };
    });
  }

  return {
    DEFAULT_TERMS: DEFAULT_TERMS,
    DEFAULT_PROFILE: DEFAULT_PROFILE,
    VALID_KEYS: VALID_KEYS,
    KEY_NAMES: KEY_NAMES,
    defaultProfile: defaultProfile,
    defaultColumn: defaultColumn,
    normalizeProfile: normalizeProfile,
    parseHeaderPaste: parseHeaderPaste,
    columnsFromPaste: columnsFromPaste,
    fitWithin: fitWithin,
    importLogo: importLogo
  };
});
