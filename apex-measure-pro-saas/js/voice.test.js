"use strict";
const test = require("node:test");
const assert = require("node:assert");
const V = require("./voice.js");
const R = require("./reduce.js");

function val(text, opts) {
  const r = V.parse(text, opts);
  assert.ok(r.ok, `expected ok for "${text}" got ${JSON.stringify(r)}`);
  return r.inches;
}
function rejects(text, reason, opts) {
  const r = V.parse(text, opts);
  assert.strictEqual(r.ok, false, `expected reject for "${text}" got ${JSON.stringify(r)}`);
  if (reason) assert.strictEqual(r.reason, reason, `"${text}" → ${r.reason}`);
}

test("cardinal words and digits", () => {
  const cases = [
    ["thirty four", 34], ["thirty-four", 34], ["34", 34], ["fifty two", 52], ["fifteen", 15], ["fifty", 50],
    ["sixteen", 16], ["sixty", 60], ["thirteen", 13], ["thirty", 30], ["eighteen", 18], ["eighty", 80],
    ["nineteen", 19], ["ninety", 90], ["six", 6], ["twelve", 12], ["twenty", 20],
    ["one hundred", 100], ["one hundred twenty", 120], ["one hundred and twenty three", 123],
    ["two hundred", 200], ["two hundred forty", 240], ["one oh two", 102], ["one zero two", 102],
    ["two oh five", 205], ["one hundred and five", 105]
  ];
  cases.forEach(([s, v]) => assert.strictEqual(val(s), v, s));
});

test("every eighth, words and digits", () => {
  const w = { 1: "an eighth", 2: "a quarter", 3: "three eighths", 4: "a half", 5: "five eighths", 6: "three quarters", 7: "seven eighths" };
  for (let n = 1; n <= 7; n++) {
    assert.strictEqual(val("thirty four and " + w[n]), 34 + n / 8, w[n]);
    assert.strictEqual(val("34 " + n + "/8"), 34 + n / 8, n + "/8");
    assert.strictEqual(val("34 and " + n + "/8"), 34 + n / 8);
    assert.strictEqual(val("thirty four " + (n === 2 ? "one quarter" : n === 4 ? "one half" : n === 6 ? "three quarters" : n + " eighths")), 34 + n / 8);
  }
  assert.strictEqual(val("34 seven eighths"), 34.875);
  assert.strictEqual(val("thirty four seven eighths"), 34.875);
});

test("fractions: halves, quarters, sixteenths, thirty-seconds", () => {
  assert.strictEqual(val("fifty two and a half"), 52.5);
  assert.strictEqual(val("fifty two and one half"), 52.5);
  assert.strictEqual(val("forty one and three sixteenths"), 41.1875);
  assert.strictEqual(val("forty one and 3/16"), 41.1875);
  assert.strictEqual(val("thirty four and twenty nine thirty seconds"), 34 + 29 / 32);
  assert.strictEqual(val("thirty four and 29/32"), 34 + 29 / 32);
  assert.strictEqual(val("thirty four and a thirty second"), 34 + 1 / 32);
  assert.strictEqual(val("twenty and fifteen sixteenths"), 20 + 15 / 16);
  assert.strictEqual(val("34 and three fourths"), 34.75);
  assert.strictEqual(val("34 and 1/2"), 34.5);
  assert.strictEqual(val("34 3/4\""), 34.75);
  assert.strictEqual(val("34-7/8"), 34.875);
  assert.strictEqual(val("34½"), 34.5);
  assert.strictEqual(val("34 ⅞"), 34.875);
});

test("decimals", () => {
  assert.strictEqual(val("thirty four point eight seven five"), 34.875);
  assert.strictEqual(val("34.875"), 34.875);
  assert.strictEqual(val("34 point 875"), 34.875);
  assert.strictEqual(val("thirty four point five"), 34.5);
  assert.strictEqual(val("thirty four point oh five"), 34.05);
  assert.strictEqual(val("point seven five", { kind: "depth" }), 0.75);
  assert.strictEqual(val("34.93"), 34.93);
});

test("units and filler", () => {
  assert.strictEqual(val("thirty four inches"), 34);
  assert.strictEqual(val("34 inch"), 34);
  assert.strictEqual(val("34 in"), 34);
  assert.strictEqual(val('34 7/8"'), 34.875);
  assert.strictEqual(val("34 and a half inches"), 34.5);
  assert.strictEqual(val("thirty four inches and seven eighths"), 34.875);
  assert.strictEqual(val("uh okay the width is thirty four and seven eighths"), 34.875);
  assert.strictEqual(val("it's 52 and a half please"), 52.5);
  assert.strictEqual(val("Thirty-Four And Seven Eighths."), 34.875);
  assert.strictEqual(val("  thirty   four  "), 34);
});

