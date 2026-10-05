/*
 * ui-voice.js — "Voice" control on the capture screen (ApexExt.captureTools).
 *
 * Safety: a spoken value is NEVER saved without a read-back card + explicit confirm
 * (tap, or the spoken commands yes / lock / confirm / correct). Confirm feeds the SAME
 * capture events typed entry uses ({type:"arm"}, {type:"keystroke"}, {type:"commit"}),
 * so lock/advance/undo/source("manual") behave exactly like typing. The 1/8" floor is
 * ApexReduce's, downstream of ctx.dispatch.
 *
 * Classic script, ES5. Nothing here may throw into ApexExt.
 */
(function (root) {
  "use strict";
  var X = root.ApexExt, V = root.ApexVoice;
  if (!X || !X.captureTools || !V) return;

  var SR = root.SpeechRecognition || root.webkitSpeechRecognition;
  var current = null;                // the live controller (one per capture screen)
  var handsFree = false;             // remembered across windows within a session
  var resumeAt = 0;                  // set after a hands-free confirm; the next screen picks it up

  var NOTE_CLOUD = "Uses your phone’s built-in speech recognition. Some browsers send audio to their speech service, so it may need a connection.";
  var NOTE_LOCAL = "Uses your phone’s built-in speech recognition, on the device.";
  var localOk = false;                // set when the engine confirms on-device English is ready (no download)
  try {
    if (SR && typeof SR.available === "function") {
      Promise.resolve(SR.available({ langs: ["en-US"], processLocally: true })).then(function (r) {
        localOk = (r === "available");
      }).catch(function () { /* stay on the default engine */ });
    }
  } catch (e) { /* ignore */ }

  function planAllows() {
    try { var P = root.ApexPlans; if (P && typeof P.has === "function") return P.has("voice") !== false; } catch (e) { /* allow */ }
    return true;
  }

  function destroyCurrent() { if (current) { try { current.destroy(); } catch (e) { /* ignore */ } current = null; } }
  ["hashchange", "pagehide"].forEach(function (ev) { root.addEventListener(ev, destroyCurrent); });
  if (root.document) root.document.addEventListener("visibilitychange", function () {
    if (root.document.hidden) { resumeAt = 0; destroyCurrent(); }
  });

  X.captureTools.push(function (ctx) {
    var h = ctx.h;
    if (!planAllows()) {
      return h("p", { class: "voice-help muted small", text: "Voice entry is not included in your plan." });
    }
    if (!SR) {
      return h("p", { class: "voice-help muted small", text: "Voice entry needs Chrome, Edge or Safari. This browser does not support speech recognition — type the value instead." });
    }
    destroyCurrent();
    current = makeController(ctx);
    return current.node;
  });

  // ---------------------------------------------------------------------------------
  function makeController(ctx) {
    var h = ctx.h, C = ctx.C;
    var dead = false, rec = null, state = "idle";      // idle | listening | speaking | readback
    var card = null;                                   // { r, field, winId, committed }
    var lastVoice = null;                              // { win, dim, slot, inches }
    var failures = 0, timers = [], mode = "value";     // mode: value | confirm (listening for yes/no)

    // --- DOM
    var mic = h("button", { class: "voice-mic", type: "button", "aria-pressed": "false",
      "aria-label": "Voice entry. Tap to start listening.", onclick: toggle },
      h("span", { class: "voice-mic-ring", "aria-hidden": "true" }),
      h("span", { class: "voice-mic-icon", "aria-hidden": "true", html: '<svg viewBox="0 0 24 24"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V22h2v-3.1A7 7 0 0 0 19 12h-2z"/></svg>' }),
      h("span", { class: "voice-mic-label", text: "Voice" }));
    var status = h("div", { class: "voice-status", role: "status", "aria-live": "polite", text: "Tap Voice and say a measurement." });
    var transcript = h("div", { class: "voice-transcript muted small", "aria-hidden": "true" });
    var cardVal = h("div", { class: "voice-card-value measurement" });
    var cardSay = h("div", { class: "voice-card-say small" });
    var cardField = h("div", { class: "voice-card-field label" });
    var btnOk = h("button", { class: "btn btn-primary voice-btn", type: "button", text: "Confirm", onclick: function () { confirm(); } });
    var btnRetry = h("button", { class: "btn voice-btn", type: "button", text: "Retry", onclick: function () { retry(); } });
    var cardEl = h("div", { class: "voice-card", hidden: true, role: "group", "aria-label": "Confirm spoken measurement" },
      cardField, cardVal, cardSay, h("div", { class: "voice-card-actions" }, btnOk, btnRetry));
    var hfBox = h("input", { type: "checkbox", id: "voice-hf", onchange: function () {
      handsFree = !!this.checked; if (!handsFree) resumeAt = 0; } });
    hfBox.checked = handsFree;
    var node = h("section", { class: "voice", "aria-label": "Voice entry" },
      h("div", { class: "voice-row" }, mic, h("div", { class: "voice-text" }, status, transcript)),
      cardEl,
      h("label", { class: "voice-hf small", for: "voice-hf" }, hfBox, h("span", { text: "Hands-free: keep listening after each confirm (say “stop” to end)" })),
      h("p", { class: "voice-note muted small", text: (SR && SR.name === "NativeSpeechRecognition") || localOk ? NOTE_LOCAL : NOTE_CLOUD }));

    // --- helpers
    function alive() { if (dead) return false; if (!node.isConnected) { destroy(); return false; } return true; }
    function later(fn, ms) { var id = setTimeout(function () { if (alive()) fn(); }, ms); timers.push(id); return id; }
    function say(msg) { status.textContent = msg; }
    function setState(s) {
      state = s;
      mic.setAttribute("data-state", s);
      mic.setAttribute("aria-pressed", s === "listening" ? "true" : "false");
      mic.setAttribute("aria-label", s === "listening" ? "Listening. Tap to stop." : "Voice entry. Tap to start listening.");
    }
    function speak(text, done) {
      var finished = false;
      function end() { if (finished) return; finished = true; if (!dead && done) done(); }
      try {
        var ss = root.speechSynthesis;
        if (!ss || typeof root.SpeechSynthesisUtterance !== "function") { end(); return; }
        ss.cancel();
        var u = new root.SpeechSynthesisUtterance(text);
        u.lang = "en-US";
        u.onend = end; u.onerror = end;
        ss.speak(u);
        later(end, 9000);                         // some engines never fire onend
      } catch (e) { end(); }
    }
    function stopRec() {
      if (rec) { var r = rec; rec = null; try { r.onresult = r.onerror = r.onend = r.onstart = null; r.abort(); } catch (e) { /* ignore */ } }
    }
    function hideCard() { card = null; cardEl.hidden = true; }

    // --- field resolution (mirrors the capture screen; read-only)
    function filled(f) {
      var s = C.parseShot(f), w = ctx.app.win;
      if (!s || !w) return false;
      var d = w[s.dim];
      return !!(d && d.shots && d.shots.length > s.slot);
    }
    function firstUnfilledShot() {
      for (var i = 0; i < C.SEQUENCE.length; i++) {
        var f = C.SEQUENCE[i];
        if (!C.isShotField(f)) return null;       // width/height complete; the rest are choices/text
        if (!filled(f)) return f;
      }
      return null;
    }
    function targetField() {
      var a = ctx.app.capture && ctx.app.capture.armed;
      if (a && C.isShotField(a)) return a;
      return firstUnfilledShot();
    }
    function unitOf() { var p = ctx.app.project; return p && p.unit === "cm" ? "cm" : "in"; }
    function winId() { return ctx.app.win ? ctx.app.win.id : null; }
    function haveWin() { return !!ctx.app.win && ctx.app.routeName === "capture"; }

    // --- listening
    function toggle() { if (state === "listening" || state === "speaking") stopAll("Stopped."); else start("value"); }

    function stopAll(msg) {
      stopRec();
      try { if (root.speechSynthesis) root.speechSynthesis.cancel(); } catch (e) { /* ignore */ }
      handsFree = false; hfBox.checked = false; resumeAt = 0;
      setState("idle"); transcript.textContent = "";
      if (msg) say(msg);
    }

    function start(m) {
      if (!alive()) return;
      if (!haveWin()) { say("Open a window first."); return; }
      var onDevice = localOk || (SR && SR.name === "NativeSpeechRecognition");
      if (!onDevice && root.navigator && root.navigator.onLine === false) {
        say("You’re offline and this browser’s speech recognition needs a connection — type the value instead.");
        setState("idle"); return;
      }
      stopRec();
      mode = m;
      var r;
      try {
        r = new SR();
        r.lang = "en-US"; r.maxAlternatives = 5; r.interimResults = true; r.continuous = false;
        if (localOk) { try { r.processLocally = true; } catch (e) { /* older engines ignore it */ } }
      } catch (e) { say("Couldn’t start speech recognition. Type the value instead."); setState("idle"); return; }
      var gotFinal = false;
      r.onstart = function () { if (alive() && rec === r) { setState("listening"); transcript.textContent = ""; } };
      r.onresult = function (ev) {
        if (!alive() || rec !== r) return;
        var res = ev.results[ev.results.length - 1];
        if (!res || !res[0]) return;
        transcript.textContent = "“" + res[0].transcript + "”";
        if (!res.isFinal) return;
        gotFinal = true;
        var alts = [];
        for (var i = 0; i < res.length; i++) alts.push(res[i].transcript);
        rec = null;
        try { r.stop(); } catch (e) { /* ignore */ }
        handle(alts);
      };
      r.onerror = function (ev) {
        if (!alive() || rec !== r) return;
        var code = ev && ev.error;
        gotFinal = true;
        rec = null;
        onRecError(code);
      };
      r.onend = function () {
        if (!alive() || rec !== r) return;
        rec = null;
        if (!gotFinal) {                            // ended without a result
          setState("idle");
          if (mode === "confirm" && card) say("Tap Confirm or Retry, or say yes / no.");
          else say("Didn’t hear anything. Tap Voice to try again.");
        }
      };
      rec = r;
      say(m === "confirm" ? "Say yes to lock, or no to retry." : (handsFree ? "Listening (hands-free)…" : "Listening…"));
      try { r.start(); setState("listening"); } catch (e) { rec = null; setState("idle"); say("Couldn’t start the microphone. Tap Voice to try again."); }
    }

    function onRecError(code) {
      setState("idle");
      var m = "Speech error. Type the value instead.";
      if (code === "not-allowed" || code === "service-not-allowed") { m = "Microphone permission was denied. Allow the microphone for this site in your browser settings, or type the value."; handsFree = false; hfBox.checked = false; }
      else if (code === "audio-capture") { m = "No microphone found. Type the value instead."; handsFree = false; hfBox.checked = false; }
      else if (code === "network") { m = "Speech recognition couldn’t reach the speech service. This browser needs an internet connection for voice — check your connection or type the value."; handsFree = false; hfBox.checked = false; }
      else if (code === "language-not-supported") { m = "English (US) speech isn’t available in this browser. Type the value instead."; handsFree = false; hfBox.checked = false; }
      else if (code === "no-speech") {
        failures++;
        if (mode === "confirm" && card) { say("Didn’t hear a reply. Tap Confirm or Retry."); return; }
        if (handsFree && failures < 3) { say("Didn’t hear anything. Still listening…"); later(function () { start("value"); }, 300); return; }
        handsFree = false; hfBox.checked = false;
        m = "Didn’t hear anything. Tap Voice and try again.";
      } else if (code === "aborted") { return; }
      say(m);
    }

    // --- interpreting
    function kindOf(field) { var s = C.parseShot(field); return s ? s.dim : "width"; }

    function handle(alts) {
      setState("idle");
      var field = targetField();
      var r = V.parseAlternatives(alts, { unit: unitOf(), kind: field ? kindOf(field) : "width" });
      if (r.ok && r.kind === "command") return runCommand(r.command);
      if (r.ok && r.kind === "value") return showReadback(r, field);
      failures++;
      var msg;
      if (r.reason === "ambiguous") {
        var parts = (r.candidates || []).map(function (c) { return c.kind === "command" ? "“" + c.command + "”" : c.display; });
        msg = "I heard " + parts.join(" or ") + ". Please say it again.";
      } else if (r.reason === "out-of-range") {
        msg = "That’s outside the usual range (" + (r.display || "") + "). Nothing was saved. Please say it again.";
      } else if (r.reason === "invalid") {
        msg = "Feet and inches didn’t add up. Nothing was saved. Please say it again.";
      } else {
        msg = "I didn’t catch a measurement. Say it like “thirty four and seven eighths”. Nothing was saved.";
      }
      say(msg);
      relisten(msg, mode);
    }

    function relisten(msg, m) {
      if (card && m === "confirm") { speak(msg, function () { start("confirm"); }); return; }
      if (handsFree && failures < 4) { speak(msg, function () { start("value"); }); return; }
      if (handsFree) { handsFree = false; hfBox.checked = false; say(msg + " Hands-free stopped."); }
      speak(msg);
    }

    function showReadback(r, field) {
      if (!field) {
        var m = "Width and height are done — arm a shot first (or say depth) to save a measurement.";
        say(m); speak(m); return;
      }
      failures = 0;
      card = { r: r, field: field, winId: winId(), committed: false };
      cardField.textContent = C.fieldLabel(field);
      cardVal.textContent = r.text;
      cardSay.textContent = r.exact ? "Heard exactly that." : "Heard " + r.display.split(", recorded as ")[0] + " — the order uses the next 1/8″ down.";
      cardEl.hidden = false;
      btnOk.disabled = false;
      var line = C.fieldLabel(field) + ": " + r.display + ".";
      say(line + " Confirm or retry.");
      try { cardEl.scrollIntoView({ block: "nearest" }); btnOk.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
      setState("speaking");
      speak(line + " Say yes to lock, or no to retry.", function () { if (card && !card.committed) start("confirm"); else setState("idle"); });
    }

    function retry() {
      stopRec();
      try { if (root.speechSynthesis) root.speechSynthesis.cancel(); } catch (e) { /* ignore */ }
      hideCard(); setState("idle"); say("Cleared. Say the measurement again.");
      start("value");
    }

    // The only place a spoken value reaches the data model, via the typed-entry events.
    function confirm() {
      if (!alive()) return;
      stopRec();
      try { if (root.speechSynthesis) root.speechSynthesis.cancel(); } catch (e) { /* ignore */ }
      if (!card || card.committed) { say("Nothing to confirm."); return; }
      var c = card;
      if (!haveWin() || winId() !== c.winId) { hideCard(); say("The window changed. Nothing was saved — say it again."); return; }
      var armed = ctx.app.capture && ctx.app.capture.armed;
      if (armed && C.isShotField(armed) && armed !== c.field) {
        hideCard(); say("The armed field changed. Nothing was saved — say it again."); return;
      }
      if (filled(c.field) && !(armed === c.field)) { /* re-shoot of a filled slot is allowed only when armed */
        hideCard(); say("That slot already has a value. Arm it to replace it. Nothing was saved."); return;
      }
      c.committed = true; btnOk.disabled = true;
      var s = C.parseShot(c.field), w = ctx.app.win;
      try {
        if (armed !== c.field) ctx.dispatch({ type: "arm", field: c.field }, { quiet: true, focus: false });
        ctx.dispatch({ type: "keystroke", value: c.r.inches }, { quiet: true });
        var pend = ctx.app.capture && ctx.app.capture.pending;
        if (!pend || pend.value !== c.r.inches || pend.source !== "manual") {
          ctx.dispatch({ type: "keystroke", value: null }, { quiet: true });
          hideCard(); say("Couldn’t stage the value. Nothing was saved."); return;
        }
        ctx.dispatch({ type: "commit" });
        var d = w && w[s.dim];
        var shot = d && d.shots && d.shots[s.slot];
        if (!shot || shot.raw !== c.r.inches) { hideCard(); say("The value was not recorded. Please type it."); return; }
        lastVoice = { win: w, dim: s.dim, slot: s.slot, inches: c.r.inches };
      } catch (e) {
        hideCard(); say("Couldn’t save that. Please type it."); return;
      }
      hideCard(); setState("idle");
      say("Locked " + C.fieldLabel(c.field) + " at " + c.r.spoken + ".");
      if (handsFree) {
        resumeAt = Date.now();
        speak("Locked.", function () { if (alive()) { resumeAt = 0; start("value"); } });
      } else speak("Locked.");
    }

    // --- commands (never numbers)
    function runCommand(cmd) {
      if (cmd === "stop") { stopAll("Stopped."); speak("Stopped."); return; }
      if (cmd === "confirm") {
        if (card && !card.committed) { confirm(); return; }
        var m = "Nothing to confirm."; say(m); relisten(m, "value"); return;
      }
      if (cmd === "cancel") {
        if (card) { retry(); return; }
        say("Nothing to cancel."); relisten("Nothing to cancel.", "value"); return;
      }
      if (card && !card.committed) { hideCard(); }           // any other command discards the pending read-back
      var armed = ctx.app.capture && ctx.app.capture.armed, f, msg = "";
      try {
        if (cmd === "next") {
          f = armed ? C.nextField(armed, filled) : firstUnfilledShot();
          if (f) { ctx.dispatch({ type: "arm", field: f }, { quiet: true }); msg = C.fieldLabel(f) + " armed."; }
          else { ctx.dispatch({ type: "disarm" }, { quiet: true }); msg = "That was the last field."; }
        } else if (cmd === "back") {
          var i = armed ? C.SEQUENCE.indexOf(armed) : -1, shot = C.parseShot(armed);
          if (shot && shot.slot > 0 && i < 0) f = shot.dim + "." + (shot.slot - 1);
          else if (i > 0) f = C.SEQUENCE[i - 1];
          if (f) { ctx.dispatch({ type: "arm", field: f }, { quiet: true }); msg = C.fieldLabel(f) + " armed."; }
          else msg = "Already at the first field.";
        } else if (cmd === "clear") {
          var inp = root.document.getElementById("manual");
          if (inp) inp.value = "";
          ctx.dispatch({ type: "keystroke", value: null }, { quiet: true });
          msg = "Cleared.";
        } else if (cmd === "undo") {
          msg = undoLast();
        } else if (cmd === "inside" || cmd === "outside") {
          ctx.dispatch({ type: "set", field: "mountType", value: cmd === "inside" ? "IB" : "OB" }, { quiet: true });
          msg = (cmd === "inside" ? "Inside" : "Outside") + " mount.";
        } else if (cmd === "left" || cmd === "right") {
          ctx.dispatch({ type: "set", field: "controlSide", value: cmd }, { quiet: true });
          msg = "Control side " + cmd + ".";
        } else if (cmd === "depth") {
          f = null;
          for (var k = 0; k < C.SHOT_SLOTS; k++) { if (!filled("depth." + k)) { f = "depth." + k; break; } }
          if (f) { ctx.dispatch({ type: "arm", field: f }, { quiet: true }); msg = C.fieldLabel(f) + " armed."; }
          else msg = "Depth shots are full.";
        }
      } catch (e) { msg = "That command didn’t work."; }
      failures = 0;
      say(msg);
      if (handsFree) speak(msg, function () { start("value"); }); else speak(msg);
    }

    // Undo only what voice itself locked, only if it is still the last shot of that dimension.
    function undoLast() {
      var lv = lastVoice;
      if (!lv || ctx.app.win !== lv.win) return "Nothing to undo by voice. Use Remove shot.";
      var d = lv.win[lv.dim];
      var last = d && d.shots && d.shots.length - 1;
      if (!d || last !== lv.slot || !d.shots[last] || d.shots[last].raw !== lv.inches) return "Can’t undo that by voice. Use Remove shot.";
      d.shots.pop();
      ctx.S.recomputeOrdered(d);
      ctx.saveProject();
      lastVoice = null;
      ctx.dispatch({ type: "disarm" }, { quiet: true });
      ctx.dispatch({ type: "arm", field: lv.dim + "." + lv.slot }, { quiet: true });
      return "Removed " + C.fieldLabel(lv.dim + "." + lv.slot).toLowerCase() + ".";
    }

    function destroy() {
      if (dead) return;
      dead = true;
      stopRec();
      timers.forEach(clearTimeout); timers = [];
      try { if (root.speechSynthesis) root.speechSynthesis.cancel(); } catch (e) { /* ignore */ }
      if (current && current.node === node) current = null;
    }

    // Hands-free carries across the automatic move to the next window.
    if (handsFree && resumeAt && Date.now() - resumeAt < 4000) {
      resumeAt = 0;
      setTimeout(function () { if (!dead && node.isConnected) start("value"); }, 400);
    }

    return { node: node, destroy: destroy };
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
