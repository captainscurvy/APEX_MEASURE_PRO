/*
 * native-bridge.js — BleClient for the Capacitor iPhone/Android wrapper, WITHOUT a bundler.
 *
 * @capacitor-community/bluetooth-le ships its friendly `BleClient` as an ES-module wrapper around the
 * raw plugin. The plain-script web app can't import it, so this file re-creates the small slice
 * transport.js uses (initialize, requestDevice, connect, disconnect, startNotifications) directly on
 * the raw plugin, converting its hex-string values to DataView exactly as the module does.
 *
 * Does nothing outside a native Capacitor shell (window.Capacitor.isNativePlatform() must be true and
 * the BluetoothLe plugin registered), so the web build is unaffected.
 *
 * STATUS: written against the plugin's documented raw API; UNTESTED on hardware (no Apple device yet).
 * See native/TEST-PLAN.md. Pure helpers are unit-tested (hexToDataView).
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else { root.ApexNativeBridge = api; api.install(root); }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function hexToDataView(hex) {
    var s = String(hex || "").replace(/[^0-9a-fA-F]/g, "");
    var n = Math.floor(s.length / 2), buf = new ArrayBuffer(n), u = new Uint8Array(buf);
    for (var i = 0; i < n; i++) u[i] = parseInt(s.substr(i * 2, 2), 16);
    return new DataView(buf);
  }

  function createBleClient(plugin) {
    var listeners = {};                                   // key -> handle, so stop/disconnect can remove them
    function on(key, fn) {
      var p = plugin.addListener(key, fn);
      listeners[key] = p;
      return p;
    }
    function off(key) {
      var p = listeners[key]; delete listeners[key];
      if (p && typeof p.then === "function") p.then(function (h) { if (h && h.remove) h.remove(); }).catch(function () {});
      else if (p && p.remove) p.remove();
    }
    return {
      initialize: function () { return plugin.initialize({ androidNeverForLocation: true }); },
      requestDevice: function (opts) {
        return plugin.requestDevice(opts || {}).then(function (r) { return r && r.device ? r.device : r; });
      },
      connect: function (deviceId, onDisconnect) {
        var key = "disconnected|" + deviceId;
        off(key);
        if (onDisconnect) on(key, function () { onDisconnect(deviceId); });
        return plugin.connect({ deviceId: deviceId, timeout: 15000 });
      },
      disconnect: function (deviceId) {
        off("disconnected|" + deviceId);
        return plugin.disconnect({ deviceId: deviceId });
      },
      startNotifications: function (deviceId, service, characteristic, cb) {
        var key = "notification|" + deviceId + "|" + service + "|" + characteristic;
        off(key);
        on(key, function (ev) { cb(hexToDataView(ev && ev.value)); });
        return plugin.startNotifications({ deviceId: deviceId, service: service, characteristic: characteristic });
      }
    };
  }

  function install(root) {
    try {
      var cap = root.Capacitor;
      if (!cap || !cap.isNativePlatform || !cap.isNativePlatform() || root.BleClient) return;
      var plugin = (cap.Plugins && cap.Plugins.BluetoothLe) || (cap.registerPlugin && cap.registerPlugin("BluetoothLe"));
      if (plugin) root.BleClient = createBleClient(plugin);
    } catch (e) { /* never break boot */ }
  }

  return { hexToDataView: hexToDataView, createBleClient: createBleClient, install: install };
});
