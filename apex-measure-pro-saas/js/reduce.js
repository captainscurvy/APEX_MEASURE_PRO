/*
 * reduce.js — the 1/8-inch rule and every display format.
 *
 * PURE: no imports, no DOM, no globals read. Loaded two ways from the same
 * source so what ships is what's tested:
 *   - browser: classic <script src="js/reduce.js"> → globalThis.ApexReduce
 *   - Node:    require("./reduce.js")
 * (Classic script rather than an ES module because Chrome refuses module
 * imports from file://, and running from disk is a supported path.)
 *
 * Philosophy: never produce a number larger than what was actually measured.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ApexReduce = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var M_TO_IN = 39.37007874015748;          // exact: 1 / 0.0254
  var MAX_SHOTS = 5;                         // per dimension (§4.1)
  var VARIANCE_ADVISORY_IN = 0.25;           // spread that raises "check" advisory

  // floorEighth is monotonic non-decreasing, so it commutes with min():
  //   floorEighth(min(xs)) === min(xs.map(floorEighth))
  // Both forms are correct. Do NOT "optimize" into a form that rounds before
  // comparing with a different rounding mode — that breaks the invariant that
  // the result is never larger than the smallest actual reading.
  function floorEighth(inches) { return Math.floor(inches * 8) / 8; }

  function orderedValue(shotsInInches) {
    if (!shotsInInches || shotsInInches.length === 0) return null;
    return floorEighth(Math.min.apply(null, shotsInInches));
  }

  function isValidLength(x) { return typeof x === "number" && isFinite(x) && x >= 0; }

  function metersToInches(m) { return m * M_TO_IN; }

  // Little-endian float32 → JS number (meters), exactly as the DISTO sends it.
  function decodeFloat32LE(buf) {
    var view = buf instanceof DataView ? buf
      : ArrayBuffer.isView(buf) ? new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
      : new DataView(buf);
    return view.getFloat32(0, true);
  }

  // The canonical decimal of a float32: the shortest decimal that encodes to
  // the same 4 bytes. This does not change the reading — it is the same
  // float32 — it removes the widening artefact. Without it, the D2 sending
  // 914.4 mm (exactly 36") arrives as 0.91439998… m = 35.9999993" and floors
  // to 35 7/8" while the laser's own display says 36". Tested for every exact
  // eighth from 0" to 400" in reduce.test.js.
  function canonicalFloat32(x) {
    if (typeof x !== "number" || !isFinite(x)) return x;
    var f = Math.fround(x);
    for (var p = 1; p <= 9; p++) {
      var d = Number(f.toPrecision(p));
      if (Math.fround(d) === f) return d;
    }
    return f;
  }

  // Laser ingest: float32 meters → inches (canonical storage unit, §5.1).
  function laserToInches(meters) { return metersToInches(canonicalFloat32(meters)); }

  // One kind of shot, whatever its source (§4.2). Null for invalid input.
  function makeShot(rawInches, source) {
    if (!isValidLength(rawInches)) return null;
    return { raw: rawInches, rounded: floorEighth(rawInches), source: source === "manual" ? "manual" : "laser" };
  }

  // --- formatting ---------------------------------------------------------

  function gcd(a, b) { return b ? gcd(b, a % b) : a; }

  // Total whole eighths at or below the value.
  function eighthsOf(inches) { return Math.floor(inches * 8); }

  function fractionText(eighths8) {           // 0..7 → "", "1/8", "1/4" …
    if (!eighths8) return "";
    var g = gcd(eighths8, 8);
    return (eighths8 / g) + "/" + (8 / g);
  }

  function inchPart(totalEighths) {           // → '35 1/2"', '1/8"', '0"'
    var whole = Math.floor(totalEighths / 8);
    var frac = fractionText(totalEighths - whole * 8);
    if (whole === 0) return (frac || "0") + '"';
    return whole + (frac ? " " + frac : "") + '"';
  }

  function formatInches(inches) {
    if (!isValidLength(inches)) return "—";
    return inchPart(eighthsOf(inches));
  }

  function formatFtIn(inches) {
    if (!isValidLength(inches)) return "—";
    var e = eighthsOf(inches);
    var feet = Math.floor(e / 96);
    if (feet === 0) return inchPart(e);
    var rem = e - feet * 96;
    if (rem === 0) return feet + "'";
    return feet + "' " + inchPart(rem);        // inchPart drops a zero whole: 2' 3/4"
  }

  function formatCm(inches) {
    if (!isValidLength(inches)) return "—";
    // micrometres, exact for any value on an eighth (1/8" = 3175 µm)
    var e8 = inches * 8;
    var um = Number.isInteger(e8) ? e8 * 3175 : inches * 25400;
    var mm = Math.floor(um / 1000);            // floor at the millimetre (§5.4)
    return (Math.floor(mm / 10)) + "." + (mm % 10) + " cm";
  }

  function formatLength(inches, unit) {
    if (unit === "ftin") return formatFtIn(inches);
    if (unit === "cm") return formatCm(inches);
    return formatInches(inches);
  }

  // "35 and 1 8th inches" — fractions as words so screen readers don't say "slash".
  var SPOKEN_DEN = { 2: ["half", "halves"], 4: ["4th", "4ths"], 8: ["8th", "8ths"] };
  function speakInches(inches, unit) {
    if (!isValidLength(inches)) return "no value";
    if (unit === "cm") return formatCm(inches).replace(" cm", " centimetres");
    var e = eighthsOf(inches);
    var whole = Math.floor(e / 8), rem = e - whole * 8;
    if (!rem) return whole + (whole === 1 ? " inch" : " inches");
    var g = gcd(rem, 8), num = rem / g, den = 8 / g;
    var frac = num + " " + SPOKEN_DEN[den][num === 1 ? 0 : 1];
    return whole === 0 ? frac + " of an inch" : whole + " and " + frac + " inches";
  }

  // --- reading helpers ----------------------------------------------------

  // Full description of one laser reading, used by the UI and by the tests.
  function describeMeters(meters) {
    if (typeof meters !== "number" || !isFinite(meters) || meters < 0) {
      return { raw: null, rounded: null, text: "—", invalid: true };
    }
    var raw = laserToInches(meters);
    return { raw: raw, rounded: floorEighth(raw), text: formatInches(raw), invalid: false };
  }

  // Spread across shots (rounded values), and whether to raise the advisory.
  function variance(shots) {
    if (!shots || shots.length < 2) return { spread: 0, advisory: false, text: "" };
    var r = shots.map(function (s) { return s.rounded; });
    var spread = Math.max.apply(null, r) - Math.min.apply(null, r);
    return {
      spread: spread,
      advisory: spread >= VARIANCE_ADVISORY_IN,
      text: spread >= VARIANCE_ADVISORY_IN ? "Shots differ by " + formatInches(spread) + " — check" : ""
    };
  }

  // Index of the winning (smallest) shot; first one on a tie.
  function winningIndex(shots) {
    var best = -1;
    for (var i = 0; i < (shots || []).length; i++) {
      if (best < 0 || shots[i].raw < shots[best].raw) best = i;
    }
    return best;
  }

  // Manual entry in the project's display unit → inches, or null if unreadable.
  //   in:   34 | 34.875 | 34 7/8 | 34-7/8 | 7/8 | 34 7/8"
  //   ftin: 2' 11 1/2" | 2'11.5 | 8' | 35 1/2 (bare number = inches)
  //   cm:   88.9 | 88,9
  function parseInchText(s) {
    s = s.replace(/["”″]|in(ches?)?$/gi, "").trim();
    if (!s) return null;
    var m;
    if ((m = /^(\d+(?:\.\d+)?)$/.exec(s))) return Number(m[1]);
    if ((m = /^(\d+)\/(\d+)$/.exec(s))) return Number(m[2]) ? Number(m[1]) / Number(m[2]) : null;
    if ((m = /^(\d+)[\s-]+(\d+)\/(\d+)$/.exec(s))) {
      return Number(m[3]) ? Number(m[1]) + Number(m[2]) / Number(m[3]) : null;
    }
    return null;
  }

  function parseManual(text, unit) {
    if (typeof text !== "string") return null;
    var s = text.trim();
    if (!s) return null;
    var v = null;
    if (unit === "cm") {
      var c = s.replace(/cm$/i, "").trim().replace(",", ".");
      if (/^\d+(\.\d+)?$/.test(c)) v = Number(c) / 2.54;
    } else if (unit === "ftin" && /['’′]/.test(s)) {
      var parts = s.split(/['’′]/);
      var ft = parts[0].trim();
      if (/^\d+$/.test(ft)) {
        var rest = parts.slice(1).join("").trim();
        var inch = rest ? parseInchText(rest) : 0;
        if (inch !== null) v = Number(ft) * 12 + inch;
      }
    } else {
      v = parseInchText(s);
    }
    return isValidLength(v) ? v : null;
  }

  return {
    M_TO_IN: M_TO_IN,
    MAX_SHOTS: MAX_SHOTS,
    VARIANCE_ADVISORY_IN: VARIANCE_ADVISORY_IN,
    floorEighth: floorEighth,
    orderedValue: orderedValue,
    isValidLength: isValidLength,
    metersToInches: metersToInches,
    decodeFloat32LE: decodeFloat32LE,
    canonicalFloat32: canonicalFloat32,
    laserToInches: laserToInches,
    makeShot: makeShot,
    formatInches: formatInches,
    formatFtIn: formatFtIn,
    formatCm: formatCm,
    formatLength: formatLength,
    speakInches: speakInches,
    describeMeters: describeMeters,
    variance: variance,
    winningIndex: winningIndex,
    parseManual: parseManual
  };
});
