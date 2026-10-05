"use strict";
var test = require("node:test");
var assert = require("node:assert");
var cfg = require("./config.js");
var P = require("./plans.js");

var IOS = { ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari", platform: "iPhone", maxTouchPoints: 5, bluetooth: false };
var IPADOS = { ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X) Safari", platform: "MacIntel", maxTouchPoints: 5, bluetooth: false };
var ANDROID = { ua: "Mozilla/5.0 (Linux; Android 14) Chrome/120", platform: "Linux armv8l", maxTouchPoints: 5, bluetooth: true };
var DESKTOP = { ua: "Mozilla/5.0 (Windows NT 10.0) Chrome/120", platform: "Win32", maxTouchPoints: 0, bluetooth: true };

test("platform detection", function () {
  assert.equal(P.platform(IOS).ios, true);
  assert.equal(P.platform(IPADOS).ios, true);
  assert.equal(P.platform(ANDROID).android, true);
  assert.equal(P.platform(DESKTOP).desktop, true);
  assert.equal(P.platform(DESKTOP).webBluetooth, true);
});

test("iOS: laser unavailable, under construction", function () {
  var r = P.laserAvailable(P.platform(IOS));
  assert.equal(r.ok, false);
  assert.equal(r.reason, "ios-under-construction");
});

test("Android / desktop Chrome: laser ok; no Web Bluetooth elsewhere", function () {
  assert.equal(P.laserAvailable(P.platform(ANDROID)).ok, true);
  assert.equal(P.laserAvailable(P.platform(DESKTOP)).ok, true);
  var ff = P.platform({ ua: "Firefox Windows", platform: "Win32", bluetooth: false });
  assert.deepEqual(P.laserAvailable(ff), { ok: false, reason: "no-web-bluetooth" });
});

test("iOS laser plan billed at manual price with note; others full price", function () {
  var ios = P.platform(IOS), and = P.platform(ANDROID);
  var l = P.priceFor("laser", ios);
  assert.equal(l.cents, cfg.plans.manual.priceCents);
  assert.ok(l.note.length > 10);
  assert.equal(P.priceFor("laser", and).cents, cfg.plans.laser.priceCents);
  assert.equal(P.priceFor("laser", and).note, "");
  assert.equal(P.priceFor("manual", ios).cents, cfg.plans.manual.priceCents);
  assert.equal(P.priceFor("crew", and).cents, cfg.plans.crew.priceCents);
});

test("iOS pricing reverts once Bluetooth ships", function () {
  cfg.iosBluetoothShipped = true;
  try {
    assert.equal(P.priceFor("laser", P.platform(IOS)).cents, cfg.plans.laser.priceCents);
    assert.equal(P.laserAvailable(P.platform(IOS)).reason, "no-web-bluetooth");
    assert.equal(P.laserAvailable({ ios: true, native: true }).ok, true);
  } finally { cfg.iosBluetoothShipped = false; }
});

test("demo mode unlocks everything except platform-impossible laser", function () {
  var demo = { status: "demo" };
  var and = P.platform(ANDROID), ios = P.platform(IOS);
  P.FEATURES.forEach(function (f) { assert.equal(P.has(f, demo, and), true, f); });
  P.FEATURES.forEach(function (f) { assert.equal(P.has(f, demo, ios), f !== "laser", f); });
});

test("feature matrix per plan", function () {
  var and = P.platform(ANDROID);
  function st(plan, status) { return { status: status || "ok", plan: plan }; }
  assert.equal(P.has("manual", st("manual"), and), true);
  assert.equal(P.has("laser", st("manual"), and), false);
  assert.equal(P.has("team", st("laser"), and), false);
  assert.equal(P.has("laser", st("laser"), and), true);
  assert.equal(P.has("team", st("crew"), and), true);
  assert.equal(P.has("laser", st("crew", "grace"), and), true);
  assert.equal(P.has("laser", st("laser"), P.platform(IOS)), false);
  assert.equal(P.has("manual", st("manual", "locked"), and), false);
  assert.equal(P.has("manual", { status: "signed-out" }, and), false);
  assert.equal(P.has("bogus", { status: "demo" }, and), false);
});

test("describePlans", function () {
  var d = P.describePlans(P.platform(IOS));
  assert.deepEqual(d.map(function (x) { return x.id; }), ["manual", "laser", "crew"]);
  assert.equal(d[1].cents, 1500);
  assert.equal(d[1].discounted, true);
  assert.equal(d[1].laser.reason, "ios-under-construction");
  assert.equal(d[0].laser, null);
  var a = P.describePlans(P.platform(ANDROID));
  assert.equal(a[1].priceLabel, "$29 / seat / month");
  assert.equal(a[1].laser.ok, true);
});
