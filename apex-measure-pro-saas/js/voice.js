/*
 * voice.js — spoken-measurement parser and command grammar. PURE, UMD, ES5.
 *
 * SAFETY-CRITICAL: a misheard number becomes a wrong blind order. So:
 *   - the grammar is FIXED; every token must be consumed by it (no partial
 *     parses, no trailing garbage, no skipped words);
 *   - unknown words (including homophones: to/too/for/ate/won/tree...) are
 *     rejected, never "corrected";
 *   - omitted "and" between a whole number and a fraction is accepted only
 *     when the grouping is unambiguous ("34 7/8", "thirty four seven eighths");
 *     "twenty one half" / "thirty seven eighths" are REJECTED;
 *   - parseAlternatives() accepts only when every plausible recognizer
 *     alternative agrees.
 *
 * parse() returns RAW inches. The 1/8" floor is ApexReduce's (floorEighth);
 * `floored` / `display` only describe what the app will record.
 */
(function (root, factory) {
  var R = null;
  try { if (typeof module === "object" && module.exports) R = require("./reduce.js"); } catch (e) { R = null; }
  var api = factory(function () { return R || root.ApexReduce || null; });
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ApexVoice = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (getReduce) {
  "use strict";

  var ONE9 = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
  var TEEN = { ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
    sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
  var TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
  var INCH_WORDS = { inch: 1, inches: 1, "in": 1, '"': 1 };
  var FEET_WORDS = { feet: 1, foot: 1, ft: 1, "'": 1 };
  var CM_WORDS = { cm: 1, centimeter: 1, centimeters: 1, centimetre: 1, centimetres: 1 };
  var DEN_OK = { 2: 1, 4: 1, 8: 1, 16: 1, 32: 1 };
  var DEN_WORD = { half: 2, halves: 2, quarter: 4, quarters: 4, fourth: 4, fourths: 4,
    eighth: 8, eighths: 8, sixteenth: 16, sixteenths: 16 };
  var HEAD_FILLER = { uh: 1, um: 1, uhm: 1, er: 1, erm: 1, ah: 1, hmm: 1, okay: 1, ok: 1, so: 1, well: 1,
    the: 1, width: 1, height: 1, depth: 1, is: 1, its: 1, it: 1, that: 1, measurement: 1,
    measures: 1, reads: 1, make: 1, now: 1 };
  var TAIL_FILLER = { please: 1, thanks: 1, thankyou: 1, okay: 1, ok: 1 };
  var CMD_FILLER = { uh: 1, um: 1, uhm: 1, er: 1, erm: 1, ah: 1, hmm: 1, okay: 1, ok: 1, so: 1, now: 1, please: 1 };

  var INT_RE = /^(0|[1-9]\d{0,3})$/;
  var DEC_RE = /^(\d{1,4})?\.\d{1,6}$/;
  var FRAC_RE = /^(\d{1,2})\/(\d{1,2})$/;

  var COMMANDS = {
    "next": "next", "next field": "next",
    "back": "back", "previous": "back", "go back": "back", "previous field": "back",
    "undo": "undo", "undo that": "undo",
    "clear": "clear", "clear that": "clear",
    "lock": "confirm", "lock it": "confirm", "confirm": "confirm", "confirm it": "confirm", "yes": "confirm",
    "yep": "confirm", "yeah": "confirm", "correct": "confirm", "thats right": "confirm", "that is right": "confirm",
    "cancel": "cancel", "no": "cancel", "wrong": "cancel", "thats wrong": "cancel", "retry": "cancel",
    "try again": "cancel", "nope": "cancel",
    "inside mount": "inside", "outside mount": "outside",
    "left": "left", "right": "right",
    "depth": "depth",
    "stop": "stop", "stop listening": "stop"
  };

  var VULGAR = { "½": " 1/2 ", "¼": " 1/4 ", "¾": " 3/4 ", "⅛": " 1/8 ", "⅜": " 3/8 ",
    "⅝": " 5/8 ", "⅞": " 7/8 " };

  var RANGES = { width: [6, 240], height: [6, 240], depth: [0.25, 48] };

  // ---------------------------------------------------------------- tokens
  // → { tokens } | { error }
  function tokenize(text, unit) {
    var s = String(text === null || text === undefined ? "" : text).toLowerCase();
    s = s.replace(/[‘’ʼ]/g, "'").replace(/[“”″]/g, '"').replace(/′/g, "'");
    s = s.replace(/[¼½¾⅛-⅞]/g, function (c) { return VULGAR[c]; });
    if (/(^|\s)[-−–]\s*\d/.test(s)) return { error: "unparsed" };      // never drop a minus sign
    s = s.replace(/([a-z])'(?=[a-z])/g, "$1");                                    // it's → its
    s = s.replace(/(\d)\s*'/g, "$1 ' ");
    s = s.replace(/"/g, ' " ');
    if (unit === "cm") s = s.replace(/(\d),(\d)/g, "$1.$2");
    s = s.replace(/[,;:?!\-–—]/g, " ");
    s = s.replace(/\.(?=\s|$)/g, " ");
    s = s.replace(/\s+/g, " ").trim();
    if (/[^a-z0-9\/.'" ]/.test(s)) return { error: "unparsed" };                  // unknown symbol: never drop silently
    return { tokens: s ? s.split(" ") : [] };
  }

  function strip(tokens, headSet, tailSet) {
    var a = 0, b = tokens.length;
    while (a < b && headSet[tokens[a]] === 1) a++;
    while (b > a && tailSet[tokens[b - 1]] === 1) b--;
    return tokens.slice(a, b);
  }

  // ---------------------------------------------------------------- number grammar
  function makeReader(t) {
    function denAt(i) {
      var x = t[i];
      if (x === undefined) return null;
      if (DEN_WORD[x] !== undefined) return { den: DEN_WORD[x], i: i + 1, word: x };
      if (x === "thirty" && (t[i + 1] === "second" || t[i + 1] === "seconds")) return { den: 32, i: i + 2, word: "thirty second" };
      return null;
    }
    function under100(i) {
      var w = t[i];
      if (w === undefined) return null;
      if (TEEN[w] !== undefined) return { v: TEEN[w], i: i + 1 };
      if (TENS[w] !== undefined) {
        if (ONE9[t[i + 1]] !== undefined) return { v: TENS[w] + ONE9[t[i + 1]], i: i + 2 };
        return { v: TENS[w], i: i + 1 };
      }
      if (ONE9[w] !== undefined) return { v: ONE9[w], i: i + 1 };
      return null;
    }
    function cardinal(i) {
      var w = t[i];
      if (w === undefined) return null;
      if (INT_RE.test(w)) return { v: Number(w), i: i + 1 };
      if (ONE9[w] !== undefined && t[i + 1] === "hundred") {
        var base = ONE9[w] * 100, j = i + 2, r;
        if (t[j] === "and") {
          r = under100(j + 1);
          if (r && !denAt(r.i) && !(FRAC_RE.test(t[r.i] || "") )) return { v: base + r.v, i: r.i };
          return { v: base, i: j };
        }
        r = under100(j);
        if (r) return { v: base + r.v, i: r.i };
        return { v: base, i: j };
      }
      if (ONE9[w] !== undefined && (t[i + 1] === "oh" || t[i + 1] === "zero") && ONE9[t[i + 2]] !== undefined) {
        return { v: ONE9[w] * 100 + ONE9[t[i + 2]], i: i + 3 };                  // "one oh two" → 102
      }
      if (w === "zero") return { v: 0, i: i + 1 };
      return under100(i);
    }
    function digits(i) {                                                           // after "point"
      if (t[i] !== undefined && /^\d{1,6}$/.test(t[i])) return { s: t[i], i: i + 1 };
      var s = "", j = i;
      for (;;) {
        var w = t[j];
        if (ONE9[w] !== undefined) s += ONE9[w];
        else if (w === "zero" || w === "oh") s += "0";
        else break;
        j++;
      }
      return s && s.length <= 6 ? { s: s, i: j } : null;
    }
    // numerator + denominator (or "a half"). → {num,den,i} | {bad:true} | null
    function fraction(i, allowArticle) {
      var x = t[i], m;
      if (x === undefined) return null;
      if ((m = FRAC_RE.exec(x))) {
        var n = Number(m[1]), d = Number(m[2]);
        if (DEN_OK[d] && n >= 1 && n < d) return { num: n, den: d, i: i + 1 };
        return { bad: true };
      }
      var dd;
      if (x === "a" || x === "an") {
        if (!allowArticle) return null;
        dd = denAt(i + 1);
        return dd ? { num: 1, den: dd.den, i: dd.i } : null;
      }
      var c = under100(i);
      if (!c && /^\d{1,2}$/.test(x)) c = { v: Number(x), i: i + 1 };
      if (c) {
        dd = denAt(c.i);
        if (dd) return (c.v >= 1 && c.v < dd.den) ? { num: c.v, den: dd.den, i: dd.i } : { bad: true };
      }
      return null;
    }
    return { denAt: denAt, cardinal: cardinal, digits: digits, fraction: fraction };
  }

  // Inch part starting at i. → { inches, i } | { error } | null
  function inchPart(t, rd, i, fracOnlyOk) {
    var x = t[i], whole = null, dec = null, j = i, frac = null, f;
    if (x === undefined) return null;
    if (fracOnlyOk) {                                                              // "seven eighths", "a half"
      f = rd.fraction(i, true);
      if (f && f.bad) return { error: "unparsed" };
      if (f) {
        j = f.i;
        if (INCH_WORDS[t[j]] === 1) j++;
        return { inches: f.num / f.den, i: j, whole: null, frac: f };
      }
    }
    if (DEC_RE.test(x)) { dec = Number(x); j = i + 1; }
    else if (x === "point") { whole = 0; }
    else {
      var c = rd.cardinal(i);
      if (c) { whole = c.v; j = c.i; }
    }
    if (whole !== null && t[j] === "point") {
      var dg = rd.digits(j + 1);
      if (!dg) return { error: "unparsed" };
      dec = Number(whole + "." + dg.s);
      j = dg.i; whole = null;
    }
    var unitUsed = false;
    if ((whole !== null || dec !== null) && INCH_WORDS[t[j]] === 1) { unitUsed = true; j++; }
    if (dec === null) {
      if (whole !== null) {
        if (t[j] === "and") {
          f = rd.fraction(j + 1, true);
          if (!f || f.bad) return { error: "unparsed" };
          frac = f; j = f.i;
        } else if (t[j] !== undefined && t[j] !== "a" && t[j] !== "an") {
          f = rd.fraction(j, false);
          if (f && f.bad) return { error: "unparsed" };
          if (f) { frac = f; j = f.i; }
        }
      } else if (fracOnlyOk) {
        f = rd.fraction(j, true);
        if (f && f.bad) return { error: "unparsed" };
        if (f) { frac = f; j = f.i; }
        else {                                                                    // bare "half" / "quarter"
          var d = rd.denAt(j);
          if (d && d.den !== 32 && (d.word === "half" || d.word === "quarter" || d.word === "eighth" || d.word === "sixteenth")) {
            frac = { num: 1, den: d.den, i: d.i }; j = d.i;
          }
        }
      }
    }
    if (whole === null && dec === null && !frac) return null;
    if (!unitUsed && INCH_WORDS[t[j]] === 1) { j++; }
    var inches = dec !== null ? dec : (whole || 0) + (frac ? frac.num / frac.den : 0);
    return { inches: inches, i: j, whole: whole, frac: frac };
  }

  // tokens → { inches } | { error }
  function parseTokens(t, unit) {
    var n = t.length;
    if (!n) return { error: "empty" };
    var rd = makeReader(t), r;
    if (unit === "cm") {
      var v = null, j = 0;
      if (DEC_RE.test(t[0])) { v = Number(t[0]); j = 1; }
      else {
        var c = rd.cardinal(0);
        if (!c) return { error: "unparsed" };
        v = c.v; j = c.i;
        if (t[j] === "point") {
          var dg = rd.digits(j + 1);
          if (!dg) return { error: "unparsed" };
          v = Number(c.v + "." + dg.s); j = dg.i;
        }
      }
      if (CM_WORDS[t[j]] === 1) j++;
      if (j !== n) return { error: "unparsed" };
      return { inches: v / 2.54 };
    }
    // feet + inches
    var fc = rd.cardinal(0);
    if (fc && FEET_WORDS[t[fc.i]] === 1) {
      var feet = fc.v, k = fc.i + 1;
      if (k === n) return { inches: feet * 12 };
      if (t[k] === "and") k++;
      r = inchPart(t, rd, k, true);
      if (!r) return { error: "unparsed" };
      if (r.error) return r;
      if (r.i !== n) return { error: "unparsed" };
      if (!(r.inches < 12)) return { error: "invalid" };
      return { inches: feet * 12 + r.inches };
    }
    r = inchPart(t, rd, 0, true);
    if (!r) return { error: "unparsed" };
    if (r.error) return r;
    if (r.i !== n) return { error: "unparsed" };
    return { inches: r.inches };
  }

  // ---------------------------------------------------------------- speech
  function gcd(a, b) { return b ? gcd(b, a % b) : a; }
  var DEN_SPOKEN = { 2: "half", 4: "quarter", 8: "eighth", 16: "sixteenth", 32: "thirty-second" };

  function fracWords(num, den) {                  // reduced
    var g = gcd(num, den); num /= g; den /= g;
    var w = DEN_SPOKEN[den];
    if (num === 1) return (den === 8 || den === 16 ? "an " : "a ") + w;
    return num + " " + (den === 2 ? "halves" : w + "s");
  }
  // Spoken form of a value that sits exactly on a 1/32 (TTS-safe: no "7/8").
  function speakExact(inches, unitName) {
    var e = Math.round(inches * 32), whole = Math.floor(e / 32), rem = e - whole * 32;
    if (!rem) return whole + (whole === 1 ? " inch" : " inches");
    if (whole === 0) return fracWords(rem, 32) + " of an inch";
    return whole + " and " + fracWords(rem, 32) + " inches";
  }
  function speakRaw(inches) {
    if (Math.abs(inches * 32 - Math.round(inches * 32)) < 1e-9) return speakExact(inches);
    var s = String(Math.round(inches * 10000) / 10000);
    return s.replace(".", " point ").replace(/point (\d+)/, function (m, d) { return "point " + d.split("").join(" "); }) + " inches";
  }
  function describe(inches, unit) {
    var R = getReduce();
    if (!R) return null;
    var floored = R.floorEighth(inches);
    var exact = floored === inches;
    var rec = unit === "cm" ? R.speakInches(floored, "cm") : speakExact(floored);
    var heard = unit === "cm" ? null : speakRaw(inches);
    var display = (exact || unit === "cm") ? rec : heard + ", recorded as " + rec;
    return { floored: floored, exact: exact, display: display, spoken: rec, text: R.formatLength(floored, unit === "cm" ? "cm" : "in") };
  }

  // ---------------------------------------------------------------- public: parse
  function rangeFor(opts) {
    var k = (opts && opts.kind) || "width";
    var r = RANGES[k] || RANGES.width;
    return [opts && typeof opts.min === "number" ? opts.min : r[0], opts && typeof opts.max === "number" ? opts.max : r[1]];
  }

  function parse(text, opts) {
    opts = opts || {};
    var unit = opts.unit === "cm" ? "cm" : "in";
    try {
      var tk = tokenize(text, unit);
      if (tk.error) return { ok: false, reason: tk.error };
      var t = strip(tk.tokens, HEAD_FILLER, TAIL_FILLER);
      if (!t.length) return { ok: false, reason: "empty" };
      var r = parseTokens(t, unit);
      if (r.error) return { ok: false, reason: r.error };
      var inches = r.inches;
      if (typeof inches !== "number" || !isFinite(inches)) return { ok: false, reason: "unparsed" };
      var d = describe(inches, unit);
      if (!d) return { ok: false, reason: "unavailable" };
      var rg = rangeFor(opts);
      var base = { kind: "value", inches: inches, floored: d.floored, exact: d.exact, display: d.display, spoken: d.spoken, text: d.text };
      if (inches < rg[0] || inches > rg[1]) {
        base.ok = false; base.reason = "out-of-range"; base.range = rg;
        return base;
      }
      base.ok = true; base.reason = "";
      return base;
    } catch (e) {
      return { ok: false, reason: "unparsed" };
    }
  }

  function parseCommand(text) {
    try {
      var tk = tokenize(text, "in");
      if (tk.error) return { ok: false, reason: "unparsed" };
      var t = strip(tk.tokens, CMD_FILLER, CMD_FILLER);
      var key = t.join(" ");
      if (key && Object.prototype.hasOwnProperty.call(COMMANDS, key)) return { ok: true, kind: "command", command: COMMANDS[key], reason: "" };
    } catch (e) { /* fall through */ }
    return { ok: false, reason: "not-a-command" };
  }

  function interpret(text, opts) {
    var c = parseCommand(text);
    if (c.ok && !(opts && opts.commands === false)) return c;
    return parse(text, opts);
  }

  function candidateOf(r, transcript) {
    if (r.kind === "command") return { key: "cmd:" + r.command, kind: "command", command: r.command, transcript: transcript };
    return { key: "val:" + (Math.round(r.inches * 1e6) / 1e6), kind: "value", inches: r.inches, display: r.display, transcript: transcript };
  }

  // All plausible alternatives must agree. The TOP alternative must itself be usable:
  // a lower alternative is never promoted over an unparsable top one (that would be guessing).
  function parseAlternatives(list, opts) {
    var alts = [];
    (list || []).forEach(function (a) {
      var s = typeof a === "string" ? a : (a && typeof a.transcript === "string" ? a.transcript : "");
      if (s.trim()) alts.push(s);
    });
    if (!alts.length) return { ok: false, reason: "empty", candidates: [] };
    var results = alts.map(function (a) { return interpret(a, opts); });
    var top = results[0];
    var usable = function (r) { return r.ok || r.kind === "value"; };
    if (!usable(top)) return { ok: false, reason: top.reason || "unparsed", candidates: [] };
    var cands = [], seen = {};
    results.forEach(function (r, i) {
      if (!usable(r)) return;                       // unparsable lower alternative: not a plausible candidate
      var c = candidateOf(r, alts[i]);
      if (!seen[c.key]) { seen[c.key] = true; cands.push(c); }
    });
    if (cands.length > 1) {
      return { ok: false, reason: "ambiguous", candidates: cands.map(function (c) { delete c.key; return c; }) };
    }
    top.agreed = results.filter(usable).length;
    top.alternatives = alts.length;
    return top;
  }

  return {
    parse: parse,
    parseAlternatives: parseAlternatives,
    parseCommand: parseCommand,
    interpret: interpret,
    describe: describe,
    speakExact: speakExact,
    RANGES: RANGES,
    COMMANDS: COMMANDS
  };
});
