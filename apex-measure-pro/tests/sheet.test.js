// Sheet model + xlsx generation in Node (ExcelJS is UMD, requireable). Run: node --test
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const R = require("../js/reduce.js");
const S = require("../js/store.js");
const P = require("../js/profile.js");
const Sheet = require("../js/sheet.js");
const ExcelJS = require("../vendor/exceljs.min.js");

const css = fs.readFileSync(path.join(__dirname, "..", "css", "tokens.css"), "utf8");
const tok = (k) => new RegExp("--" + k + ":\\s*(#[0-9A-Fa-f]{6})").exec(css)[1];
const palette = { paper: tok("paper"), ink: tok("ink"), ink2: tok("ink-2"), ink3: tok("ink-3"), rule: tok("rule"), ruleStrong: tok("rule-strong") };

function shot(v) { return R.makeShot(v, "laser"); }
function job() {
  const p = S.newProject({ client: "Smith", address: "1 Main St", date: "2026-09-28", name: "Job 7" });
  const room = p.rooms[0];
  room.name = "Kitchen";
  const w1 = S.addWindow(room);
  w1.width.shots = [shot(35.6), shot(35.51), shot(35.7)];
  w1.height.shots = [shot(48.2)];
  w1.mountType = "IB"; w1.controlSide = "left"; w1.controlType = "wand";
  S.recomputeOrdered(w1.width); S.recomputeOrdered(w1.height);
  const w2 = S.addWindow(room);
  w2.mountType = "OB";
  const bed = S.newRoom("Bedroom");
  p.rooms.push(bed);
  const w3 = S.addWindow(bed);
  w3.width.shots = [shot(24.8)]; S.recomputeOrdered(w3.width);
  w3.controlType = "other"; w3.controlTypeOther = "crank"; w3.notes = "tile sill";
  return p;
}

test("base model: columns, blank cells, Depth omitted when unused", () => {
  const m = Sheet.buildModel(job(), P.defaultProfile());
  assert.deepEqual(m.columns.map((c) => c.label), ["Room", "Window", "Mount", "Width", "Height", "Control", "Type", "Obstructions", "Notes"]);
  assert.deepEqual(m.groups[0].rows[0], ["Kitchen", "W1", "IB", '35 1/2"', '48 1/8"', "L", "wand", "", ""]);
  assert.deepEqual(m.groups[0].rows[1], ["Kitchen", "W2", "OB", "", "", "", "", "", ""]);
  assert.deepEqual(m.groups[1].rows[0], ["Bedroom", "W1", "", '24 3/4"', "", "", "crank", "", "tile sill"]);
  assert.deepEqual(m.totals, { windows: 3, rooms: 2 });
  assert.equal(m.attribution, "Measured with Apex Measure Pro");
});

test("Depth column appears when any window has depth", () => {
  const p = job();
  const w = p.rooms[0].windows[0];
  w.depth = S.newDimension(); w.depth.shots = [shot(3.3)]; S.recomputeOrdered(w.depth);
  const m = Sheet.buildModel(p, P.defaultProfile());
  assert.ok(m.columns.some((c) => c.key === "depthOrdered"));
  assert.equal(m.groups[0].rows[0][5], '3 1/4"');
});

test("unit re-renders only", () => {
  const p = job(); p.unit = "cm";
  const m = Sheet.buildModel(p, P.defaultProfile());
  assert.equal(m.groups[0].rows[0][3], "90.1 cm");
  assert.equal(m.meta[2][3], "cm");
  assert.equal(p.rooms[0].windows[0].width.ordered, 35.5);
});

test("attribution can't be switched off; unknown keys skipped not crashed", () => {
  const cfg = P.defaultProfile();
  cfg.attribution = false;
  cfg.columns.push({ key: "price", label: "Price", width: 8, align: "right" });
  const m = Sheet.buildModel(job(), cfg);
  assert.equal(m.attribution, "Measured with Apex Measure Pro");
  assert.ok(!m.columns.some((c) => c.key === "price"));
});

