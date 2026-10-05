// Run: node --test   (from the project folder)
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("./transport.js");
const Ble = require("./ble.js");

const UA = {
  iosSafari: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1",
  android: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36",
  desktop: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
  firefox: "Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0"
};
const nav = (ua, extra) => Object.assign({ userAgent: ua }, extra);
const btNav = (ua) => nav(ua, { bluetooth: {} });
const cap = { isNativePlatform: () => true };
const fakeApexBle = { createLaser: (o) => ({ _web: true, snapshot: () => ({}) }) };

function dv(meters) {
  const b = new ArrayBuffer(4); new DataView(b).setFloat32(0, meters, true); return new DataView(b);
}

test("selection across environments", () => {
  const sel = (env) => T.selectTransport({ env });
  assert.equal(sel({ navigator: nav(UA.iosSafari), config: { iosBluetoothShipped: false }, ApexBle: fakeApexBle }), "ios-pending");
  assert.equal(sel({ navigator: nav(UA.iosSafari), config: { iosBluetoothShipped: false }, Capacitor: cap, BleClient: {} }), "native");   // wrapper build: testable before the flag flips
  assert.equal(sel({ navigator: nav(UA.iosSafari), config: { iosBluetoothShipped: true }, Capacitor: cap, BleClient: {} }), "native");
  assert.equal(sel({ navigator: nav(UA.iosSafari), config: { iosBluetoothShipped: true }, ApexBle: fakeApexBle }), "ios-pending");
  assert.equal(sel({ navigator: nav("Mozilla/5.0 (Macintosh)", { platform: "MacIntel", maxTouchPoints: 5 }), config: {} }), "ios-pending");
  assert.equal(sel({ navigator: btNav(UA.android), config: {}, ApexBle: fakeApexBle }), "web");
  assert.equal(sel({ navigator: btNav(UA.desktop), config: {}, ApexBle: fakeApexBle }), "web");
  assert.equal(sel({ navigator: nav(UA.firefox), config: {}, ApexBle: fakeApexBle }), "unsupported");
  assert.equal(sel({ navigator: nav(UA.android), config: {}, Capacitor: cap, BleClient: {} }), "native");
  assert.equal(sel({ navigator: nav(UA.desktop), config: {}, Capacitor: { isNativePlatform: () => false }, BleClient: {} }), "unsupported");
});

test("iOS pending laser: snapshot, connect re-announces, no BLE attempts", async () => {
  const states = []; let touched = 0;
  const BleClient = new Proxy({}, { get() { touched++; return () => {}; } });
  const l = T.createLaser({ onState: (s) => states.push(s),
    env: { navigator: nav(UA.iosSafari), config: { iosBluetoothShipped: false }, Capacitor: { isNativePlatform: () => false }, BleClient, ApexBle: fakeApexBle } });
  assert.deepEqual(l.snapshot(), { status: "unsupported", message: "iPhone laser support is under construction — type or speak measurements.", deviceName: "", canTrigger: false, channel: false });
  assert.equal(await l.connect(), false);
  assert.equal(await l.reconnectNow(), false);
  assert.equal(states.length, 2);
  assert.equal(states[0].status, "unsupported");
  assert.equal(touched, 0);
});

test("web path delegates to ApexBle; unsupported on Firefox", () => {
  const w = T.createLaser({ env: { navigator: btNav(UA.desktop), config: {}, ApexBle: fakeApexBle } });
  assert.equal(w._web, true);
  const f = T.createLaser({ env: { navigator: nav(UA.firefox), config: {}, ApexBle: fakeApexBle } });
  assert.equal(f.snapshot().status, "unsupported");
});

test("decode: 34.90625 in round trip via plugin DataView; bad values rejected", () => {
  const meters = 34.90625 * 0.0254;
  const m = T.decodeMeasurement(dv(meters));
  assert.ok(Math.abs(m / 0.0254 - 34.90625) < 1e-4);
  assert.equal(T.decodeMeasurement(dv(NaN)), null);
  assert.equal(T.decodeMeasurement(dv(Infinity)), null);
  assert.equal(T.decodeMeasurement(dv(-0.5)), null);
  assert.equal(T.decodeMeasurement(dv(200.5)), null);
  assert.equal(T.decodeMeasurement(dv(200)), 200);
  assert.equal(T.decodeMeasurement(new DataView(new ArrayBuffer(2))), null);
  assert.equal(T.decodeMeasurement(null), null);
  assert.equal(T.decodeMeasurement(dv(1.5), { decode: () => { throw new Error("x"); } }), null);
});

test("backoff matches ble.js and caps at 60s", () => {
  for (let i = 0; i < 12; i++) assert.equal(T.backoffDelay(i), Ble.backoffDelay(i));
  assert.equal(T.backoffDelay(50), 60000);
});

