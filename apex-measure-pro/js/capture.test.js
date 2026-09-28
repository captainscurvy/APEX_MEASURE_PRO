// Run: node --test   (from the project folder)
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("./capture.js");

// Drive a sequence of events; returns final state and all effects.
function run(events, ctx, start) {
  let state = start || C.initialState();
  const effects = [];
  for (const e of events) {
    const r = C.step(state, e, ctx);
    state = r.state;
    effects.push(...r.effects);
  }
  return { state, effects };
}
const commits = (fx) => fx.filter((e) => e.type === "commit");

test("basic loop: arm → reading → 3s lock → auto-advance", () => {
  const { state, effects } = run([
    { type: "arm", field: "width.0" },
    { type: "reading", value: 35.5, now: 1000 },
    { type: "tick", now: 3999 },
  ]);
  assert.equal(commits(effects).length, 0, "not locked before 3s");
  const r = C.step(state, { type: "tick", now: 4000 });
  assert.deepEqual(commits(r.effects), [{ type: "commit", field: "width.0", value: 35.5, source: "laser" }]);
  assert.equal(r.state.armed, "width.1");
  assert.equal(r.state.pending, null);
});

test("§7.2 new laser reading during countdown replaces value and resets timer to 3s", () => {
  const { state, effects } = run([
    { type: "arm", field: "width.0" },
    { type: "reading", value: 40, now: 0 },
    { type: "reading", value: 35.5, now: 2500 },
    { type: "tick", now: 3000 },          // original deadline passes — must NOT lock
  ]);
  assert.equal(commits(effects).length, 0);
  assert.equal(state.deadline, 5500);
  const r = C.step(state, { type: "tick", now: 5500 });
  assert.equal(commits(r.effects)[0].value, 35.5);
});

test("§7.2 user typing cancels the timer entirely; commits on Enter", () => {
  const { state, effects } = run([
    { type: "arm", field: "height.0" },
    { type: "reading", value: 50, now: 0 },
    { type: "keystroke", value: 3 },
    { type: "keystroke", value: 34.875 },
    { type: "tick", now: 60000 },
  ]);
  assert.equal(commits(effects).length, 0, "timer never fires while typing");
  assert.equal(state.deadline, null);
  assert.equal(state.typing, true);
  const r = C.step(state, { type: "commit" });
  assert.deepEqual(commits(r.effects)[0], { type: "commit", field: "height.0", value: 34.875, source: "manual" });
  assert.equal(r.state.armed, "height.1");
});

test("§7.2 unparseable typing leaves nothing pending", () => {
  const { state } = run([{ type: "arm", field: "width.0" }, { type: "keystroke", value: null }]);
  assert.equal(state.pending, null);
  const r = C.step(state, { type: "commit" });
  assert.equal(commits(r.effects).length, 0);
});

test("§7.2 tapping a different field commits the pending value immediately, then arms it", () => {
  const { state, effects } = run([
    { type: "arm", field: "width.0" },
    { type: "reading", value: 35.5, now: 0 },
    { type: "tapOther", field: "height.2" },
  ]);
  assert.deepEqual(commits(effects), [{ type: "commit", field: "width.0", value: 35.5, source: "laser" }]);
  assert.equal(state.armed, "height.2");
  assert.equal(state.pending, null);
  assert.equal(state.deadline, null);
});

test("§7.2 tapping a text field commits too, and text fields run no timer", () => {
  const { state, effects } = run([
    { type: "arm", field: "width.0" },
    { type: "reading", value: 35.5, now: 0 },
    { type: "tapOther", field: "notes" },
    { type: "reading", value: 10, now: 100 },
    { type: "tick", now: 99999 },
  ]);
  assert.equal(commits(effects).length, 1);
  assert.equal(state.armed, "notes");
  assert.equal(state.deadline, null);
  assert.ok(effects.some((e) => e.type === "ignored" && e.reason === "not-shot-field"));
});

test("§7.2 app backgrounded commits immediately and cancels the timer; focus on next field", () => {
  const { state, effects } = run([
    { type: "arm", field: "width.2" },
    { type: "reading", value: 35.5, now: 0 },
    { type: "visibilityHidden" },
  ]);
  assert.equal(commits(effects).length, 1);
  assert.equal(state.deadline, null);
  assert.equal(state.armed, "height.0");
  // no stray lock later
  const r = C.step(state, { type: "tick", now: 1e9 });
  assert.equal(commits(r.effects).length, 0);
});

test("§7.2 device disconnect commits the pending value", () => {
  const { state, effects } = run([
    { type: "arm", field: "width.0" },
    { type: "reading", value: 35.5, now: 0 },
    { type: "disconnect" },
  ]);
  assert.deepEqual(commits(effects), [{ type: "commit", field: "width.0", value: 35.5, source: "laser" }]);
  assert.equal(state.pending, null);
});

