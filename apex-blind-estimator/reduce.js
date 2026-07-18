/*
 * reduce.js — the one safety-critical operation in this app.
 *
 * Locked spec (project log §2): laser reading (a raw float in METERS over BLE)
 *   → convert to inches
 *   → FLOOR to the nearest 1/8"  (never rounds up)
 *   → a value sitting exactly on an eighth passes through unchanged.
 * Canonical example: 34 29/32" (34.90625") -> 34 7/8".
 *
 * This file is used two ways from the SAME source, so what ships is what's
 * tested: the browser loads it via <script src>, and reduce.test.js requires
 * it under Node. Do not fork the logic.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Reduce = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var METERS_TO_INCHES = 39.3701;

  // Snap tolerance, measured on the eighth-scale (i.e. inches * 8).
  // A reading within EIGHTH_EPS/8 of an eighth counts as sitting ON that
  // eighth. Its only job is to absorb float32 representation error from the
  // BLE meters value so a measurement that is mathematically exactly N/8"
  // isn't dropped a notch by a sub-micron rounding artifact.
  //
  // 5e-4 eighths = 6.25e-5 inch of tolerance — roughly 1/1000 of the D2's
  // own ±1/16" accuracy, so it can never pull a genuine sub-eighth reading
  // up across a real boundary. It only fixes float noise.
  var EIGHTH_EPS = 5e-4;

  function metersToInches(m) { return m * METERS_TO_INCHES; }

  // Reduce a length in inches to a { whole, num/den } eighth, flooring.
  // Returns null for non-finite or negative input.
  function reduceInches(inches) {
    if (typeof inches !== 'number' || !isFinite(inches) || inches < 0) return null;
    var eighths = Math.floor(inches * 8 + EIGHTH_EPS);
    var whole = Math.floor(eighths / 8);
    var frac = eighths - whole * 8; // 0..7
    // reduce frac/8 to lowest terms
    var num = frac, den = 8;
    while (num !== 0 && num % 2 === 0 && den % 2 === 0) { num /= 2; den /= 2; }
    return {
      inches: inches,               // the raw input, untouched
      eighths: eighths,             // total eighths (whole*8 + frac)
      whole: whole,                 // whole inches
      num: frac === 0 ? 0 : num,    // reduced numerator, 0 when no fraction
      den: frac === 0 ? 1 : den,    // reduced denominator
      snapped: eighths / 8          // the reduced value, in inches
    };
  }

  function reduceMeters(m) { return reduceInches(metersToInches(m)); }

  // Render a reduced result as text: '34 7/8"', '34"', '7/8"', '0"'.
  function format(r) {
    if (!r) return '—'; // em dash placeholder
    var frac = r.num === 0 ? '' : (r.num + '/' + r.den);
    if (r.whole === 0 && frac === '') return '0"';
    if (r.whole === 0) return frac + '"';
    if (frac === '') return r.whole + '"';
    return r.whole + ' ' + frac + '"';
  }

  return {
    METERS_TO_INCHES: METERS_TO_INCHES,
    EIGHTH_EPS: EIGHTH_EPS,
    metersToInches: metersToInches,
    reduceInches: reduceInches,
    reduceMeters: reduceMeters,
    format: format
  };
});
