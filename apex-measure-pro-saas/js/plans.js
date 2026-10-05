/*
 * plans.js — pure plan / platform / feature logic (UMD). No DOM, no network.
 * Entitlement is decided by the server; this file only maps (state, platform) -> UI answers.
 */
(function (root, factory) {
  var cfg = root.ApexConfig;
  if (!cfg && typeof require === "function") { try { cfg = require("./config.js"); } catch (e) { cfg = null; } }
  var api = factory(root, cfg);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ApexPlans = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root, cfg) {
  "use strict";

  var FEATURES = ["manual", "voice", "photos", "export", "laser", "team"];

  function C() { return cfg || root.ApexConfig || { plans: {}, planOrder: [], demo: true, iosBluetoothShipped: false, planFeatures: function () { return []; } }; }

  // env (optional, for tests): { ua, platform, maxTouchPoints, bluetooth:boolean, native:boolean }
  function platform(env) {
    var nav = (typeof navigator !== "undefined" && navigator) || {};
    env = env || {};
    var ua = String(env.ua !== undefined ? env.ua : (nav.userAgent || ""));
    var plat = String(env.platform !== undefined ? env.platform : (nav.platform || ""));
    var touch = env.maxTouchPoints !== undefined ? env.maxTouchPoints : (nav.maxTouchPoints || 0);
    var ios = /iPad|iPhone|iPod/.test(ua) || (plat === "MacIntel" && touch > 1);
    var android = !ios && /Android/i.test(ua);
    var bt = env.bluetooth !== undefined ? !!env.bluetooth : !!nav.bluetooth;
    var native = env.native !== undefined ? !!env.native : !!(root.Capacitor && root.Capacitor.isNativePlatform && root.Capacitor.isNativePlatform());
    return { ios: ios, android: android, desktop: !ios && !android, webBluetooth: bt, native: native };
  }

  function laserAvailable(p) {
    p = p || platform();
    if (p.native) return { ok: true, reason: "" };
    if (p.ios && !C().iosBluetoothShipped) return { ok: false, reason: "ios-under-construction" };
    if (!p.webBluetooth) return { ok: false, reason: "no-web-bluetooth" };
    return { ok: true, reason: "" };
  }

  function entitled(state) {
    if (!state) return false;
    return state.status === "ok" || state.status === "grace";
  }

  function has(feature, state, p) {
    if (FEATURES.indexOf(feature) < 0) return false;
    if (!state) {
      var acct = root.ApexAccount;
      state = acct && acct.state ? acct.state() : { status: C().demo ? "demo" : "signed-out" };
    }
    p = p || platform();
    if (feature === "laser" && !laserAvailable(p).ok) return false;
    if (state.status === "demo") return true;
    if (!entitled(state)) return false;
    return C().planFeatures(state.plan).indexOf(feature) >= 0;
  }

  function priceFor(planId, p) {
    var plan = C().plans[planId];
    if (!plan) return { cents: 0, note: "" };
    p = p || platform();
    if (planId === "laser" && p.ios && !C().iosBluetoothShipped) {
      return {
        cents: C().plans.manual.priceCents,
        note: "iPhone/iPad laser (Bluetooth) support is under construction, so Laser is billed at the Manual price on iPhone and iPad."
      };
    }
    return { cents: plan.priceCents, note: "" };
  }

  function money(cents) {
    var d = cents / 100;
    return "$" + (cents % 100 === 0 ? String(d) : d.toFixed(2));
  }

  function describePlans(p) {
    p = p || platform();
    var laser = laserAvailable(p);
    var c = C();
    return (c.planOrder || Object.keys(c.plans)).map(function (id) {
      var plan = c.plans[id];
      var price = priceFor(id, p);
      var feats = plan.features.slice();
      var laserBlocked = feats.indexOf("laser") >= 0 && !laser.ok;
      return {
        id: id, name: plan.name, tagline: plan.tagline,
        cents: price.cents, priceLabel: money(price.cents) + " / seat / month",
        note: price.note, seats: plan.seats, minSeats: plan.minSeats || 1,
        features: feats, laser: laserBlocked ? { ok: false, reason: laser.reason } : (feats.indexOf("laser") >= 0 ? laser : null),
        discounted: price.cents !== plan.priceCents
      };
    });
  }

  return { FEATURES: FEATURES, platform: platform, has: has, laserAvailable: laserAvailable, priceFor: priceFor, describePlans: describePlans, money: money };
});
