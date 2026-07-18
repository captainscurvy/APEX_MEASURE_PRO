/*
 * Tests for the reduce engine. Run: node reduce.test.js
 * Proves the locked §2 behavior AND that it survives the real BLE numeric
 * path (meters carried as a 4-byte float32), which is where float error hides.
 */
var R = require('./reduce.js');

var pass = 0, fail = 0;
function eq(actual, expected, label) {
  if (actual === expected) { pass++; }
  else { fail++; console.log('FAIL: ' + label + '\n  expected: ' + JSON.stringify(expected) + '\n  got:      ' + JSON.stringify(actual)); }
}

// Mimic the wire: inches -> meters -> float32 (what the D2 sends) -> reduce.
function viaBLE(inches) {
  var meters = inches / R.METERS_TO_INCHES;
  var f = new Float32Array([meters])[0]; // truncate to 4-byte float, like the D2
  return R.format(R.reduceMeters(f));
}

// --- Locked spec cases (direct inches) ---------------------------------
eq(R.format(R.reduceInches(34.90625)), '34 7/8"', 'canonical 34 29/32 -> 34 7/8');
eq(R.format(R.reduceInches(34.5)),     '34 1/2"', 'exact 34 1/2 passes through');
eq(R.format(R.reduceInches(70.6457)),  '70 5/8"', 'field shot 70.6457 -> 70 5/8');
eq(R.format(R.reduceInches(34)),       '34"',     'whole inch, no fraction');
eq(R.format(R.reduceInches(0)),        '0"',      'zero');
eq(R.format(R.reduceInches(0.125)),    '1/8"',    'bare 1/8, no whole part');
eq(R.format(R.reduceInches(0.75)),     '3/4"',    'bare 3/4 reduces from 6/8');
eq(R.format(R.reduceInches(0.999)),    '7/8"',    'just under 1" floors to 7/8');

// --- The "never rounds up" rule (between eighths drops DOWN) ------------
eq(R.format(R.reduceInches(34.4999)),  '34 3/8"', 'a hair under 1/2 stays 3/8 (no round-up)');
eq(R.format(R.reduceInches(34.99)),    '34 7/8"', 'a hair under 35 stays 34 7/8');
eq(R.format(R.reduceInches(34.24)),    '34 1/8"', '0.24" floors to 1/8, not 1/4');

// --- Fraction reduction is correct at every eighth ---------------------
var expectFrac = ['0"','1/8"','1/4"','3/8"','1/2"','5/8"','3/4"','7/8"'];
for (var i = 0; i < 8; i++) {
  eq(R.format(R.reduceInches(i / 8)), expectFrac[i], 'eighth ' + i + '/8 formats correctly');
}

// --- Survives the float32 BLE round-trip for EVERY exact eighth 0..96" --
// This is the real test: if the epsilon is too tight, an exact eighth that
// the D2 sends as meters will drop a notch after the float32 truncation.
var roundTripFails = 0;
for (var e = 0; e <= 768; e++) {          // 0" .. 96" in 1/8" steps
  var inches = e / 8;
  var direct = R.format(R.reduceInches(inches));
  var wire = viaBLE(inches);
  if (direct !== wire) {
    roundTripFails++;
    if (roundTripFails <= 5) console.log('  round-trip drift at ' + inches + '": direct=' + direct + ' wire=' + wire);
  }
}
eq(roundTripFails, 0, 'all 769 exact eighths survive the meters->float32->inches path');

// --- Bad input is handled, not crashed ---------------------------------
eq(R.reduceInches(-1),       null, 'negative -> null');
eq(R.reduceInches(NaN),      null, 'NaN -> null');
eq(R.reduceInches(Infinity), null, 'Infinity -> null');
eq(R.format(null),           '—',  'format(null) -> placeholder');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