test("feet and inches", () => {
  assert.strictEqual(val("two feet three and a half"), 27.5);
  assert.strictEqual(val("two feet"), 24);
  assert.strictEqual(val("six foot two"), 74);
  assert.strictEqual(val("five feet and three inches"), 63);
  assert.strictEqual(val("2' 3 1/2\""), 27.5);
  assert.strictEqual(val("3'"), 36);
  assert.strictEqual(val("two feet seven eighths"), 24.875);
  assert.strictEqual(val("2 ft 10"), 34);
  rejects("two feet thirty", "invalid");
  rejects("two feet twelve", "invalid");
  rejects("two feet three three");
});

test("floored read-back says both when they differ", () => {
  const r = V.parse("thirty four and twenty nine thirty seconds");
  assert.strictEqual(r.inches, 34 + 29 / 32);
  assert.strictEqual(r.floored, 34.875);
  assert.strictEqual(r.floored, R.floorEighth(r.inches));
  assert.strictEqual(r.exact, false);
  assert.match(r.display, /34 and 29 thirty-seconds inches, recorded as 34 and 7 eighths inches/);
  const e = V.parse("thirty four and seven eighths");
  assert.strictEqual(e.exact, true);
  assert.strictEqual(e.display, "34 and 7 eighths inches");
  assert.strictEqual(e.text, R.formatInches(34.875));
  const d = V.parse("thirty four point nine three");
  assert.strictEqual(d.floored, 34.875);
  assert.match(d.display, /recorded as 34 and 7 eighths/);
  assert.strictEqual(V.parse("one inch", { min: 0 }).display, "1 inch");
  assert.strictEqual(V.parse("a half", { min: 0 }).display, "a half of an inch".replace("a half of an inch", "a half of an inch"));
  assert.strictEqual(V.parse("fifty two and a half").display, "52 and a half inches");
  assert.strictEqual(V.parse("34 and three quarters").display, "34 and 3 quarters inches");
});

test("raw inches are returned unfloored", () => {
  assert.strictEqual(val("34.99"), 34.99);
  assert.ok(Math.abs(val("thirty four and 31/32") - 34.96875) < 1e-12);
});

test("range limits per field kind", () => {
  rejects("five", "out-of-range");
  assert.strictEqual(val("six"), 6);
  assert.strictEqual(val("two hundred forty"), 240);
  rejects("two hundred forty one", "out-of-range");
  rejects("two fifty", "unparsed");
  rejects("one hundred fifty five thousand");
  assert.strictEqual(val("two hundred"), 200);
  rejects("zero", "out-of-range");
  rejects("three quarters", "out-of-range");
  assert.strictEqual(val("three quarters", { kind: "depth" }), 0.75);
  assert.strictEqual(val("a quarter inch", { kind: "depth" }), 0.25);
  rejects("fifty", "out-of-range", { kind: "depth" });
  assert.strictEqual(val("forty eight", { kind: "depth" }), 48);
  rejects("one eighth", "out-of-range", { kind: "depth" });
  assert.strictEqual(val("fifty", { min: 40, max: 60 }), 50);
  const oor = V.parse("three hundred");
  assert.strictEqual(oor.ok, false);
  assert.strictEqual(oor.inches, 300);
});

test("empty and filler-only", () => {
  rejects("", "empty");
  rejects("   ", "empty");
  rejects("uh", "empty");
  rejects("okay the width is", "empty");
  rejects(null, "empty");
  rejects(undefined, "empty");
});

test("garbage tails and partial parses are rejected", () => {
  [
    "thirty four and seven eighths blah", "thirty four banana", "thirty four seven", "34 7", "34 7/9",
    "34 and", "34 and seven", "thirty four and a", "34 and 8/8", "34 and 9/8", "thirty four eight eighths",
    "thirty four two halves", "34 point", "34 point five and a half", "thirty four seven eighths seven",
    "thirty four inches inches", "inches", "and a half", "34 and a half and a half",
    "one two three", "three four", "twenty thirty", "thirty four sixty", "twenty twenty",
    "thirty four feet" /* feet with no inches is 408 → out of range handled below */
  ].forEach((s) => assert.strictEqual(V.parse(s).ok, false, s));
});

test("hedges and homophones are rejected, never corrected", () => {
  [
    "about thirty four", "around thirty four", "roughly fifty", "maybe thirty four", "thirty four or so", "thirty four ish",
    "to", "too", "thirty to", "thirty four and seven ate", "thirty for", "thirty four won half", "won hundred",
    "tree", "fife", "sex", "fifty tu", "thirty fore", "free", "tin", "nein", "sicks", "for", "ate",
    "thirty four and seven eights", "thirty four and a haf", "fourty", "thirty-four-ish", "thirty fo"
  ].forEach((s) => assert.strictEqual(V.parse(s).ok, false, s));
});

