/*
 * sound.js — a soft click (and a light buzz where the device supports it) when a button is pressed by
 * hand. Synthesised with Web Audio: no audio files, no download, effectively free on a phone.
 * On by default; the toggle lives in Settings. Never plays for voice/laser events — only real taps.
 * ApexSound.enabled() / setEnabled(bool) / click(). Classic script, ES5; never throws into the app.
 */
(function (root) {
  "use strict";
  var KEY = "apex.sound";
  var ctx = null, last = 0;

  function load() { try { return root.localStorage.getItem(KEY) !== "off"; } catch (e) { return true; } }
  var on = load();

  function audio() {
    if (ctx) return ctx;
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); } catch (e) { ctx = null; }
    return ctx;
  }

  function click() {
    if (!on) return;
    var now = Date.now();
    if (now - last < 40) return;                        // one sound per tap, even through nested elements
    last = now;
    try { if (root.navigator && root.navigator.vibrate) root.navigator.vibrate(6); } catch (e) { /* iOS has none */ }
    var a = audio();
    if (!a) return;
    try {
      if (a.state === "suspended" && a.resume) a.resume();
      var t = a.currentTime, o = a.createOscillator(), g = a.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(1500, t);
      o.frequency.exponentialRampToValueAtTime(700, t + 0.035);   // short downward "tick"
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
      o.connect(g); g.connect(a.destination);
      o.start(t); o.stop(t + 0.06);
    } catch (e) { /* ignore */ }
  }

  function setEnabled(v) {
    on = !!v;
    try { root.localStorage.setItem(KEY, on ? "on" : "off"); } catch (e) { /* private mode */ }
    if (on) click();
  }

  var TAPPABLE = "button, [role=button], a.btn, select, summary, .list-row, .slot, label.voice-hf";
  function onDown(e) {
    var t = e.target && e.target.closest ? e.target.closest(TAPPABLE) : null;
    if (!t || t.disabled || t.getAttribute("aria-disabled") === "true") return;
    if (e.isTrusted === false) return;                   // synthetic clicks (tests, programmatic) stay silent
    click();
  }
  if (root.document) root.document.addEventListener("pointerdown", onDown, true);

  root.ApexSound = { enabled: function () { return on; }, setEnabled: setEnabled, click: click };

  var X = root.ApexExt;
  if (X && X.settingsBlocks) X.settingsBlocks.push(function (ctx2) {
    var h = ctx2.h;
    var seg = h("div", { class: "segmented", role: "group", "aria-label": "Button sounds" });
    [[true, "On"], [false, "Off"]].forEach(function (o) {
      seg.appendChild(h("button", { type: "button", "aria-pressed": String(on === o[0]), text: o[1], onclick: function () {
        setEnabled(o[0]);
        Array.prototype.forEach.call(seg.children, function (b) { b.setAttribute("aria-pressed", "false"); });
        this.setAttribute("aria-pressed", "true");
      } }));
    });
    return h("div", { class: "section form-grid" },
      h("div", { class: "section-head" }, h("span", { class: "label", text: "Button sounds" })),
      h("p", { class: "small muted", text: "A soft click when you tap a button. Voice and laser readings stay silent." }),
      seg);
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
