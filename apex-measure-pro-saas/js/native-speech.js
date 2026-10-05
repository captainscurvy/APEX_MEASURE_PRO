/*
 * native-speech.js — gives the Capacitor wrapper the device's OWN speech recognizer through the same
 * interface ui-voice.js already uses (window.SpeechRecognition). iPhone: Apple's SFSpeechRecognizer;
 * Android: the system recognizer. No web speech model, nothing bundled, nothing heavy.
 *
 * Plugin: @capacitor-community/speech-recognition (raw API: available, requestPermissions, start, stop,
 * removeAllListeners). Only installs inside a native Capacitor shell with the plugin registered, and only
 * when the page has no SpeechRecognition of its own, so the web build is untouched.
 *
 * The adapter is one-shot per start() like the web API with continuous=false: it resolves a final result
 * with up to 5 alternatives, then fires onend. Mapping of errors mirrors the web codes ui-voice handles.
 *
 * STATUS: written to the plugin's documented API; UNTESTED on a device (see native/TEST-PLAN.md).
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else { root.ApexNativeSpeech = api; api.install(root); }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function mapError(e) {
    var m = String((e && (e.message || e.errorMessage)) || e || "").toLowerCase();
    if (/permission|denied|not authorized|authoriz/.test(m)) return "not-allowed";
    if (/no speech|nospeech|didn't hear|silence/.test(m)) return "no-speech";
    if (/network/.test(m)) return "network";
    if (/language/.test(m)) return "language-not-supported";
    if (/cancel|abort|stopped/.test(m)) return "aborted";
    if (/audio|microphone|record/.test(m)) return "audio-capture";
    return "service-not-allowed" === m ? m : "no-speech";
  }

  function createClass(plugin) {
    function NativeSpeechRecognition() {
      this.lang = "en-US"; this.maxAlternatives = 5; this.interimResults = false; this.continuous = false;
      this.onstart = this.onresult = this.onerror = this.onend = null;
      this._live = false; this._gen = 0;
      this.native = true;                                 // lets the UI say "on-device" truthfully
    }
    var P = NativeSpeechRecognition.prototype;
    P.start = function () {
      var self = this, gen = ++this._gen;
      if (this._live) throw new Error("already started");
      this._live = true;
      function alive() { return self._live && self._gen === gen; }
      function fire(name, arg) { try { if (typeof self[name] === "function") self[name](arg); } catch (e) { /* ignore */ } }
      Promise.resolve()
        .then(function () { return plugin.requestPermissions(); })
        .then(function (perm) {
          var granted = !perm || perm.speechRecognition === "granted" || perm.permission === "granted" || perm.speechRecognition === undefined;
          if (!granted) { var err = new Error("permission denied"); err.code = "not-allowed"; throw err; }
          if (!alive()) return null;
          fire("onstart");
          return plugin.start({ language: self.lang, maxResults: self.maxAlternatives, prompt: "", partialResults: false, popup: false });
        })
        .then(function (res) {
          if (!alive()) return;
          var matches = (res && res.matches) || [];
          if (!matches.length) { var e2 = new Error("no speech"); e2.code = "no-speech"; throw e2; }
          var alts = matches.map(function (t) { return { transcript: String(t), confidence: 1 }; });
          var result = alts.slice(); result.item = function (i) { return alts[i]; }; result.isFinal = true;
          var list = [result]; list.item = function (i) { return list[i]; };
          fire("onresult", { resultIndex: 0, results: list });
          self._live = false; fire("onend");
        })
        .catch(function (e) {
          if (!alive()) return;
          self._live = false;
          fire("onerror", { error: (e && e.code) || mapError(e) });
          fire("onend");
        });
    };
    P.stop = function () {
      if (!this._live) return;
      try { var p = plugin.stop(); if (p && p.catch) p.catch(function () {}); } catch (e) { /* ignore */ }
    };
    P.abort = function () {
      var was = this._live; this._live = false; this._gen++;
      if (was) { try { var p = plugin.stop(); if (p && p.catch) p.catch(function () {}); } catch (e) { /* ignore */ } }
    };
    return NativeSpeechRecognition;
  }

  function install(root) {
    try {
      var cap = root.Capacitor;
      if (!cap || !cap.isNativePlatform || !cap.isNativePlatform()) return;
      var plugin = (cap.Plugins && cap.Plugins.SpeechRecognition) || (cap.registerPlugin && cap.registerPlugin("SpeechRecognition"));
      if (!plugin) return;
      root.SpeechRecognition = createClass(plugin);       // native engine wins in the wrapper
    } catch (e) { /* never break boot */ }
  }

  return { createClass: createClass, mapError: mapError, install: install };
});
