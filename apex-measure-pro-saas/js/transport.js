/*
 * transport.js — hardware-agnostic laser reading layer (ApexTransport).
 *
 * createLaser(opts) has EXACTLY the interface of ApexBle.createLaser:
 *   connect, reconnectNow, disconnect, trigger, release, snapshot
 *   opts.onReading(meters), opts.onState(snapshot)
 *   snapshot = { status, message, deviceName, canTrigger, channel }
 *
 * Selection order:
 *   0. native Capacitor BLE (@capacitor-community/bluetooth-le via native/bridge/ble-bridge.js) -- UNTESTED on hardware
 *   1. iOS/iPadOS in a browser (no Web Bluetooth, no wrapper) -> "under construction" laser
 *   2. Web Bluetooth via ApexBle (proven path; ble.js is not modified)
 *   3. unsupported
 *
 * EXTENDING TO ANOTHER LASER: add an entry to DEVICES with
 *   { id, label, verified, service, measurement, filters (namePrefix list), decode(dataView) -> meters }
 * decode MUST return meters; every value is range-checked by validateMeters before onReading.
 * Only "leica-disto-ble" is verified. Do not mark another profile verified without hardware.
 *
 * Everything environment-dependent is injectable via opts.env for Node tests.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ApexTransport = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  var MAX_METERS = 200;
  var BACKOFF_MS = [1000, 2000, 5000, 15000, 30000];   // same schedule as ble.js
  var BACKOFF_CAP_MS = 60000;
  var MSG_UNREACHABLE = "Can't reach the laser. Make sure it's on and in range.";
  var MSG_RECONNECTING = "Laser disconnected — reconnecting…";
  var MSG_IOS = "iPhone laser support is under construction — type or speak measurements.";
  var MSG_UNSUPPORTED = "Laser capture needs Android or desktop Chrome/Edge. Type or speak measurements instead.";

  var DEVICES = {
    "leica-disto-ble": {
      id: "leica-disto-ble",
      label: "Leica DISTO (D2 and BLE family)",
      verified: true,                      // UUIDs + float32LE meters: same as ble.js
      service: "3ab10100-f831-4395-b29d-570977d5bf94",
      measurement: "3ab10101-f831-4395-b29d-570977d5bf94",
      namePrefixes: ["DISTO"],
      decode: function (dv) { return dv.getFloat32(0, true); }
    }
  };
  var DEFAULT_PROFILE = "leica-disto-ble";

  function toDataView(v) {
    try {
      if (!v) return null;
      if (typeof v.getFloat32 === "function") return v;                       // DataView
      if (v.buffer && typeof v.byteLength === "number")                         // typed array
        return new DataView(v.buffer, v.byteOffset || 0, v.byteLength);
      if (typeof ArrayBuffer !== "undefined" && v instanceof ArrayBuffer) return new DataView(v);
    } catch (e) { /* fall through */ }
    return null;
  }

  // Returns meters, or null when the value must not reach onReading.
  function validateMeters(m) {
    if (typeof m !== "number" || !isFinite(m)) return null;
    if (m < 0 || m > MAX_METERS) return null;
    return m;
  }

  // Decode a plugin/Web payload with a profile; null if malformed or out of range.
  function decodeMeasurement(payload, profile) {
    try {
      var p = typeof profile === "string" ? DEVICES[profile] : (profile || DEVICES[DEFAULT_PROFILE]);
      var dv = toDataView(payload);
      if (!p || !dv || dv.byteLength < 4) return null;
      return validateMeters(p.decode(dv));
    } catch (e) { return null; }
  }

  function backoffDelay(attempt) {
    return attempt < BACKOFF_MS.length ? BACKOFF_MS[attempt] : BACKOFF_CAP_MS;
  }

  function isIOS(env) {
    var nav = env.navigator || {};
    var ua = String(nav.userAgent || "");
    if (/iPhone|iPad|iPod/.test(ua)) return true;
    return nav.platform === "MacIntel" && (nav.maxTouchPoints || 0) > 1;   // iPadOS reports as Mac
  }

  function isNative(env) {
    try { return Boolean(env.Capacitor && env.Capacitor.isNativePlatform && env.Capacitor.isNativePlatform()); }
    catch (e) { return false; }
  }

  function resolveEnv(opts) {
    var e = opts.env || {};
    function pick(k, dflt) { return e[k] !== undefined ? e[k] : dflt; }
    var win = pick("window", root);
    var cap = pick("Capacitor", win && win.Capacitor);
    var client = pick("BleClient", null);
    if (!client && cap && cap.Plugins && cap.Plugins.BluetoothLe) client = null;   // plugin exports BleClient as a module
    if (!client && win && win.BleClient) client = win.BleClient;
    return {
      window: win,
      navigator: pick("navigator", win && win.navigator),
      Capacitor: cap,
      BleClient: client,
      ApexBle: pick("ApexBle", win && win.ApexBle),
      config: pick("config", win && win.ApexConfig),
      doc: pick("doc", win && win.document)
    };
  }

  var SNAP_KEYS = ["status", "message", "deviceName", "canTrigger", "channel"];

  // ---- "unsupported" laser (iOS placeholder / no BLE at all) ------------------------------
  function createUnsupportedLaser(opts, message) {
    var onState = opts.onState || function () {};
    function snapshot() {
      return { status: "unsupported", message: message, deviceName: "", canTrigger: false, channel: false };
    }
    function announce() { try { onState(snapshot()); } catch (e) { /* never throw */ } }
    function again() { announce(); return Promise.resolve(false); }
    return {
      connect: again, reconnectNow: again,
      disconnect: function () { announce(); },
      trigger: function () { return Promise.resolve(false); },
      release: function () {},
      snapshot: snapshot,
      transport: "unsupported"
    };
  }

  // ---- native Capacitor laser (UNTESTED on hardware) -------------------------------------
  function createNativeLaser(opts, env, profile) {
    var BleClient = env.BleClient;
    var doc = env.doc;
    var setT = opts.setTimeout || function (f, ms) { return root.setTimeout(f, ms); };
    var clearT = opts.clearTimeout || function (t) { return root.clearTimeout(t); };
    var onReading = opts.onReading || function () {};
    var onState = opts.onState || function () {};

    var deviceId = null, deviceName = "";
    var status = "idle", message = "";
    var attempt = 0, timer = null, inFlight = false;
    var wantConnected = false, pausedHidden = false, dropped = false, initialized = false;
    var subscribed = false;

    function snapshot() {
      return { status: status, message: message, deviceName: deviceName, canTrigger: false, channel: false };
    }
    function setState(s, msg) {
      status = s; message = msg || "";
      try { onState(snapshot()); } catch (e) { /* never throw */ }
    }
    function clearTimer() { if (timer !== null) { clearT(timer); timer = null; } }

    function onMeasurement(value) {
      var m = decodeMeasurement(value, profile);
      if (m === null) return;                 // bad value never reaches the app
      try { onReading(m); } catch (e) { /* never throw */ }
    }

    function onDisconnect(id) {
      if (deviceId !== null && id !== undefined && id !== deviceId) return;
      subscribed = false;
      dropped = true;
      if (!wantConnected) { setState("idle", ""); return; }
      if (inFlight) return;                   // the in-flight attempt will notice `dropped`
      setState("reconnecting", MSG_RECONNECTING);
      scheduleReconnect();
    }

    async function wire(id) {
      dropped = false;
      await BleClient.connect(id, onDisconnect);                 // fresh link
      // RE-DISCOVER happens inside the plugin on connect; RE-SUBSCRIBE explicitly (ble.js §3.2)
      await BleClient.startNotifications(id, profile.service, profile.measurement, onMeasurement);
      if (dropped) throw new Error("dropped during connect");
      subscribed = true;
      attempt = 0;
      setState("connected", "");
    }

    function scheduleReconnect() {
      clearTimer();
      if (!wantConnected || deviceId === null) return;
      if (doc && doc.hidden) { pausedHidden = true; return; }
      timer = setT(function () { timer = null; attemptReconnect(); }, backoffDelay(attempt));
    }

    async function attemptReconnect() {
      if (inFlight || deviceId === null || !wantConnected) return;
      if (doc && doc.hidden) { pausedHidden = true; return; }
      inFlight = true;
      try { await wire(deviceId); }
      catch (e) {
        attempt++;
        setState("reconnecting", MSG_UNREACHABLE);
        scheduleReconnect();
      } finally { inFlight = false; }
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
    try { if (doc && doc.addEventListener) doc.addEventListener("visibilitychange", onVisibility); } catch (e) { /* ignore */ }

    async function connect() {
      try {
        if (status === "connected" || inFlight) return status === "connected";
        if (deviceId !== null) return reconnectNow();
        if (!initialized) { await BleClient.initialize(); initialized = true; }
        var dev;
        try {
          var filters = { services: [profile.service] };
          dev = await BleClient.requestDevice(filters);
        } catch (e) {
          var cancelled = e && /cancel|dismiss|no device/i.test(String(e.message || e));
          setState("idle", cancelled ? "" : MSG_UNREACHABLE);
          return false;
        }
        deviceId = dev.deviceId;
        deviceName = dev.name || "";
        wantConnected = true;
        setState("connecting", "");
        inFlight = true;
        try { await wire(deviceId); return true; }
        catch (e) {
          setState("reconnecting", MSG_UNREACHABLE);
          attempt = 1;
          scheduleReconnect();
          return false;
        } finally { inFlight = false; }
      } catch (e) {
        inFlight = false;
        setState("idle", MSG_UNREACHABLE);
        return false;
      }
    }

    async function reconnectNow() {
      try {
        if (deviceId === null) return connect();
        clearTimer();
        wantConnected = true;
        attempt = 0;
        if (inFlight) return false;
        inFlight = true;
        setState("reconnecting", MSG_RECONNECTING);
        try { await wire(deviceId); return true; }
        catch (e) {
          attempt = 0;
          setState("reconnecting", MSG_UNREACHABLE);
          scheduleReconnect();
          return false;
        } finally { inFlight = false; }
      } catch (e) { inFlight = false; return false; }
    }

    function disconnect() {
      try {
        wantConnected = false;
        clearTimer();
        if (deviceId !== null) {
          var p = BleClient.disconnect(deviceId);
          if (p && p.catch) p.catch(function () {});
        }
        setState("idle", "");
      } catch (e) { /* never throw */ }
    }

    return {
      connect: connect, reconnectNow: reconnectNow, disconnect: disconnect,
      trigger: function () { return Promise.resolve(false); },   // TRIGGER_COMMAND unknown (see native/TEST-PLAN.md)
      release: function () {},                                    // no multi-tab concept natively
      snapshot: snapshot,
      transport: "native",
      _debug: function () {
        return { attempt: attempt, timerPending: timer !== null, pausedHidden: pausedHidden,
                 hasChar: subscribed, wantConnected: wantConnected };
      }
    };
  }

  // ---- selection --------------------------------------------------------------------------
  // Returns "ios-pending" | "native" | "web" | "unsupported"
  function selectTransport(env) {
    // The Capacitor wrapper is the only way an iPhone can reach the laser, so a native build with
    // the plugin present always uses it (that is how it gets tested). Safari/browser on iOS has no
    // Bluetooth at all and stays "ios-pending". iosBluetoothShipped only gates plans/billing copy.
    if (isNative(env) && env.BleClient) return "native";
    if (isIOS(env)) return "ios-pending";
    var hasWeb = Boolean(env.ApexBle && env.navigator && env.navigator.bluetooth);
    if (hasWeb) return "web";
    return "unsupported";
  }

  function createLaser(opts) {
    opts = opts || {};
    var env, kind;
    try { env = resolveEnv(opts); kind = selectTransport(env); }
    catch (e) { return createUnsupportedLaser(opts, MSG_UNSUPPORTED); }
    try {
      if (kind === "ios-pending") return createUnsupportedLaser(opts, MSG_IOS);
      if (kind === "native") return createNativeLaser(opts, env, DEVICES[DEFAULT_PROFILE]);
      if (kind === "web") {
        var laser = env.ApexBle.createLaser(opts);
        laser.transport = "web";
        return laser;
      }
    } catch (e) { /* fall through */ }
    return createUnsupportedLaser(opts, MSG_UNSUPPORTED);
  }

  return {
    DEVICES: DEVICES,
    DEFAULT_PROFILE: DEFAULT_PROFILE,
    MAX_METERS: MAX_METERS,
    BACKOFF_MS: BACKOFF_MS,
    BACKOFF_CAP_MS: BACKOFF_CAP_MS,
    MSG_IOS: MSG_IOS,
    MSG_UNSUPPORTED: MSG_UNSUPPORTED,
    SNAPSHOT_KEYS: SNAP_KEYS,
    backoffDelay: backoffDelay,
    validateMeters: validateMeters,
    decodeMeasurement: decodeMeasurement,
    isIOS: isIOS,
    selectTransport: function (opts) { return selectTransport(resolveEnv(opts || {})); },
    createLaser: createLaser
  };
});
