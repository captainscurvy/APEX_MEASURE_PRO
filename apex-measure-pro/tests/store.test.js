// Pure parts of store.js: model, labels, completeness, migrations, §14.3 import validation.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../js/store.js");
const P = require("../js/profile.js");

test("§10.2 new project: date today, unit in, one room named Room 1", () => {
  const p = S.newProject({});
  assert.equal(p.date, S.today());
  assert.equal(p.unit, "in");
  assert.equal(p.rooms.length, 1);
  assert.equal(p.rooms[0].name, "Room 1");
  assert.equal(p.schemaVersion, 1);
});

test("§6 window shape includes reserved history[] and depth null", () => {
  const w = S.newWindow("W1");
  assert.deepEqual(w.history, []);
  assert.equal(w.depth, null);
  assert.deepEqual(w.width, { shots: [], ordered: null });
});

test("§8.5 labels never recomputed after rename or delete", () => {
  const r = S.newRoom("R");
  S.addWindow(r); const w2 = S.addWindow(r); S.addWindow(r);
  w2.label = "Bay left";
  r.windows.splice(2, 1);                // delete W3
  assert.equal(S.addWindow(r).label, "W4");
});

test("§8.3 completeness counts width + height + mount only", () => {
  const w = S.newWindow("W1");
  assert.equal(S.isWindowComplete(w), false);
  w.width.shots.push({ raw: 1, rounded: 1, source: "manual" });
  w.height.shots.push({ raw: 1, rounded: 1, source: "manual" });
  assert.equal(S.isWindowComplete(w), false);
  w.mountType = "OB";
  assert.equal(S.isWindowComplete(w), true);
});

test("display name", () => {
  assert.equal(S.displayName({ client: "Smith", date: "2026-09-28" }), "Smith — 2026-09-28");
  assert.equal(S.displayName({ client: "", date: "2026-09-28" }), "2026-09-28");
});

test("§10.4 migration policy", () => {
  assert.deepEqual(S.migrate({ a: 1 }, 1), { ok: true, data: { a: 1, schemaVersion: 1 } });
  const newer = S.migrate({}, 2);
  assert.equal(newer.ok, false);
  assert.equal(newer.error, "This file was created by a newer version of the app. Update to open it.");
  assert.equal(S.migrate({}, 0).ok, false, "no migration registered from 0");
  assert.deepEqual(Object.keys(S.MIGRATIONS), []);
});

test("project export → import round-trip", () => {
  const p = S.newProject({ client: "Smith" });
  const w = S.addWindow(p.rooms[0]);
  w.width.shots.push({ raw: 35.51, rounded: 35.5, source: "laser" });
  S.recomputeOrdered(w.width);
  const r = S.validateImport(S.exportFile("project", p));
  assert.equal(r.ok, true, r.error);
  assert.equal(r.type, "project");
  assert.deepEqual(r.data, p);
});

test("profile export → import round-trip", () => {
  const prof = P.defaultProfile();
  const r = S.validateImport(S.exportFile("profile", prof));
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.data, prof);
});

test("§14.3 six ordered failures, each with its specific message", () => {
  const good = JSON.parse(S.exportFile("project", S.newProject({})));
  const cases = [
    ["{not json", "That file isn't valid JSON."],
    [JSON.stringify({ type: "project", data: {} }), "This file is missing a version and can't be read."],
    [JSON.stringify({ schemaVersion: "1", type: "project", data: {} }), "This file is missing a version and can't be read."],
    [JSON.stringify({ ...good, schemaVersion: 99 }), "This file was created by a newer version of the app. Update to open it."],
    [JSON.stringify({ ...good, type: "invoice" }), "Unrecognized file type."],
    [JSON.stringify({ ...good, data: { id: "x", unit: "in" } }), "This file is missing required fields: date, rooms."],
    [JSON.stringify({ ...good, data: { ...good.data, unit: "furlong" } }), "Unexpected data in: unit."],
  ];
  for (const [text, msg] of cases) assert.equal(S.validateImport(text).error, msg);
  // earlier checks win: a newer file with a bad type reports the version first
  assert.equal(S.validateImport(JSON.stringify({ schemaVersion: 5, type: "x" })).error, S.MSG_NEWER);
  // deep type errors
  const bad = JSON.parse(JSON.stringify(good));
  bad.data.rooms[0].windows.push({ ...S.newWindow("W1"), mountType: "ceiling" });
  assert.equal(S.validateImport(JSON.stringify(bad)).error, "Unexpected data in: rooms[0].windows[0].mountType.");
});

test("§14.2 corrupted record is reported, not thrown", () => {
  const r = S.loadRecord({ id: "abc", schemaVersion: 1, rooms: "oops" });
  assert.equal(r.ok, false);
  assert.equal(r.id, "abc");
  assert.equal(r.error, "This project couldn't be loaded. Its raw data has been preserved.");
  assert.deepEqual(r.raw, { id: "abc", schemaVersion: 1, rooms: "oops" });
  const newer = S.loadRecord({ id: "n", schemaVersion: 7 });
  assert.equal(newer.ok, false);
  assert.equal(newer.error, S.MSG_NEWER);
});
