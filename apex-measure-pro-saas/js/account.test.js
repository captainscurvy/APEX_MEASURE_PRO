"use strict";
var test = require("node:test");
var assert = require("node:assert");
var A = require("./account.js");
var DAY = 86400000, NOW = Date.parse("2026-10-05T12:00:00Z");

function base(o) { var b = { demo: false, signedIn: true, email: "a@b.co", now: NOW, graceDays: 5 }; for (var k in o) b[k] = o[k]; return b; }
var ACTIVE = { plan: "laser", status: "active", currentPeriodEnd: "2026-11-01T00:00:00Z" };

test("demo and signed-out", function () {
  assert.equal(A.derive({ demo: true }).status, "demo");
  assert.equal(A.derive(base({ signedIn: false })).status, "signed-out");
  assert.equal(A.derive(base({ error: "unauthorized" })).status, "signed-out");
});

test("fresh entitlement: ok / trialing / locked", function () {
  var s = A.derive(base({ entitlement: ACTIVE }));
  assert.equal(s.status, "ok"); assert.equal(s.plan, "laser");
  assert.equal(A.derive(base({ entitlement: { plan: "manual", status: "trialing" } })).status, "ok");
  var l = A.derive(base({ entitlement: { plan: "none", status: "none" } }));
  assert.equal(l.status, "locked"); assert.equal(l.plan, "");
  assert.equal(A.derive(base({ entitlement: { plan: "manual", status: "canceled", currentPeriodEnd: "2026-10-01T00:00:00Z" } })).status, "locked");
  assert.equal(A.derive(base({ entitlement: { plan: "manual", status: "canceled", currentPeriodEnd: "2026-10-20T00:00:00Z" } })).status, "ok");
});

test("past_due gets a grace window from period end", function () {
  var e = { plan: "manual", status: "past_due", currentPeriodEnd: new Date(NOW - 2 * DAY).toISOString() };
  assert.equal(A.derive(base({ entitlement: e })).status, "grace");
  e.currentPeriodEnd = new Date(NOW - 6 * DAY).toISOString();
  assert.equal(A.derive(base({ entitlement: e })).status, "locked");
});

test("offline grace window math", function () {
  function cache(ageDays, ent) { return { email: "A@B.co", entitlement: ent || ACTIVE, checkedAt: NOW - ageDays * DAY }; }
  var in4 = A.derive(base({ error: "offline", cache: cache(4) }));
  assert.equal(in4.status, "grace"); assert.equal(in4.graceUntil, NOW + 1 * DAY); assert.equal(in4.plan, "laser");
  assert.equal(A.derive(base({ error: "offline", cache: cache(5) })).status, "grace");
  var out = A.derive(base({ error: "offline", cache: cache(5.01) }));
  assert.equal(out.status, "locked"); assert.equal(out.reason, "grace-expired");
  assert.equal(A.derive(base({ error: "offline" })).reason, "needs-online");
  assert.equal(A.derive(base({ error: "offline", cache: cache(1, { plan: "none", status: "none" }) })).status, "locked");
  assert.equal(A.derive(base({ error: "offline", cache: { email: "other@x.co", entitlement: ACTIVE, checkedAt: NOW } })).status, "locked");
});

test("pending check: optimistic from cache, else checking", function () {
  assert.equal(A.derive(base({})).status, "checking");
  var s = A.derive(base({ cache: { email: "a@b.co", entitlement: ACTIVE, checkedAt: NOW - DAY } }));
  assert.equal(s.status, "ok"); assert.equal(s.fromCache, true);
});

test("checkoutUrl", function () {
  assert.equal(A.checkoutUrl("", "a@b.co"), "");
  assert.equal(A.checkoutUrl("https://buy.stripe.com/x", "a+1@b.co"), "https://buy.stripe.com/x?prefilled_email=a%2B1%40b.co");
  assert.equal(A.checkoutUrl("https://x/y?a=1", "a@b.co"), "https://x/y?a=1&prefilled_email=a%40b.co");
  assert.equal(A.checkoutUrl("https://x/y", ""), "https://x/y");
});
