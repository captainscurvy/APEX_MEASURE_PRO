/*
 * config.js — the ONE place business settings live. Nothing here is secret
 * (the Supabase "anon" key is designed to be public; the Stripe secret key and
 * the service-role key NEVER go in this file — they live only in the server
 * functions). Every value marked TODO is something Apex must fill in before
 * shipping; the app runs without them in DEMO MODE (see ApexConfig.demo).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ApexConfig = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var cfg = {
    VERSION: "2.0.0-saas.1",

    company: {
      appUrl: "https://app.apexinstallationsok.com",
      legalName: "Apex Installations LLC",
      state: "Oklahoma",
      supportEmail: "apexinstallationsok@gmail.com",
      site: "https://apexinstallationsok.com"
    },

    // TODO(Supabase): project URL + public anon key. Empty → DEMO MODE (local-only,
    // everything unlocked, sharing screens show "connect a server").
    backend: { url: "", anonKey: "" },

    // TODO(Stripe): Payment Link URLs per plan (create in the Stripe dashboard) and the
    // Customer Portal link (this is the working "cancel anytime" button).
    billing: {
      paymentLinks: { manual: "", laser: "", crew: "https://buy.stripe.com/28E9AL9n3bkT3hR9aHcAo03" },
      portalUrl: "",
      trialDays: 14
    },

    // PRICING IS A HYPOTHESIS, not a decision. Anchored to comparable per-seat field tools
    // (magicplan $10–90, Fieldwire $39–89, Jobber from $39). Edit here; the UI reads it.
    // cents per seat per month. `minSeats` applies to the crew plan.
    plans: {
      manual: { id: "manual", name: "Manual", priceCents: 1500, seats: 1,
        tagline: "Type or speak measurements. Sheets, photos, voice.",
        features: ["manual", "voice", "photos", "export"] },
      laser: { id: "laser", name: "Laser", priceCents: 2900, seats: 1,
        tagline: "Everything in Manual, plus Bluetooth laser capture.",
        features: ["manual", "voice", "photos", "export", "laser"] },
      crew: { id: "crew", name: "Crew", priceCents: 3900, seats: 2, minSeats: 2,
        tagline: "Laser + shared jobs for your whole crew. Office viewers are free.",
        features: ["manual", "voice", "photos", "export", "laser", "team"] }
    },
    planOrder: ["manual", "laser", "crew"],

    // iPhone/iPad cannot reach the laser from a browser, and the native iPhone Bluetooth
    // layer is not shipped yet. While false: iOS users are told BEFORE signup, and on iOS the
    // Laser plan is billed at the Manual price (Laser features simply don't apply there).
    iosBluetoothShipped: false,

    // Entitlement is cached so the app works with no signal. After this many days offline
    // since the last successful check, the app locks (read-only access to existing jobs stays).
    offlineGraceDays: 5,

    // Order-ready supplier output — intentionally NOT built yet (waiting on supplier talks).
    orderReadyEnabled: false,

    legal: { termsVersion: "2026-10-draft", privacyVersion: "2026-10-draft" }
  };

  // Demo mode = no backend configured. The app is fully usable locally.
  Object.defineProperty(cfg, "demo", { get: function () { return !cfg.backend.url || !cfg.backend.anonKey; } });

  cfg.planFeatures = function (planId) {
    var p = cfg.plans[planId];
    return p ? p.features.slice() : [];
  };

  return cfg;
});
