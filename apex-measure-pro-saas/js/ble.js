/*
 * ble.js — Leica DISTO over Web Bluetooth (GATT, not HID).
 *
 *   §3.1  hardcoded service / characteristic UUIDs, float32LE meters payload
 *   §3.2  reconnect MUST re-discover, re-subscribe and re-attach — cached
 *         characteristic references die with the connection
 *   §3.3  writable characteristic found by discovery; trigger gated on
 *         TRIGGER_COMMAND, which stays null until found on hardware
 *   §8.7  one connection per origin — BroadcastChannel multi-tab detection
 *
 * Every platform object is injected (bluetooth, document, timers, channel)
 * so tests/browser.html can drive the full reconnect path with a fake device.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ApexBle = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  var SERVICE_UUID     = "3ab10100-f831-4395-b29d-570977d5bf94";
  var MEASUREMENT_UUID = "3ab10101-f831-4395-b29d-570977d5bf94";
  var UNITS_UUID       = "3ab10102-f831-4395-b29d-570977d5bf94";

  // ← GATED. Set only when discovered on hardware with tools/ble-probe.html.
  // Do not invent a value. Do not remove the gate.
  var TRIGGER_COMMAND = null;

  var BACKOFF_MS = [1000, 2000, 5000, 15000, 30000];
  var BACKOFF_CAP_MS = 60000;
  var MSG_UNREACHABLE = "Can't reach the laser. Make sure it's on and in range.";
  var MSG_OTHER_TAB = "Another tab is using the laser. Close this tab, or disconnect in the other tab first.";

  function canTrigger(state) {
    return Boolean(state && state.writableChar) && TRIGGER_COMMAND !== null;
  }

  async function findWritableCharacteristic(service) {
    var chars = await service.getCharacteristics();
    return chars.find(function (c) { return c.properties.write || c.properties.writeWithoutResponse; }) || null;
  }

  function backoffDelay(attempt) {
    return attempt < BACKOFF_MS.length ? BACKOFF_MS[attempt] : BACKOFF_CAP_MS;
  }

  /*
   * createLaser(opts)
   *   opts.onReading(meters)          decoded float32 (meters)
   *   opts.onState(snapshot)          { status, message, deviceName, canTrigger }
   *   opts.bluetooth, opts.doc, opts.setTimeout, opts.clearTimeout,
   *   opts.BroadcastChannel, opts.channelWaitMs   — injectable for tests
   *
   * status: "unsupported" | "idle" | "connecting" | "connected"
   *       | "reconnecting" | "busy-elsewhere"
   */
  function createLaser(opts) {
    opts = opts || {};
    var bluetooth = opts.bluetooth !== undefined ? opts.bluetooth
      : (root.navigator && root.navigator.bluetooth) || null;
    var doc = opts.doc !== undefined ? opts.doc : root.document || null;
    var setT = opts.setTimeout || root.setTimeout.bind(root);
    var clearT = opts.clearTimeout || root.clearTimeout.bind(root);
    var BC = opts.BroadcastChannel !== undefined ? opts.BroadcastChannel : root.BroadcastChannel;
    var channelWaitMs = opts.channelWaitMs !== undefined ? opts.channelWaitMs : 150;
    var onReading = opts.onReading || function () {};
    var onState = opts.onState || function () {};

    var device = null;
    var service = null;
    var measurementChar = null;
    var writableChar = null;
    var status = bluetooth ? "idle" : "unsupported";
    var message = "";
    var attempt = 0;
    var timer = null;
    var inFlight = false;
    var wantConnected = false;     // false after an explicit disconnect
    var pausedHidden = false;
    var tabId = Math.random().toString(36).slice(2);
    var otherHolders = {};
    var channel = null;

    try { if (BC) channel = new BC("apex-ble"); } catch (e) { channel = null; }
    if (channel) {
      channel.onmessage = function (ev) {
        var m = ev && ev.data;
        if (!m || m.from === tabId) return;
        if (m.type === "query" && status === "connected") channel.postMessage({ type: "holding", from: tabId });
        if (m.type === "holding") otherHolders[m.from] = true;
        if (m.type === "released") {
          delete otherHolders[m.from];
          if (status === "busy-elsewhere") setState("idle", "");
        }
      };
      channel.postMessage({ type: "query", from: tabId });
    }

    function snapshot() {
      return {
        status: status,
        message: message,
        deviceName: device && device.name || "",
        canTrigger: canTrigger({ writableChar: writableChar }),
        channel: Boolean(channel)
      };
    }
    function setState(s, msg) {
      status = s;
      message = msg || "";
      onState(snapshot());
    }

    function onMeasurement(event) {
      var v = event.target.value;
      var meters = new DataView(v.buffer, v.byteOffset || 0, v.byteLength).getFloat32(0, true);
      onReading(meters);
    }

    function onDisconnect() {
      measurementChar = null;       // every cached reference is dead
      writableChar = null;
      service = null;
      if (channel) channel.postMessage({ type: "released", from: tabId });
      if (!wantConnected) { setState("idle", ""); return; }
      setState("reconnecting", "Laser disconnected — reconnecting…");
      scheduleReconnect();
    }

    async function connectAndWire(dev) {
      var server = await dev.gatt.connect();                          // same device object, no picker
      service = await server.getPrimaryService(SERVICE_UUID);         // RE-DISCOVER
      measurementChar = await service.getCharacteristic(MEASUREMENT_UUID);
      await measurementChar.startNotifications();                     // RE-SUBSCRIBE
      measurementChar.addEventListener("characteristicvaluechanged", onMeasurement);  // RE-ATTACH
      writableChar = await findWritableCharacteristic(service);       // re-find (§3.3)
      attempt = 0;
      if (channel) channel.postMessage({ type: "holding", from: tabId });
      // "connected" only now: notifications started AND listener attached.
      setState("connected", "");
    }

    function clearTimer() { if (timer !== null) { clearT(timer); timer = null; } }

    function scheduleReconnect() {
      clearTimer();
      if (!wantConnected || !device) return;
      if (doc && doc.hidden) { pausedHidden = true; return; }    // battery bound
      var delay = backoffDelay(attempt);
      timer = setT(function () { timer = null; attemptReconnect(); }, delay);
    }

    async function attemptReconnect() {
      if (inFlight || !device || !wantConnected) return;
      if (doc && doc.hidden) { pausedHidden = true; return; }
      inFlight = true;
      try {
        await connectAndWire(device);
      } catch (e) {
        attempt++;
        setState("reconnecting", MSG_UNREACHABLE);
        scheduleReconnect();
      } finally {
        inFlight = false;
      }
    }

    function onVisibility() {
      if (!doc) return;
      if (doc.hidden) {
        clearTimer();
        if (status === "reconnecting") pausedHidden = true;
      } else if (pausedHidden) {
        pausedHidden = false;
        if (status === "reconnecting") attemptReconnect();
      }
    }
    if (doc && doc.addEventListener) doc.addEventListener("visibilitychange", onVisibility);

    function otherTabHolds() {
      if (!channel) return Promise.resolve(false);
      otherHolders = {};
      channel.postMessage({ type: "query", from: tabId });
      return new Promise(function (res) {
        setT(function () { res(Object.keys(otherHolders).length > 0); }, channelWaitMs);
      });
    }

    // Must be called from a user gesture (tap). Never on page load.
    async function connect() {
      if (!bluetooth) { setState("unsupported", ""); return false; }
      if (status === "connected" || inFlight) return status === "connected";
      if (device) return reconnectNow();
      if (await otherTabHolds()) { setState("busy-elsewhere", MSG_OTHER_TAB); return false; }
      var dev;
      try {
        dev = await bluetooth.requestDevice({
          filters: [{ services: [SERVICE_UUID] }, { namePrefix: "DISTO" }],
          optionalServices: [SERVICE_UUID]
        });
      } catch (e) {
        // NotFoundError = user closed the chooser; that is not an error.
        setState("idle", e && e.name === "NotFoundError" ? "" : MSG_UNREACHABLE);
        return false;
      }
      device = dev;
      wantConnected = true;
      device.addEventListener("gattserverdisconnected", onDisconnect);
      setState("connecting", "");
      inFlight = true;
      try {
        await connectAndWire(device);
        return true;
      } catch (e) {
        // Without a channel (e.g. file://) we cannot tell another tab apart
        // from a laser that is off, so say both plainly.
        setState("reconnecting", channel ? MSG_UNREACHABLE : MSG_UNREACHABLE + " " + MSG_OTHER_TAB);
        attempt = 1;
        scheduleReconnect();
        return false;
      } finally {
        inFlight = false;
      }
    }

    // Manual "Reconnect": cancel the pending timer, try now; on failure the
    // backoff restarts from 1s.
    async function reconnectNow() {
      if (!device) return connect();
      clearTimer();
      wantConnected = true;
      attempt = 0;
      if (inFlight) return false;
      inFlight = true;
      setState("reconnecting", "Laser disconnected — reconnecting…");
      try {
        await connectAndWire(device);
        return true;
      } catch (e) {
        attempt = 0;
        setState("reconnecting", MSG_UNREACHABLE);
        scheduleReconnect();
        return false;
      } finally {
        inFlight = false;
      }
    }

    function disconnect() {
      wantConnected = false;
      clearTimer();
      if (device && device.gatt && device.gatt.connected) device.gatt.disconnect();
      else setState("idle", "");
    }

    async function trigger() {
      if (!canTrigger({ writableChar: writableChar })) return false;
      var bytes = new Uint8Array(TRIGGER_COMMAND);
      if (writableChar.properties.writeWithoutResponse && writableChar.writeValueWithoutResponse) {
        await writableChar.writeValueWithoutResponse(bytes);
      } else {
        await writableChar.writeValue(bytes);
      }
      return true;
    }

    function release() {
      if (channel) channel.postMessage({ type: "released", from: tabId });
    }

    return {
      connect: connect,
      reconnectNow: reconnectNow,
      disconnect: disconnect,
      trigger: trigger,
      release: release,
      snapshot: snapshot,
      // test hooks
      _debug: function () {
        return { attempt: attempt, timerPending: timer !== null, pausedHidden: pausedHidden,
                 hasChar: measurementChar !== null, wantConnected: wantConnected };
      }
    };
  }

  return {
    SERVICE_UUID: SERVICE_UUID,
    MEASUREMENT_UUID: MEASUREMENT_UUID,
    UNITS_UUID: UNITS_UUID,
    TRIGGER_COMMAND: TRIGGER_COMMAND,
    BACKOFF_MS: BACKOFF_MS,
    BACKOFF_CAP_MS: BACKOFF_CAP_MS,
    MSG_UNREACHABLE: MSG_UNREACHABLE,
    MSG_OTHER_TAB: MSG_OTHER_TAB,
    canTrigger: canTrigger,
    findWritableCharacteristic: findWritableCharacteristic,
    backoffDelay: backoffDelay,
    createLaser: createLaser
  };
});