test("§7.2 same value shot twice replaces and resets timer (no dedupe)", () => {
  const { state, effects } = run([
    { type: "arm", field: "width.0" },
    { type: "reading", value: 35.5, now: 0 },
    { type: "reading", value: 35.5, now: 2000 },
    { type: "tick", now: 3000 },
  ]);
  assert.equal(effects.filter((e) => e.type === "reading").length, 2);
  assert.equal(commits(effects).length, 0);
  assert.equal(state.deadline, 5000);
});

test("throttled timer: a late tick still locks the value that was pending at the deadline", () => {
  const { state } = run([{ type: "arm", field: "width.0" }, { type: "reading", value: 35.5, now: 0 }]);
  const r = C.step(state, { type: "tick", now: 45000 });   // setTimeout fired 42s late
  assert.equal(commits(r.effects)[0].value, 35.5);
});

test("§7.1 field order through a whole window", () => {
  const filled = new Set();
  const ctx = { isFilled: (f) => filled.has(f) };
  let state = C.initialState();
  let r = C.step(state, { type: "arm", field: "width.0" }, ctx);
  state = r.state;
  const visited = [state.armed];
  let t = 0;
  for (let i = 0; i < 6; i++) {
    r = C.step(state, { type: "reading", value: 30 + i, now: t }, ctx); state = r.state;
    t += 3000;
    r = C.step(state, { type: "tick", now: t }, ctx); state = r.state;
    commits(r.effects).forEach((c) => filled.add(c.field));
    visited.push(state.armed);
  }
  for (const [f, v] of [["mountType", "IB"], ["controlSide", "left"], ["controlType", "wand"], ["obstructions", ""]]) {
    r = C.step(state, { type: "set", field: f, value: v }, ctx); state = r.state;
    filled.add(f);
    visited.push(state.armed);
  }
  r = C.step(state, { type: "set", field: "notes", value: "" }, ctx);
  assert.deepEqual(visited, [
    "width.0", "width.1", "width.2", "height.0", "height.1", "height.2",
    "mountType", "controlSide", "controlType", "obstructions", "notes"
  ]);
  assert.deepEqual(r.effects.find((e) => e.type === "advance"), { type: "advance", from: "notes", to: null });
  assert.equal(r.state.armed, null);
});

test("depth is not in the auto-advance path, and ends after its own 3 slots", () => {
  assert.equal(C.SEQUENCE.some((f) => f.startsWith("depth")), false);
  assert.equal(C.nextField("depth.0"), "depth.1");
  assert.equal(C.nextField("depth.2"), null);
});

test("advancing skips filled slots, so a re-shoot never lands on a full slot", () => {
  const filled = new Set(["width.1", "width.2"]);
  assert.equal(C.nextField("width.0", (f) => filled.has(f)), "height.0");
  assert.equal(C.nextField("width.3"), "height.0", "extra shot continues to height");
  assert.equal(C.nextField("height.4"), "mountType");
});

test("shot cap: a 6th slot is refused, never an error", () => {
  const r = C.step(C.initialState(), { type: "arm", field: "width.5" });
  assert.deepEqual(r.effects, [{ type: "ignored", reason: "cap" }]);
  assert.equal(r.state.armed, null);
});

test("reading with nothing armed is ignored", () => {
  const r = C.step(C.initialState(), { type: "reading", value: 3, now: 0 });
  assert.deepEqual(r.effects, [{ type: "ignored", reason: "not-armed" }]);
});

test("re-tapping the armed field keeps its pending value", () => {
  const { state, effects } = run([
    { type: "arm", field: "width.0" },
    { type: "reading", value: 35.5, now: 0 },
    { type: "arm", field: "width.0" },
  ]);
  assert.equal(commits(effects).length, 0);
  assert.equal(state.pending.value, 35.5);
});

test("disarm commits pending and clears", () => {
  const { state, effects } = run([
    { type: "arm", field: "width.0" },
    { type: "reading", value: 35.5, now: 0 },
    { type: "disarm" },
  ]);
  assert.equal(commits(effects).length, 1);
  assert.equal(state.armed, null);
});

test("remaining() and labels", () => {
  const { state } = run([{ type: "arm", field: "width.0" }, { type: "reading", value: 1, now: 0 }]);
  assert.equal(C.remaining(state, 1500), 0.5);
  assert.equal(C.remaining(state, 4000), 0);
  assert.equal(C.fieldLabel("width.0"), "Width shot 1");
  assert.equal(C.fieldLabel("mountType"), "Mount type");
});
