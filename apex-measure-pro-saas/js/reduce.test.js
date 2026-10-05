// Run: node --test   (from the project folder)
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("./reduce.js");

// Deterministic PRNG so property failures are reproducible.
function rng(seed) {
  return function () {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

// Mimic the wire: meters → the 4 bytes the D2 sends → decoded float.
function viaWire(meters) {
  const buf = new ArrayBuffer(4);
  new DataView(buf).setFloat32(0, meters, true);
  return R.decodeFloat32LE(buf);
}

test("§4.3 inch vectors", () => {
  const cases = [
    [35.000, '35"'], [35.124, '35"'], [35.125, '35 1/8"'], [35.126, '35 1/8"'],
    [35.249, '35 1/8"'], [35.999, '35 7/8"'], [36.000, '36"']
  ];
  for (const [inches, want] of cases) assert.equal(R.formatInches(inches), want, String(inches));
});

test("§4.3 meter vectors (float64 input)", () => {
  const cases = [
    [0.889, '35"'], [0.9017, '35 1/2"'], [0.9144, '36"'], [1.0, '39 1/4"'],
    [0.5, '19 5/8"'], [0.0254, '1"'], [0.003175, '1/8"'], [0.0, '0"']
  ];
  for (const [m, want] of cases) {
    assert.equal(R.formatInches(R.metersToInches(m)), want, m + " m direct");
    assert.equal(R.describeMeters(m).text, want, m + " m via ingest");
  }
});

test("§4.3 meter vectors survive the float32 wire", () => {
  const cases = [
    [0.889, '35"'], [0.9017, '35 1/2"'], [0.9144, '36"'], [1.0, '39 1/4"'],
    [0.5, '19 5/8"'], [0.0254, '1"'], [0.003175, '1/8"'], [0.0, '0"']
  ];
  for (const [m, want] of cases) assert.equal(R.describeMeters(viaWire(m)).text, want, m + " m via float32");
});

test("negative reading → em dash + invalid flag", () => {
  const d = R.describeMeters(-0.05);
  assert.equal(d.text, "—");
  assert.equal(d.invalid, true);
  assert.equal(d.rounded, null);
  assert.equal(R.makeShot(-1, "laser"), null);
  assert.equal(R.formatInches(-1.27), "—");
});

test("bytes D0 D5 66 3F decode to 0.9017000198364258 m → 35 1/2\"", () => {
  const bytes = new Uint8Array([0xD0, 0xD5, 0x66, 0x3F]);
  const m = R.decodeFloat32LE(bytes.buffer);
  assert.equal(m, 0.9017000198364258);
  assert.equal(R.describeMeters(m).text, '35 1/2"');
  // DataView input works too
  assert.equal(R.decodeFloat32LE(new DataView(bytes.buffer)), m);
  assert.equal(R.decodeFloat32LE(bytes), m);
});

test("every exact eighth 0\"–400\" survives meters → float32 → inches unchanged", () => {
  for (let e = 0; e <= 3200; e++) {
    const inches = e / 8;
    const decoded = viaWire(inches * 0.0254);
    assert.equal(R.floorEighth(R.laserToInches(decoded)), inches, inches + '"');
  }
});

test("every whole millimetre and tenth-mm to 5 m floors as its exact decimal", () => {
  for (let tenths = 0; tenths <= 50000; tenths++) {
    const m = tenths / 10000;
    // exact eighths at or below a tenth-mm value, in integers:
    // inches*8 = tenths_mm * 8 / 254
    const wantEighths = Math.floor((tenths * 8) / 254);
    assert.equal(R.floorEighth(R.laserToInches(viaWire(m))), wantEighths / 8, tenths / 10 + " mm");
  }
});

test("property: never rounds up", () => {
  const r = rng(1);
  for (let i = 0; i < 20000; i++) {
    const raw = r() * 400;
    assert.ok(R.floorEighth(raw) <= raw, String(raw));
    assert.ok(raw - R.floorEighth(raw) < 0.125, String(raw));
  }
});

test("property: fractions always reduced", () => {
  const allowed = new Set(["", "1/8", "1/4", "3/8", "1/2", "5/8", "3/4", "7/8"]);
  const r = rng(2);
  for (let i = 0; i < 5000; i++) {
    const s = R.formatInches(r() * 200);
    const m = /(\d+\/\d+)"$/.exec(s);
    assert.ok(allowed.has(m ? m[1] : ""), s);
    assert.ok(!/[2468]\/8/.test(s) && !/2\/4/.test(s), s);
  }
  assert.equal(R.formatInches(35.5), '35 1/2"');
  assert.equal(R.formatInches(35.625), '35 5/8"');
  assert.equal(R.formatInches(35.875), '35 7/8"');
});

test("property: orderedValue === floorEighth(min)", () => {
  const r = rng(3);
  for (let i = 0; i < 5000; i++) {
    const a = r() * 100, b = r() * 100, c = r() * 100;
    assert.equal(R.orderedValue([a, b, c]), R.floorEighth(Math.min(a, b, c)));
    assert.equal(R.orderedValue([a, b, c]), Math.min(R.floorEighth(a), R.floorEighth(b), R.floorEighth(c)));
    assert.equal(R.orderedValue([a]), R.floorEighth(a));
  }
  assert.equal(R.orderedValue([]), null);
});

test("§5.2 inch format", () => {
  assert.equal(R.formatInches(35), '35"');
  assert.equal(R.formatInches(35.5), '35 1/2"');
  assert.equal(R.formatInches(0.125), '1/8"');
  assert.equal(R.formatInches(0), '0"');
  assert.equal(R.formatInches(null), "—");
  assert.equal(R.formatInches(undefined), "—");
});

test("§5.3 feet-inches format", () => {
  const cases = [
    [12, "1'"], [96, "8'"], [35, `2' 11"`], [100, `8' 4"`], [35.5, `2' 11 1/2"`],
    [35.125, `2' 11 1/8"`], [24.75, `2' 3/4"`], [0.5, '1/2"'], [0, '0"']
  ];
  for (const [v, want] of cases) assert.equal(R.formatFtIn(v), want, String(v));
  assert.equal(R.formatFtIn(null), "—");
});

test("§5.4 centimetre format", () => {
  const cases = [[35, "88.9 cm"], [35.125, "89.2 cm"], [35.5, "90.1 cm"], [96, "243.8 cm"], [0.5, "1.2 cm"], [0, "0.0 cm"]];
  for (const [v, want] of cases) assert.equal(R.formatCm(v), want, String(v));
  assert.equal(R.formatCm(null), "—");
});

test("formatLength dispatches on unit and never changes the stored value", () => {
  const v = 35.5;
  assert.equal(R.formatLength(v, "in"), '35 1/2"');
  assert.equal(R.formatLength(v, "ftin"), `2' 11 1/2"`);
  assert.equal(R.formatLength(v, "cm"), "90.1 cm");
  assert.equal(v, 35.5);
});

test("makeShot: manual and laser are the same shape", () => {
  assert.deepEqual(R.makeShot(35.5, "manual"), { raw: 35.5, rounded: 35.5, source: "manual" });
  assert.deepEqual(R.makeShot(35.51, "laser"), { raw: 35.51, rounded: 35.5, source: "laser" });
});

test("spoken fractions (§12)", () => {
  assert.equal(R.speakInches(35.125), "35 and 1 8th inches");
  assert.equal(R.speakInches(35.5), "35 and 1 half inches");
  assert.equal(R.speakInches(35.75), "35 and 3 4ths inches");
  assert.equal(R.speakInches(35.375), "35 and 3 8ths inches");
  assert.equal(R.speakInches(35), "35 inches");
  assert.equal(R.speakInches(0.125), "1 8th of an inch");
  assert.ok(!/\//.test(R.speakInches(12.625)));
});

test("manual parsing", () => {
  assert.equal(R.parseManual("34 7/8", "in"), 34.875);
  assert.equal(R.parseManual("34-7/8\"", "in"), 34.875);
  assert.equal(R.parseManual("7/8", "in"), 0.875);
  assert.equal(R.parseManual("34.875", "in"), 34.875);
  assert.equal(R.parseManual("34", "in"), 34);
  assert.equal(R.parseManual("2' 11 1/2\"", "ftin"), 35.5);
  assert.equal(R.parseManual("8'", "ftin"), 96);
  assert.equal(R.parseManual("35 1/2", "ftin"), 35.5);
  assert.equal(R.parseManual("88.9", "cm"), 88.9 / 2.54);
  assert.equal(R.parseManual("88,9", "cm"), 88.9 / 2.54);
  assert.equal(R.parseManual("abc", "in"), null);
  assert.equal(R.parseManual("-3", "in"), null);
  assert.equal(R.parseManual("3/0", "in"), null);
  assert.equal(R.parseManual("", "in"), null);
});

test("variance advisory and winning shot", () => {
  const shots = [35.5, 35.125, 35.25].map((v) => R.makeShot(v, "laser"));
  const v = R.variance(shots);
  assert.equal(v.spread, 0.375);
  assert.equal(v.advisory, true);
  assert.equal(v.text, 'Shots differ by 3/8" — check');
  assert.equal(R.winningIndex(shots), 1);
  assert.equal(R.variance([R.makeShot(35, "laser"), R.makeShot(35.1, "laser")]).advisory, false);
  assert.equal(R.winningIndex([]), -1);
});
