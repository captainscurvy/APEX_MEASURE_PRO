"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const NB = require("./native-bridge.js");

test("hexToDataView decodes a float32LE meter reading", () => {
  const dv = NB.hexToDataView("0000a040");              // 5.0 m
  assert.equal(dv.getFloat32(0, true), 5);
  assert.equal(NB.hexToDataView("").byteLength, 0);
});

test("BleClient maps to the raw plugin calls and event keys", async () => {
  const calls = [], handlers = {};
  const plugin = {
    addListener: (k, fn) => { handlers[k] = fn; return Promise.resolve({ remove() { delete handlers[k]; } }); },
    initialize: async (o) => calls.push(["init", o]),
    requestDevice: async () => ({ deviceId: "D1", name: "DISTO D2" }),
    connect: async (o) => calls.push(["connect", o]),
    disconnect: async (o) => calls.push(["disconnect", o]),
    startNotifications: async (o) => calls.push(["notify", o])
  };
  const c = NB.createBleClient(plugin);
  await c.initialize();
  assert.equal((await c.requestDevice({})).deviceId, "D1");
  let dropped = null;
  await c.connect("D1", (id) => { dropped = id; });
  handlers["disconnected|D1"]();
  assert.equal(dropped, "D1");
  let got = null;
  await c.startNotifications("D1", "svc", "chr", (dv) => { got = dv.getFloat32(0, true); });
  handlers["notification|D1|svc|chr"]({ value: "0000a040" });
  assert.equal(got, 5);
  await c.disconnect("D1");
  assert.equal(handlers["disconnected|D1"], undefined);
  assert.deepEqual(calls.map((x) => x[0]), ["init", "connect", "notify", "disconnect"]);
});