test("ambiguous grouping without 'and' is rejected", () => {
  rejects("twenty one half");
  rejects("thirty seven eighths");
  rejects("forty one sixteenths");
  rejects("twenty one eighth");
  rejects("thirty four a half");
  rejects("one hundred seven eighths");
  assert.strictEqual(val("twenty and one half"), 20.5);
  assert.strictEqual(val("twenty one and a half"), 21.5);
  assert.strictEqual(val("one hundred and seven eighths"), 100.875);
  assert.strictEqual(val("one hundred and twenty and seven eighths"), 120.875);
});

test("look-alike pairs parse to distinct values (alternatives disambiguate)", () => {
  const pairs = [["thirteen", "thirty"], ["fourteen", "forty"], ["fifteen", "fifty"], ["sixteen", "sixty"],
    ["seventeen", "seventy"], ["eighteen", "eighty"], ["nineteen", "ninety"]];
  pairs.forEach(([a, b]) => assert.notStrictEqual(val(a), val(b)));
  pairs.forEach(([a, b]) => {
    const r = V.parseAlternatives([a, b]);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, "ambiguous");
    assert.strictEqual(r.candidates.length, 2);
  });
  const r = V.parseAlternatives(["fifty two and a half", "fifteen and a half"]);
  assert.strictEqual(r.reason, "ambiguous");
});

test("parseAlternatives: agreement and disagreement", () => {
  let r = V.parseAlternatives(["thirty four", "34", "thirty four inches"]);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.inches, 34);
  assert.strictEqual(r.agreed, 3);
  r = V.parseAlternatives(["thirty four", "thirty four and a half"]);
  assert.strictEqual(r.reason, "ambiguous");
  assert.deepStrictEqual(r.candidates.map((c) => c.inches), [34, 34.5]);
  // unparsable lower alternatives are not plausible candidates
  r = V.parseAlternatives(["thirty four", "thirty for", "dirty four"]);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.inches, 34);
  // an unparsable TOP is never rescued by a lower alternative
  r = V.parseAlternatives(["thirty for", "thirty four"]);
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(V.parseAlternatives([]), { ok: false, reason: "empty", candidates: [] });
  assert.strictEqual(V.parseAlternatives(["", "  "]).reason, "empty");
  assert.strictEqual(V.parseAlternatives(["three hundred", "three hundred"]).reason, "out-of-range");
  assert.strictEqual(V.parseAlternatives(["three hundred", "thirty"]).reason, "ambiguous");
  r = V.parseAlternatives([{ transcript: "thirty four" }, { transcript: "thirty four" }]);
  assert.strictEqual(r.ok, true);
});

test("commands", () => {
  const cmds = {
    next: ["next", "next field", "okay next"], back: ["back", "previous", "go back"], undo: ["undo", "undo that"],
    clear: ["clear"], confirm: ["lock", "confirm", "yes", "correct", "that's right", "that is right", "Lock it."],
    cancel: ["cancel", "no", "wrong", "that's wrong", "try again"],
    inside: ["inside mount"], outside: ["outside mount"], left: ["left"], right: ["right"], depth: ["depth"], stop: ["stop"]
  };
  Object.keys(cmds).forEach((k) => cmds[k].forEach((s) => {
    const r = V.parseCommand(s);
    assert.ok(r.ok, s);
    assert.strictEqual(r.command, k, s);
  }));
  ["nexts", "know", "next thirty four", "yes thirty four", "mount", "inside", "write", "bleft", ""].forEach((s) =>
    assert.strictEqual(V.parseCommand(s).ok, false, s));
  assert.strictEqual(V.parse("next").ok, false);
});

test("commands via parseAlternatives", () => {
  let r = V.parseAlternatives(["yes", "yes"]);
  assert.ok(r.ok);
  assert.strictEqual(r.command, "confirm");
  r = V.parseAlternatives(["yes", "no"]);
  assert.strictEqual(r.reason, "ambiguous");
  r = V.parseAlternatives(["yes", "thirty four"]);
  assert.strictEqual(r.reason, "ambiguous");
  r = V.parseAlternatives(["left", "write"]);
  assert.ok(r.ok && r.command === "left");
  r = V.parseAlternatives(["next", "fifty"]);
  assert.strictEqual(r.reason, "ambiguous");
  r = V.parseAlternatives(["thirty four", "yes"], { commands: true });
  assert.strictEqual(r.reason, "ambiguous");
  r = V.parseAlternatives(["depth", "depth"]);
  assert.ok(r.ok && r.command === "depth");
});

