/*
 * capture.js — arm / lock / advance state machine (§7). PURE and DOM-free.
 *
 * Events in, { state, effects } out. main.js renders the state and applies
 * the effects to the data model. Every §7.2 edge case is covered in
 * capture.test.js and runs in Node in milliseconds.
 *
 * Fields:
 *   shot fields  "width.0".."width.4", "height.N", "depth.N"   (3s auto-lock)
 *   choice       "mountType", "controlSide", "controlType"     (commit on choose)
 *   text         "obstructions", "notes"                       (never a timer)
 *
 * Time is passed in (event.now, from performance.now()); the lock fires on
 * the first tick at or past the recorded deadline, so a throttled setTimeout
 * can never lock the wrong value.
 *
 * Effects:
 *   { type: "armed",   field }
 *   { type: "reading", field, value, source }      pending value replaced
 *   { type: "commit",  field, value, source }      write it to the window
 *   { type: "advance", from, to }                  to === null → next window
 *   { type: "disarmed" }
 *   { type: "ignored", reason }                    "not-armed" | "not-shot-field" | "cap"
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ApexCapture = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var LOCK_MS = 3000;
  var MAX_SHOTS = 5;
  var SHOT_SLOTS = 3;                  // slots in the auto-advance path
  var DIMENSIONS = ["width", "height", "depth"];
  var CHOICE_FIELDS = ["mountType", "controlSide", "controlType"];
  var TEXT_FIELDS = ["obstructions", "notes"];

  // §7.1 — the auto-advance path. Depth is opt-in and not in it.
  var SEQUENCE = [
    "width.0", "width.1", "width.2",
    "height.0", "height.1", "height.2",
    "mountType", "controlSide", "controlType",
    "obstructions", "notes"
  ];

  function parseShot(field) {
    var m = /^(width|height|depth)\.(\d+)$/.exec(field || "");
    return m ? { dim: m[1], slot: Number(m[2]) } : null;
  }
  function isShotField(f) { return parseShot(f) !== null; }
  function isChoiceField(f) { return CHOICE_FIELDS.indexOf(f) !== -1; }
  function isTextField(f) { return TEXT_FIELDS.indexOf(f) !== -1; }

  // Next field after `field`, skipping any that are already filled.
  // Extra shot slots (4th/5th) continue to the next dimension. Depth ends
  // after its three slots (null = nothing further in this path).
  function nextField(field, isFilled) {
    isFilled = isFilled || function () { return false; };
    var shot = parseShot(field);
    var start;
    if (shot && shot.dim === "depth") {
      for (var d = shot.slot + 1; d < SHOT_SLOTS; d++) {
        if (!isFilled("depth." + d)) return "depth." + d;
      }
      return null;
    }
    if (shot && shot.slot >= SHOT_SLOTS) start = SEQUENCE.indexOf(shot.dim + "." + (SHOT_SLOTS - 1)) + 1;
    else start = SEQUENCE.indexOf(field) + 1;
    if (start <= 0) return null;
    for (var i = start; i < SEQUENCE.length; i++) {
      if (!isFilled(SEQUENCE[i])) return SEQUENCE[i];
    }
    return null;
  }

  function initialState() {
    return { armed: null, pending: null, deadline: null, typing: false };
  }

  function copy(s) {
    return { armed: s.armed, pending: s.pending, deadline: s.deadline, typing: s.typing };
  }

  // Commit whatever is pending on the armed shot field. Mutates s.
  function flush(s, effects) {
    if (s.pending && isShotField(s.armed)) {
      effects.push({ type: "commit", field: s.armed, value: s.pending.value, source: s.pending.source });
      s.pending = null;
      s.deadline = null;
      s.typing = false;
      return true;
    }
    s.pending = null;
    s.deadline = null;
    s.typing = false;
    return false;
  }

  function advance(s, effects, from, isFilled) {
    var to = nextField(from, isFilled);
    s.armed = to;
    effects.push({ type: "advance", from: from, to: to });
    if (to) effects.push({ type: "armed", field: to });
  }

  // ctx.isFilled(field) → boolean, supplied by the caller so advancing skips
  // fields that already hold a value (a re-shoot never lands on a full slot).
  function step(state, event, ctx) {
    var s = copy(state || initialState());
    var effects = [];
    var isFilled = ctx && ctx.isFilled;
    var from;

    switch (event.type) {
      case "arm":            // tapping a field — also "tap a different field"
      case "tapOther": {
        var shot = parseShot(event.field);
        if (shot && shot.slot >= MAX_SHOTS) { effects.push({ type: "ignored", reason: "cap" }); break; }
        if (s.armed === event.field) break;       // re-tap of the armed field keeps its pending value
        flush(s, effects);                         // a real reading is never discarded
        s.armed = event.field;
        effects.push({ type: "armed", field: event.field });
        break;
      }

      case "reading": {      // a laser shot arrived
        if (!s.armed) { effects.push({ type: "ignored", reason: "not-armed" }); break; }
        if (!isShotField(s.armed)) { effects.push({ type: "ignored", reason: "not-shot-field" }); break; }
        // A second shot means the first was wrong: replace and restart the
        // timer. Identical values are NOT deduped — they are confirmation.
        s.pending = { value: event.value, source: event.source || "laser" };
        s.deadline = event.now + LOCK_MS;
        s.typing = false;
        effects.push({ type: "reading", field: s.armed, value: event.value, source: s.pending.source });
        break;
      }

      case "keystroke": {    // user typing a manual value into the armed shot field
        if (!isShotField(s.armed)) break;
        s.typing = true;
        s.deadline = null;                       // typing cancels the timer entirely
        s.pending = (typeof event.value === "number") ? { value: event.value, source: "manual" } : null;
        break;
      }

      case "commit": {       // Enter, blur, or the Lock button
        from = s.armed;
        if (flush(s, effects)) advance(s, effects, from, isFilled);
        break;
      }

      case "tick": {
        if (s.deadline !== null && event.now >= s.deadline) {
          from = s.armed;
          flush(s, effects);
          advance(s, effects, from, isFilled);
        }
        break;
      }

      case "visibilityHidden": // commit now, never leave a timer to fire in the background
      case "disconnect": {     // disconnection never discards a received reading
        from = s.armed;
        if (flush(s, effects)) advance(s, effects, from, isFilled);
        break;
      }

      case "set": {          // choice picked, or Enter / Next in a text field
        var field = event.field || s.armed;
        if (s.armed && s.armed !== field) flush(s, effects);
        effects.push({ type: "commit", field: field, value: event.value, source: "manual" });
        s.pending = null; s.deadline = null; s.typing = false;
        advance(s, effects, field, isFilled);
        break;
      }

      case "disarm": {
        flush(s, effects);
        s.armed = null;
        effects.push({ type: "disarmed" });
        break;
      }
    }
    return { state: s, effects: effects };
  }

  // Fraction of the lock window remaining, 0..1 (for the countdown bar).
  function remaining(state, now) {
    if (!state || state.deadline === null) return 0;
    return Math.max(0, Math.min(1, (state.deadline - now) / LOCK_MS));
  }

  // "Width shot 1", "Mount type", …
  function fieldLabel(field) {
    var shot = parseShot(field);
    if (shot) return shot.dim.charAt(0).toUpperCase() + shot.dim.slice(1) + " shot " + (shot.slot + 1);
    return {
      mountType: "Mount type", controlSide: "Control side", controlType: "Control type",
      obstructions: "Obstructions", notes: "Notes"
    }[field] || String(field);
  }

  return {
    LOCK_MS: LOCK_MS,
    MAX_SHOTS: MAX_SHOTS,
    SHOT_SLOTS: SHOT_SLOTS,
    SEQUENCE: SEQUENCE,
    DIMENSIONS: DIMENSIONS,
    parseShot: parseShot,
    isShotField: isShotField,
    isChoiceField: isChoiceField,
    isTextField: isTextField,
    nextField: nextField,
    initialState: initialState,
    step: step,
    remaining: remaining,
    fieldLabel: fieldLabel
  };
});
