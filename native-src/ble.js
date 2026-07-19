/*
 * Native BLE transport for Apex Measure Pro (Capacitor).
 *
 * Only used when running inside the native app (Capacitor.isNativePlatform()).
 * The web PWA keeps using its own navigator.bluetooth code in index.html —
 * this file is never invoked there. Exposes window.ApexBLE, which index.html's
 * connectNative()/disconnect() drive. Mirrors the web path's connect →
 * notify → auto-reconnect behavior and reports state through callbacks so the
 * existing UI code (setStatus/setConnectedUI/fileShot/wake-lock) stays in charge.
 *
 * Build:  npm run build:ble   ->  apex-measure-pro_1/ble-native.bundle.js
 */
import { BleClient } from '@capacitor-community/bluetooth-le';
import { Capacitor } from '@capacitor/core';

(function () {
  var cfg = null;          // { service, characteristic, onMeasure, onStatus, onConnected, onReconnecting, onReconnected, onDisconnected, onError }
  var deviceId = null;
  var lastName = 'D2';
  var want = false;        // user intends to stay connected (mirrors wantConnected)
  var reconnecting = false;

  function startNotify() {
    return BleClient.startNotifications(deviceId, cfg.service, cfg.characteristic, function (value) {
      // value is a DataView; measurement is a little-endian float32 in METERS.
      if (!value || value.byteLength < 4) return;
      var meters = value.getFloat32(0, true);
      cfg.onMeasure(meters);
    });
  }

  // Fired by the plugin when the link drops (e.g. the D2 sleeps).
  function onNativeDisconnect() {
    if (!want) { cfg.onDisconnected && cfg.onDisconnected(); return; }
    cfg.onReconnecting && cfg.onReconnecting();
    reconnectLoop(0);
  }

  function reconnectLoop(attempt) {
    if (!want) { reconnecting = false; return; }
    reconnecting = true;
    BleClient.connect(deviceId, onNativeDisconnect)
      .then(startNotify)
      .then(function () { reconnecting = false; cfg.onReconnected && cfg.onReconnected(lastName); })
      .catch(function () {
        var a = attempt + 1;
        setTimeout(function () { reconnectLoop(a); }, Math.min(1000 * a, 5000));
      });
  }

  window.ApexBLE = {
    isNative: function () { try { return Capacitor.isNativePlatform(); } catch (_) { return false; } },

    connect: function (config) {
      cfg = config; want = true;
      return BleClient.initialize({ androidNeverForLocation: true })
        .then(function () { return BleClient.requestDevice({ services: [cfg.service], optionalServices: [cfg.service] }); })
        .then(function (d) {
          deviceId = d.deviceId; lastName = d.name || 'D2';
          cfg.onStatus && cfg.onStatus('wait', 'Connecting…', '');
          return BleClient.connect(deviceId, onNativeDisconnect);
        })
        .then(startNotify)
        .then(function () { cfg.onConnected && cfg.onConnected(lastName); })
        .catch(function (e) {
          want = false;
          var msg = (e && e.message ? e.message : '').toLowerCase();
          if (msg.indexOf('cancel') !== -1 || msg.indexOf('no device') !== -1) {
            cfg.onStatus && cfg.onStatus('off', 'No device selected', 'Tap Connect to retry.');
          } else {
            cfg.onError && cfg.onError(e);
          }
        });
    },

    disconnect: function () {
      want = false; reconnecting = false;
      var id = deviceId;
      deviceId = null;
      if (!id || !cfg) return Promise.resolve();
      return BleClient.stopNotifications(id, cfg.service, cfg.characteristic)
        .catch(function () {})
        .then(function () { return BleClient.disconnect(id).catch(function () {}); });
    }
  };
})();
