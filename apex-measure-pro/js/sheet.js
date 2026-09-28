/*
 * sheet.js — config-driven measure sheet (§9). One generator, two modes:
 * base mode is just the default config (profile.js). Nothing special-cased.
 *
 *   buildModel(project, config)          pure: rows, columns, totals, text
 *   generateXlsx(model, ExcelJS, palette) → Promise<ArrayBuffer>
 *   renderHtml(model)                     preview + print-to-PDF markup
 *
 * Colours come in as `palette` (read from css/tokens.css at runtime), so no
 * colour is hardcoded here. ExcelJS is only *written*, never parsed.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ApexSheet = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  var R = root.ApexReduce || (typeof require === "function" ? require("./reduce.js") : null);
  var P = root.ApexProfile || (typeof require === "function" ? require("./profile.js") : null);

  var ATTRIBUTION = "Measured with Apex Measure Pro";   // lives here, never in the editable config
  var UNIT_LABEL = { "in": "in", ftin: "ft-in", cm: "cm" };
  var FONT = "Calibri";

  function cellValue(key, room, w, unit) {
    switch (key) {
      case "room": return room.name || "";
      case "label": return w.label || "";
      case "mountType": return w.mountType || "";
      case "widthOrdered": return w.width && w.width.ordered !== null ? R.formatLength(w.width.ordered, unit) : "";
      case "heightOrdered": return w.height && w.height.ordered !== null ? R.formatLength(w.height.ordered, unit) : "";
      case "depthOrdered": return w.depth && w.depth.ordered !== null && w.depth.ordered !== undefined ? R.formatLength(w.depth.ordered, unit) : "";
      case "controlSide": return w.controlSide === "left" ? "L" : w.controlSide === "right" ? "R" : "";
      case "controlType": return w.controlType === "other" ? (w.controlTypeOther || "other") : (w.controlType || "");
      case "obstructions": return w.obstructions || "";
      case "notes": return w.notes || "";
    }
    return "";
  }

  function buildModel(project, config) {
    var cfg = P.normalizeProfile(config);
    var unit = project.unit || "in";
    var rooms = project.rooms || [];
    var all = [];
    rooms.forEach(function (room) { room.windows.forEach(function (w) { all.push({ room: room, w: w }); }); });

    var columns = cfg.columns.filter(function (c) {
      if (P.VALID_KEYS.indexOf(c.key) === -1) {
        if (root.console) root.console.warn("Measure sheet: unknown column key skipped:", c.key);
        return false;
      }
      if (c.omitIfAllEmpty) {
        return all.some(function (x) { return cellValue(c.key, x.room, x.w, unit) !== ""; });
      }
      return true;
    });

    var groups = [];
    if (cfg.grouping === "none") {
      groups.push({ name: null, rows: all.map(function (x) {
        return columns.map(function (c) { return cellValue(c.key, x.room, x.w, unit); });
      }) });
    } else {
      rooms.forEach(function (room) {
        groups.push({ name: room.name || "", rows: room.windows.map(function (w) {
          return columns.map(function (c) { return cellValue(c.key, room, w, unit); });
        }) });
      });
    }

    return {
      header: { title: cfg.companyName, subtitle: cfg.subtitle, logo: cfg.logo },
      meta: [
        ["CLIENT", project.client || "", "DATE", project.date || ""],
        ["ADDRESS", project.address || "", "MEASURER", project.measurer || cfg.measurerName || ""],
        ["JOB REF", project.name || "", "UNIT", UNIT_LABEL[unit] || unit]
      ],
      columns: columns,
      grouping: cfg.grouping === "none" ? "none" : "room",
      groups: groups,
      showTotals: cfg.showTotals !== false,
      totals: { windows: all.length, rooms: rooms.length },
      terms: cfg.showTerms !== false ? (cfg.terms || "") : null,
      showSignature: cfg.showSignature !== false,
      lowInk: cfg.lowInk !== false,
      attribution: ATTRIBUTION                       // always, whatever config.attribution says
    };
  }

  function plural(n, word) { return n + " " + word + (n === 1 ? "" : "s"); }
  function groupTotalText(g) { return g.name + " — " + plural(g.rows.length, "window"); }
  function jobTotalText(t) { return "TOTAL — " + plural(t.windows, "window") + " across " + plural(t.rooms, "room"); }

  // "APEX" → "A P E X" with hair spaces: Excel has no letter-spacing.
  function letterspace(s) { return String(s).toUpperCase().split("").join(" "); }

  // --- xlsx -----------------------------------------------------------------

  function argb(hex) { return "FF" + String(hex).replace("#", "").toUpperCase(); }

  function colLetter(n) {            // 1 → A
    var s = "";
    while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
    return s;
  }

  function dataUrlToBase64(u) { return String(u).split(",")[1] || ""; }

  function generateXlsx(model, ExcelJS, palette) {
    var C = {
      paper: argb(palette.paper), ink: argb(palette.ink), ink2: argb(palette.ink2),
      ink3: argb(palette.ink3), rule: argb(palette.rule), ruleStrong: argb(palette.ruleStrong)
    };
    var wb = new ExcelJS.Workbook();
    wb.creator = "Apex Measure Pro";
    wb.created = new Date();
    var ws = wb.addWorksheet("Measure Sheet", {
      views: [{ showGridLines: false }],
      pageSetup: {
        paperSize: 1, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0,
        margins: { left: 0.5, right: 0.5, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 }
      }
    });

    var N = Math.max(model.columns.length, 1);
    ws.columns = model.columns.map(function (c) { return { width: c.width }; });
    if (!model.columns.length) ws.columns = [{ width: 40 }];
    var last = colLetter(N);
    var row = 0;
    var fill = function (argbColor) { return { type: "pattern", pattern: "solid", fgColor: { argb: argbColor } }; };
    var font = function (o) {
      var f = { name: FONT, size: 10, color: { argb: C.ink } };
      Object.keys(o || {}).forEach(function (k) { f[k] = o[k]; });
      return f;
    };
    var merge = function (r, c1, c2) { if (c2 > c1) ws.mergeCells(r, c1, r, c2); };
    var label8 = font({ size: 8, color: { argb: C.ink3 } });

    // Header band — rows 1–3
    var logo = model.header.logo;
    var textCol = 1;
    if (logo && logo.dataUrl) {
      var fit = P.fitWithin(logo.widthPx || 200, logo.heightPx || 80, 200, 80);   // letterboxed, aspect kept
      var imgId = wb.addImage({ base64: dataUrlToBase64(logo.dataUrl), extension: "png" });
      ws.addImage(imgId, { tl: { col: 0.1, row: 0.1 }, ext: { width: fit.width, height: fit.height }, editAs: "oneCell" });
      // skip the columns the logo covers (~7px per width unit)
      var px = 0;
      while (textCol <= N && px < fit.width + 8) { px += (model.columns[textCol - 1] ? model.columns[textCol - 1].width : 10) * 7 + 5; textCol++; }
      if (textCol > N) textCol = N;
    }
    row = 1;
    var r1 = ws.getRow(1);
    r1.height = logo && logo.dataUrl ? 64 : 28;
    for (var h = 1; h <= 3; h++) for (var c = 1; c <= N; c++) ws.getCell(h, c).fill = fill(C.paper);
    ws.getCell(1, textCol).value = letterspace(model.header.title || "");
    ws.getCell(1, textCol).font = font({ size: 16, bold: true });
    ws.getCell(1, textCol).alignment = { vertical: "middle", horizontal: "left" };
    merge(1, textCol, N);
    ws.getCell(2, 1).value = model.header.subtitle || "";
    ws.getCell(2, 1).font = font({ size: 10, color: { argb: C.ink2 } });
    merge(2, 1, N);
    merge(3, 1, N);

    // Metadata — rows 4–6, row 7 spacer
    var mid = N >= 4 ? Math.ceil(N / 2) + 1 : 0;
    row = 4;
    model.meta.forEach(function (m) {
      if (mid) {
        ws.getCell(row, 1).value = m[0]; ws.getCell(row, 1).font = label8;
        ws.getCell(row, 2).value = m[1]; ws.getCell(row, 2).font = font();
        merge(row, 2, mid - 1);
        ws.getCell(row, mid).value = m[2]; ws.getCell(row, mid).font = label8;
        ws.getCell(row, mid + 1).value = m[3]; ws.getCell(row, mid + 1).font = font();
        merge(row, mid + 1, N);
        row++;
      } else {
        [[m[0], m[1]], [m[2], m[3]]].forEach(function (pair) {
          ws.getCell(row, 1).value = pair[0]; ws.getCell(row, 1).font = label8;
          if (N > 1) { ws.getCell(row, 2).value = pair[1]; ws.getCell(row, 2).font = font(); merge(row, 2, N); }
          else ws.getCell(row, 1).value = pair[0] + "  " + pair[1];
          row++;
        });
      }
    });
    row++;   // spacer

    // Column header
    var headerRow = row;
    model.columns.forEach(function (col, i) {
      var cell = ws.getCell(row, i + 1);
      cell.value = col.label;
      cell.font = font({ size: 9, bold: true, color: { argb: C.ink2 } });
      cell.alignment = { horizontal: col.align, vertical: "bottom" };
      cell.border = { bottom: { style: "medium", color: { argb: C.ruleStrong } } };
      if (!model.lowInk) cell.fill = fill(C.paper);
    });
    ws.views = [{ state: "frozen", ySplit: headerRow, showGridLines: false }];
    ws.pageSetup.printTitlesRow = headerRow + ":" + headerRow;
    row++;

    var totalCol = Math.max(1, model.columns.findIndex(function (c) { return c.key === "label"; }) + 1);
    var dataRows = [];

    model.groups.forEach(function (g) {
      if (model.grouping === "room") {
        ws.getCell(row, 1).value = g.name;
        ws.getCell(row, 1).font = font({ bold: true });
        for (var c2 = 1; c2 <= N; c2++) {
          ws.getCell(row, c2).fill = fill(C.paper);
          ws.getCell(row, c2).border = { bottom: { style: "medium", color: { argb: C.ruleStrong } } };
        }
        merge(row, 1, N);
        row++;
      }
      g.rows.forEach(function (vals) {
        vals.forEach(function (v, i) {
          var cell = ws.getCell(row, i + 1);
          cell.value = v === "" ? null : v;
          cell.font = font();
          cell.alignment = { horizontal: model.columns[i].align, vertical: "top", wrapText: model.columns[i].width >= 14 };
          cell.border = { bottom: { style: "hair", color: { argb: C.rule } } };
        });
        dataRows.push(row);
        row++;
      });
      if (model.showTotals && model.grouping === "room") {
        var t = ws.getCell(row, totalCol);
        t.value = groupTotalText(g);
        t.font = font({ italic: true, color: { argb: C.ink2 } });
        t.alignment = { horizontal: "right" };
        row++;
      }
    });
    // Dropdowns on window rows (Excel data validation)
    model.columns.forEach(function (col, i) {
      if (!col.dropdown) return;
      dataRows.forEach(function (r) {
        ws.getCell(r, i + 1).dataValidation = {
          type: "list", allowBlank: true, showErrorMessage: false,
          formulae: ['"' + col.dropdown.join(",") + '"']
        };
      });
    });

    if (model.showTotals) {
      ws.getCell(row, 1).value = jobTotalText(model.totals);
      ws.getCell(row, 1).font = font({ bold: true });
      for (var c3 = 1; c3 <= N; c3++) ws.getCell(row, c3).border = { top: { style: "medium", color: { argb: C.ruleStrong } } };
      merge(row, 1, N);
      row++;
    }

    var totalWidth = model.columns.reduce(function (a, c) { return a + c.width; }, 0) || 40;

    if (model.terms !== null) {
      row += 2;
      ws.getCell(row, 1).value = "TERMS"; ws.getCell(row, 1).font = label8;
      row++;
      ws.getCell(row, 1).value = model.terms;
      ws.getCell(row, 1).font = font({ size: 9 });
      ws.getCell(row, 1).alignment = { wrapText: true, vertical: "top" };
      merge(row, 1, N);
      var lines = String(model.terms).split("\n").reduce(function (a, ln) {
        return a + Math.max(1, Math.ceil(ln.length / (totalWidth * 1.15)));
      }, 0);
      ws.getRow(row).height = Math.max(14, lines * 12.5 + 4);
      row++;
    }

    if (model.showSignature) {
      row += 2;
      var half = Math.max(1, Math.ceil(N / 2));
      var lines2 = [
        ["MEASURER", "CLIENT", label8],
        ["______________________", "______________________", font()],
        ["Printed name: ______________", "Printed name: ______________", font()],
        ["Date: __________", "Date: __________", font()]
      ];
      lines2.forEach(function (l, idx) {
        if (idx === 1) ws.getRow(row).height = 26;
        ws.getCell(row, 1).value = l[0]; ws.getCell(row, 1).font = l[2];
        ws.getCell(row, 1).alignment = { vertical: "bottom" };
        merge(row, 1, N > 1 ? half : 1);
        if (N > 1) {
          ws.getCell(row, half + 1).value = l[1]; ws.getCell(row, half + 1).font = l[2];
          ws.getCell(row, half + 1).alignment = { vertical: "bottom" };
          merge(row, half + 1, N);
        }
        row++;
      });
    }

    row += 1;
    ws.getCell(row, 1).value = ATTRIBUTION;
    ws.getCell(row, 1).font = font({ size: 8, color: { argb: C.ink3 } });
    ws.getCell(row, 1).alignment = { horizontal: "center" };
    merge(row, 1, N);
    ws.pageSetup.printArea = "A1:" + last + row;

    return wb.xlsx.writeBuffer();
  }

  // --- HTML (preview + print-to-PDF) ----------------------------------------

  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function renderHtml(model) {
    var h = [];
    var n = model.columns.length || 1;
    h.push('<div class="sheet' + (model.lowInk ? "" : " sheet--ink") + '">');
    h.push('<header class="sheet-band">');
    if (model.header.logo && model.header.logo.dataUrl) {
      h.push('<img class="sheet-logo" alt="" src="' + esc(model.header.logo.dataUrl) + '">');
    }
    h.push('<div><div class="sheet-title">' + esc(model.header.title) + "</div>");
    h.push('<div class="sheet-subtitle">' + esc(model.header.subtitle) + "</div></div></header>");
    h.push('<dl class="sheet-meta">');
    model.meta.forEach(function (m) {
      h.push("<div><dt>" + esc(m[0]) + "</dt><dd>" + esc(m[1]) + "</dd></div>");
      h.push("<div><dt>" + esc(m[2]) + "</dt><dd>" + esc(m[3]) + "</dd></div>");
    });
    h.push("</dl>");
    h.push('<table class="sheet-table"><thead><tr>');
    model.columns.forEach(function (c) { h.push('<th class="al-' + c.align + '">' + esc(c.label) + "</th>"); });
    h.push("</tr></thead><tbody>");
    var labelIdx = Math.max(0, model.columns.findIndex(function (c) { return c.key === "label"; }));
    model.groups.forEach(function (g) {
      if (model.grouping === "room") h.push('<tr class="sheet-room"><td colspan="' + n + '">' + esc(g.name) + "</td></tr>");
      g.rows.forEach(function (vals) {
        h.push("<tr>");
        vals.forEach(function (v, i) { h.push('<td class="al-' + model.columns[i].align + '">' + esc(v) + "</td>"); });
        h.push("</tr>");
      });
      if (model.showTotals && model.grouping === "room") {
        h.push('<tr class="sheet-sub">');
        if (labelIdx > 0) h.push('<td colspan="' + labelIdx + '"></td>');
        h.push('<td class="al-right" colspan="' + (n - labelIdx) + '">' + esc(groupTotalText(g)) + "</td></tr>");
      }
    });
    if (model.showTotals) h.push('<tr class="sheet-total"><td colspan="' + n + '">' + esc(jobTotalText(model.totals)) + "</td></tr>");
    h.push("</tbody></table>");
    if (model.terms !== null) {
      h.push('<section class="sheet-terms"><div class="sheet-label">TERMS</div><p>' + esc(model.terms).replace(/\n/g, "<br>") + "</p></section>");
    }
    if (model.showSignature) {
      var block = function (who) {
        return '<div><div class="sheet-label">' + who + '</div><div class="sig-line"></div>' +
          "<div>Printed name: ______________</div><div>Date: __________</div></div>";
      };
      h.push('<section class="sheet-sign">' + block("MEASURER") + block("CLIENT") + "</section>");
    }
    h.push('<footer class="sheet-attrib">' + esc(model.attribution) + "</footer></div>");
    return h.join("");
  }

  function fileName(project, ext) {
    var base = (project.client || project.name || "job") + "-" + (project.date || "");
    base = base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "job";
    return "measure-sheet-" + base + "." + ext;
  }

  return {
    ATTRIBUTION: ATTRIBUTION,
    cellValue: cellValue,
    buildModel: buildModel,
    generateXlsx: generateXlsx,
    renderHtml: renderHtml,
    fileName: fileName,
    letterspace: letterspace
  };
});
