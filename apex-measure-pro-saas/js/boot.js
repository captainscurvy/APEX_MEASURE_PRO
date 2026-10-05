// §14.4 — feature detect before loading anything. Classic scripts (not ES
  // modules) so the app also runs opened straight from disk: Chrome blocks
  // module imports from file://.
  (function () {
    var missing = [];
    if (!("noModule" in document.createElement("script"))) missing.push("modern JavaScript (ES modules)");
    if (!("indexedDB" in window)) missing.push("IndexedDB storage");
    if (missing.length) {
      document.getElementById("view").innerHTML =
        '<div class="fatal"><h1>This browser is too old</h1><p>Apex Measure Pro needs ' +
        missing.join(" and ") + '. Open it in a current version of Chrome or Edge.</p></div>';
      return;
    }
    var files = ["js/config.js", "js/ext.js", "js/reduce.js", "js/capture.js", "js/store.js", "js/profile.js", "js/sheet.js", "js/ble.js", "js/native-bridge.js", "js/transport.js", "js/plans.js", "js/backend.js", "js/ui-legal.js", "js/account.js", "js/sync.js", "js/voice.js", "js/native-speech.js", "js/ui-voice.js", "js/sound.js", "js/ui-team.js", "js/ui-orders.js", "js/main.js"];
    files.forEach(function (f) {
      var s = document.createElement("script");
      s.src = "./" + f;
      s.async = false;          // execute in order
      document.body.appendChild(s);
    });
  })();