test("centimetres", () => {
  const r = V.parse("eighty eight point nine", { unit: "cm" });
  assert.ok(r.ok);
  assert.ok(Math.abs(r.inches - 88.9 / 2.54) < 1e-9);
  assert.ok(V.parse("88,9 centimeters", { unit: "cm" }).ok);
  assert.ok(V.parse("90 cm", { unit: "cm" }).ok);
  assert.strictEqual(V.parse("34 and a half", { unit: "cm" }).ok, false);
  assert.strictEqual(V.parse("5", { unit: "cm" }).ok, false);
});

test("symbols and negatives are never dropped", () => {
  rejects("-34");
  rejects("minus thirty four");
  rejects("thirty four #");
  rejects("34 ± 1");
  rejects("34 +");
  rejects("34 * 2");
  rejects("1,200");
  rejects("007");
  rejects("12345");
  rejects("34..5");
  rejects("3.4.5");
});

test("never throws", () => {
  [123, {}, [], NaN, true, "\u0000", "a".repeat(10000)].forEach((x) => {
    assert.doesNotThrow(() => V.parse(x));
    assert.doesNotThrow(() => V.parseAlternatives([x, x]));
    assert.doesNotThrow(() => V.parseCommand(x));
  });
  assert.doesNotThrow(() => V.parseAlternatives(null));
});

test("property: an unknown number-ish word anywhere makes the parse fail", () => {
  const valid = ["thirty four", "thirty four and seven eighths", "fifty two and a half", "two feet three and a half",
    "one hundred and twenty three", "34 7/8", "thirty four point eight seven five", "forty one and three sixteenths",
    "one oh two", "twenty and one half"];
  const junk = ["fourty", "thirdy", "sixy", "tu", "too", "for", "ate", "won", "tree", "eleventy", "thousand", "million", "half-ish",
    "ninty", "eighteenth", "third", "thirds", "fifth", "fifths", "seventh", "dozen", "couple"];
  valid.forEach((v) => {
    assert.ok(V.parse(v).ok, v);
    const toks = v.split(" ");
    for (let pos = 1; pos <= toks.length; pos++) {
      junk.forEach((j) => {
        const mod = toks.slice(0, pos).concat([j], toks.slice(pos)).join(" ");
        if (pos === 0) return;
        assert.strictEqual(V.parse(mod).ok, false, mod);
      });
    }
    junk.forEach((j) => assert.strictEqual(V.parse(j + " " + v).ok, false, j + " " + v));
  });
});

test("property: appending or prepending any extra number word to a valid parse never succeeds", () => {
  const extra = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "fifteen", "fifty", "hundred",
    "half", "quarter", "eighths", "sixteenth", "zero", "oh", "point", "and", "a"];
  const valid = ["thirty four", "thirty four and a half", "34 7/8", "fifty two", "two feet three"];
  valid.forEach((v) => extra.forEach((x) => {
    const tail = V.parse(v + " " + x);
    const base = V.parse(v).inches;
    // The only way a tail word may succeed is by being part of a recognised grammar
    // production (e.g. "thirty four seven eighths"), never by being ignored.
    if (tail.ok) assert.notStrictEqual(tail.inches, base, v + " " + x);
    const head = V.parse(x + " " + v);
    if (head.ok) assert.notStrictEqual(head.inches, base, x + " " + v);
  }));
});

test("property: fuzz — ok results are finite, in range, and never throw", () => {
  const vocab = ["one", "two", "three", "seven", "ten", "twenty", "thirty", "fifty", "hundred", "and", "a", "half", "quarters",
    "eighths", "second", "seconds", "point", "oh", "zero", "feet", "inches", "7/8", "3", "34", "'", '"', "to", "for", "uh"];
  let seed = 12345;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  let oks = 0;
  for (let i = 0; i < 4000; i++) {
    const len = 1 + rnd(7), toks = [];
    for (let k = 0; k < len; k++) toks.push(vocab[rnd(vocab.length)]);
    const s = toks.join(" ");
    const r = V.parse(s);
    if (r.ok) {
      oks++;
      assert.ok(isFinite(r.inches) && r.inches >= 6 && r.inches <= 240, s);
      assert.strictEqual(r.floored, R.floorEighth(r.inches));
      assert.ok(r.floored <= r.inches);
      // every token consumed: the displayed words must not hide a dropped number word
      const numberWords = toks.filter((x) => /^(to|for)$/.test(x));
      assert.strictEqual(numberWords.length, 0, s);
    }
  }
  assert.ok(oks > 20);
});