test("profile toggles: grouping none, no totals/terms/signature", () => {
  const cfg = Object.assign(P.defaultProfile(), { grouping: "none", showTotals: false, showTerms: false, showSignature: false });
  const m = Sheet.buildModel(job(), cfg);
  assert.equal(m.groups.length, 1);
  assert.equal(m.groups[0].rows.length, 3);
  assert.equal(m.terms, null);
  const html = Sheet.renderHtml(m);
  assert.ok(!/TERMS/.test(html) && !/TOTAL/.test(html) && /Measured with Apex Measure Pro/.test(html));
});

test("xlsx: generated workbook round-trips and matches §9.1", async () => {
  const cfg = P.defaultProfile();
  const buf = await Sheet.generateXlsx(Sheet.buildModel(job(), cfg), ExcelJS, palette);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);                          // test only — the app never parses xlsx
  const ws = wb.getWorksheet("Measure Sheet");
  assert.ok(ws);
  const all = [];
  ws.eachRow((row, n) => all.push([n, row.values.filter((v) => v !== undefined && v !== null).map(String)
    .filter((v, i, a) => i === 0 || v !== a[i - 1])]));        // merged cells repeat their value
  const text = all.map((r) => r[1].join("|")).join("\n");
  assert.match(text, /A.P.E.X/);
  assert.match(text, /Measure Sheet/);
  assert.match(text, /CLIENT\|Smith\|DATE\|2026-09-28/);
  assert.match(text, /Room\|Window\|Mount\|Width\|Height\|Control\|Type\|Obstructions\|Notes/);
  assert.match(text, /Kitchen — 2 windows/);
  assert.match(text, /TOTAL — 3 windows across 2 rooms/);
  assert.match(text, /TERMS/);
  assert.match(text, /\nMEASURER\|CLIENT\n/);
  assert.equal(all[all.length - 1][1][0], "Measured with Apex Measure Pro");
  assert.ok(!/Depth/.test(text));
  assert.equal(ws.views[0].state, "frozen");
  assert.equal(ws.pageSetup.fitToWidth, 1);
  // dropdown on Mount for a window row
  const hdr = all.find((r) => r[1][0] === "Room")[0];
  assert.deepEqual(ws.getCell(hdr + 2, 3).dataValidation.formulae, ['"IB,OB"']);
  assert.equal(ws.getCell(hdr + 2, 5).value, '48 1/8"');
  assert.equal(ws.getCell(hdr + 3, 4).value, null, "empty cells are blank, not em dash");
});

test("xlsx with a logo and a custom profile generates", async () => {
  const cfg = P.defaultProfile();
  cfg.companyName = "Blinds Co";
  cfg.logo = { dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", widthPx: 400, heightPx: 100 };
  cfg.columns = P.columnsFromPaste(P.parseHeaderPaste("Location\tW\tH\nMount"));
  const buf = await Sheet.generateXlsx(Sheet.buildModel(job(), cfg), ExcelJS, palette);
  assert.ok(buf.byteLength > 1000);
});

test("header paste maps known headers and leaves unknown ones unmapped", () => {
  const m = P.parseHeaderPaste("Room\tWidth\nHeight\nColour\nMount Type\n");
  assert.deepEqual(m, [
    { label: "Room", key: "room" }, { label: "Width", key: "widthOrdered" },
    { label: "Height", key: "heightOrdered" }, { label: "Colour", key: null },
    { label: "Mount Type", key: "mountType" }
  ]);
  assert.deepEqual(P.columnsFromPaste(m).map((c) => c.key), ["room", "widthOrdered", "heightOrdered", "mountType"]);
});

test("fileName is safe", () => {
  assert.equal(Sheet.fileName({ client: "O'Brien & Sons", date: "2026-09-28" }, "xlsx"), "measure-sheet-o-brien-sons-2026-09-28.xlsx");
});
