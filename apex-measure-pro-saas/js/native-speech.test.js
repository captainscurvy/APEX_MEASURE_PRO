"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const NS = require("./native-speech.js");

function run(plugin) {
  const SR = NS.createClass(plugin), r = new SR(), ev = [];
  r.onstart = () => ev.push("start");
  r.onresult = (e) => ev.push(["result", Array.from(e.results[0]).map((a) => a.transcript), e.results[0].isFinal]);
  r.onerror = (e) => ev.push(["error", e.error]);
  r.onend = () => ev.push("end");
  r.start();
  return new Promise((res) => setTimeout(() => res(ev), 10));
}

test("final result delivers alternatives then ends", async () => {
  const ev = await run({ requestPermissions: async () => ({ speechRecognition: "granted" }),
    start: async () => ({ matches: ["thirty four and a half", "thirty four and a half inches"] }), stop: async () => {} });
  assert.deepEqual(ev, ["start", ["result", ["thirty four and a half", "thirty four and a half inches"], true], "end"]);
});
test("permission denied maps to not-allowed", async () => {
  const ev = await run({ requestPermissions: async () => ({ speechRecognition: "denied" }), start: async () => ({}), stop: async () => {} });
  assert.deepEqual(ev, [["error", "not-allowed"], "end"]);
});
test("empty result maps to no-speech; abort silences callbacks", async () => {
  const ev = await run({ requestPermissions: async () => ({ speechRecognition: "granted" }), start: async () => ({ matches: [] }), stop: async () => {} });
  assert.deepEqual(ev, ["start", ["error", "no-speech"], "end"]);
  const SR = NS.createClass({ requestPermissions: async () => ({}), start: () => new Promise(() => {}), stop: async () => {} });
  const r = new SR(), got = []; r.onerror = r.onend = r.onresult = () => got.push(1);
  r.start(); r.abort();
  await new Promise((x) => setTimeout(x, 10));
  assert.equal(got.length, 0);
});