function fakeClient() {
  const c = { calls: [], failConnect: 0, cb: null, notif: null, ids: 0 };
  c.initialize = async () => { c.calls.push("init"); };
  c.requestDevice = async (o) => { c.calls.push("request"); c.reqOpts = o; return { deviceId: "D1", name: "DISTO D2 1234" }; };
  c.connect = async (id, onDis) => { c.calls.push("connect"); if (c.failConnect > 0) { c.failConnect--; throw new Error("nope"); } c.cb = onDis; };
  c.startNotifications = async (id, s, ch, cb) => { c.calls.push("sub"); c.sv = [s, ch]; c.notif = cb; };
  c.disconnect = async (id) => { c.calls.push("disconnect"); };
  return c;
}
function harness(extra) {
  const client = fakeClient(), states = [], readings = [], timers = []; let now = 0;
  const doc = { hidden: false, handlers: {}, addEventListener(t, f) { this.handlers[t] = f; } };
  const laser = T.createLaser({
    onReading: (m) => readings.push(m), onState: (s) => states.push(s.status),
    setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; },
    clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].dead = true; },
    env: Object.assign({ navigator: nav(UA.android), config: {}, Capacitor: cap, BleClient: client, doc }, extra)
  });
  const live = () => timers.filter((t) => !t.dead && !t.fired);
  const fire = async () => { const t = live().pop(); t.fired = true; await t.f(); return t.ms; };
  return { client, states, readings, laser, doc, live, fire };
}
const tick = () => new Promise((r) => setImmediate(r));

test("native: connect, notifications decode to meters, bad values dropped", async () => {
  const h = harness();
  assert.equal(await h.laser.connect(), true);
  assert.deepEqual(h.client.reqOpts, { services: [T.DEVICES["leica-disto-ble"].service] });
  assert.deepEqual(h.client.sv, [T.DEVICES["leica-disto-ble"].service, T.DEVICES["leica-disto-ble"].measurement]);
  assert.equal(h.laser.snapshot().deviceName, "DISTO D2 1234");
  h.client.notif(dv(0.886637)); h.client.notif(dv(NaN)); h.client.notif(dv(-1)); h.client.notif(dv(999));
  assert.equal(h.readings.length, 1);
  assert.deepEqual(h.states, ["connecting", "connected"]);
});

test("native: disconnect -> reconnecting -> re-subscribe -> connected; backoff grows then caps", async () => {
  const h = harness();
  await h.laser.connect();
  h.client.cb("D1");
  assert.equal(h.laser.snapshot().status, "reconnecting");
  h.client.failConnect = 7;
  const delays = [];
  for (let i = 0; i < 8; i++) { delays.push(await h.fire()); await tick(); }
  assert.deepEqual(delays.slice(0, 7), [1000, 2000, 5000, 15000, 30000, 60000, 60000]);
  // 8th attempt succeeded: re-subscribed
  assert.equal(h.laser.snapshot().status, "connected");
  assert.equal(h.client.calls.filter((c) => c === "sub").length, 2);
  assert.equal(h.laser._debug().attempt, 0);
  h.client.notif(dv(1)); assert.equal(h.readings.length, 1);
});

test("native: paused while hidden, resumes on visible; reconnectNow; explicit disconnect", async () => {
  const h = harness();
  await h.laser.connect();
  h.doc.hidden = true;
  h.client.cb("D1");
  assert.equal(h.live().length, 0);
  assert.equal(h.laser._debug().pausedHidden, true);
  h.doc.hidden = false; h.doc.handlers.visibilitychange(); await tick();
  assert.equal(h.laser.snapshot().status, "connected");
  h.client.cb("D1");
  assert.equal(await h.laser.reconnectNow(), true);
  h.laser.disconnect(); h.client.cb("D1");
  assert.equal(h.laser.snapshot().status, "idle");
  assert.equal(h.live().length, 0);
});

test("native: picker cancel is quiet idle; init failure never throws", async () => {
  const h = harness();
  h.client.requestDevice = async () => { throw new Error("User cancelled"); };
  assert.equal(await h.laser.connect(), false);
  assert.equal(h.laser.snapshot().message, "");
  const h2 = harness();
  h2.client.initialize = async () => { throw new Error("bt off"); };
  assert.equal(await h2.laser.connect(), false);
  assert.equal(h2.laser.snapshot().status, "idle");
});

test("snapshot shape equals ble.js snapshot keys", () => {
  const bleKeys = Object.keys(Ble.createLaser({ bluetooth: null, doc: null, BroadcastChannel: null }).snapshot()).sort();
  const nativeKeys = Object.keys(harness().laser.snapshot()).sort();
  const iosKeys = Object.keys(T.createLaser({ env: { navigator: nav(UA.iosSafari), config: {} } }).snapshot()).sort();
  assert.deepEqual(nativeKeys, bleKeys);
  assert.deepEqual(iosKeys, bleKeys);
  assert.deepEqual(T.SNAPSHOT_KEYS.slice().sort(), bleKeys);
});
