/*
 * account.js — account state machine, gate, and account/plan/sign-in screens.
 *   Pure part (UMD, node-testable):  derive(), checkoutUrl(), isEntitled()
 *   Runtime part (browser only):     state(), refresh(), signOut(), onChange(), gate, routes, blocks
 * The SERVER decides entitlement. The client only caches the last answer so the app works offline
 * for ApexConfig.offlineGraceDays. A locked account NEVER deletes or hides local data.
 */
(function (root, factory) {
  var cfg = root.ApexConfig;
  if (!cfg && typeof require === "function") { try { cfg = require("./config.js"); } catch (e) { cfg = null; } }
  var api = factory(root, cfg);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ApexAccount = api;
  if (typeof window !== "undefined" && window.document && api._runtime) api._runtime();
})(typeof globalThis !== "undefined" ? globalThis : this, function (root, cfg) {
  "use strict";

  var DAY = 86400000;
  var CACHE_KEY = "apex-entitlement-cache";

  // ---------- pure ----------

  function ts(v) { var t = v ? Date.parse(v) : NaN; return isNaN(t) ? null : t; }
  function sameEmail(a, b) { return String(a || "").toLowerCase() === String(b || "").toLowerCase(); }

  // Has paid access right now (trialing/active, or canceled but period not yet over).
  function isEntitled(ent, now) {
    if (!ent || !ent.plan || ent.plan === "none") return false;
    if (ent.status === "trialing" || ent.status === "active") return true;
    if (ent.status === "canceled") { var end = ts(ent.currentPeriodEnd); return end !== null && end > now; }
    return false;
  }
  function isPastDue(ent) { return !!ent && !!ent.plan && ent.plan !== "none" && ent.status === "past_due"; }

  /*
   * input: { demo, signedIn, email, entitlement, error, cache:{email,entitlement,checkedAt}, now, graceDays }
   *   entitlement = fresh server answer; error = error code string when the check failed; neither = still checking.
   */
  function derive(input) {
    input = input || {};
    var now = input.now !== undefined ? input.now : Date.now();
    var days = input.graceDays !== undefined ? input.graceDays : ((cfg && cfg.offlineGraceDays) || 0);
    var out = { status: "", email: input.email || "", plan: "", entitlement: null, graceUntil: null, reason: "", fromCache: false };
    if (input.demo) { out.status = "demo"; return out; }
    if (!input.signedIn) { out.status = "signed-out"; out.email = ""; return out; }
    if (input.error === "unauthorized") { out.status = "signed-out"; out.reason = "session-expired"; return out; }

    var ent = input.entitlement || null;
    if (ent && !input.error) {
      out.entitlement = ent; out.plan = ent.plan || "";
      if (isEntitled(ent, now)) { out.status = "ok"; return out; }
      if (isPastDue(ent)) {
        out.graceUntil = (ts(ent.currentPeriodEnd) || now) + days * DAY;
        out.status = now <= out.graceUntil ? "grace" : "locked";
        out.reason = out.status === "grace" ? "past-due" : "payment-failed";
        return out;
      }
      out.status = "locked"; out.plan = ""; out.reason = "no-subscription";
      return out;
    }

    // No fresh answer: fall back to the cached one, if it is for this account and inside the grace window.
    var c = input.cache;
    var ok = c && c.entitlement && typeof c.checkedAt === "number" && c.checkedAt <= now + 60000 && c.email && sameEmail(c.email, input.email);
    if (!ok) {
      if (input.error) { out.status = "locked"; out.reason = "needs-online"; } else out.status = "checking";
      return out;
    }
    out.entitlement = c.entitlement; out.plan = c.entitlement.plan || ""; out.fromCache = true;
    out.graceUntil = c.checkedAt + days * DAY;
    if (now > out.graceUntil) { out.status = "locked"; out.reason = "grace-expired"; out.plan = ""; return out; }
    if (!isEntitled(c.entitlement, now) && !isPastDue(c.entitlement)) { out.status = "locked"; out.reason = "no-subscription"; out.plan = ""; return out; }
    out.status = input.error ? "grace" : "ok";
    if (input.error) out.reason = "offline";
    return out;
  }

  // orgId (optional) becomes Stripe's client_reference_id so the webhook can attach the
  // subscription to the right organization; without it the webhook matches by owner email.
  function checkoutUrl(link, email, orgId) {
    if (!link) return "";
    var q = [];
    if (email) q.push("prefilled_email=" + encodeURIComponent(email));
    if (orgId) q.push("client_reference_id=" + encodeURIComponent(orgId));
    if (!q.length) return link;
    return link + (link.indexOf("?") >= 0 ? "&" : "?") + q.join("&");
  }

  var api = { derive: derive, checkoutUrl: checkoutUrl, isEntitled: isEntitled, CACHE_KEY: CACHE_KEY };

  // ---------- runtime ----------

  api._runtime = function () {
    var X = root.ApexExt;
    if (!X) return;
    var CFG = root.ApexConfig;
    var listeners = [];
    var inputs = { signedIn: false, email: "", entitlement: null, error: null, cache: null };
    var cur = derive({ demo: !backend(), signedIn: false });
    var readyDone = false;
    var readyP;

    function lsGet(k) { try { return root.localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { root.localStorage.setItem(k, v); } catch (e) {} }
    function lsDel(k) { try { root.localStorage.removeItem(k); } catch (e) {} }
    function readCache() { try { var c = JSON.parse(lsGet(CACHE_KEY)); return c && typeof c === "object" ? c : null; } catch (e) { return null; } }
    function backend() { var B = root.ApexBackend; return B && B.configured && B.configured() ? B : null; }

    function recompute() {
      var prev = cur.status + "|" + cur.plan + "|" + cur.email;
      cur = derive({ demo: !backend(), signedIn: inputs.signedIn, email: inputs.email, entitlement: inputs.entitlement,
        error: inputs.error, cache: inputs.cache || readCache(), now: Date.now(), graceDays: CFG.offlineGraceDays });
      if (prev !== cur.status + "|" + cur.plan + "|" + cur.email) {
        listeners.slice().forEach(function (fn) { try { fn(cur); } catch (e) {} });
      }
    }

    function state() { return JSON.parse(JSON.stringify(cur)); }
    function onChange(fn) { listeners.push(fn); return function () { var i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; }

    function getSession() {
      var B = backend();
      if (!B || !B.session) return Promise.resolve(null);
      try { return Promise.resolve(B.session()).catch(function () { return null; }); } catch (e) { return Promise.resolve(null); }
    }

    function refresh() {
      var B = backend();
      if (!B) { recompute(); return Promise.resolve(state()); }
      return getSession().then(function (sess) {
        inputs.signedIn = !!(sess && (sess.email || sess.userId));
        inputs.email = sess && sess.email || "";
        inputs.cache = readCache();
        if (!inputs.signedIn) { inputs.entitlement = null; inputs.error = null; recompute(); return state(); }
        inputs.entitlement = null; inputs.error = null;
        recompute();   // optimistic from cache while we ask the server
        return Promise.resolve().then(function () { return B.getEntitlement(); }).then(function (ent) {
          inputs.entitlement = ent || { plan: "none", status: "none" };
          inputs.error = null;
          lsSet(CACHE_KEY, JSON.stringify({ email: inputs.email, entitlement: inputs.entitlement, checkedAt: Date.now() }));
          inputs.cache = readCache();
          recompute();
          return state();
        }, function (err) {
          inputs.entitlement = null;
          inputs.error = (err && err.code) || "offline";
          recompute();
          return state();
        });
      }).catch(function () { recompute(); return state(); });
    }

    function signOut() {
      var B = backend();
      var p = B && B.signOut ? Promise.resolve().then(function () { return B.signOut(); }).catch(function () {}) : Promise.resolve();
      return p.then(function () {
        lsDel(CACHE_KEY);
        inputs = { signedIn: false, email: "", entitlement: null, error: null, cache: null };
        recompute();
        return state();
      });
    }

    api.state = state; api.refresh = refresh; api.signOut = signOut; api.onChange = onChange;
    api.ready = function () { return readyP; };

    // ----- tiny helpers -----
    function planName(id) { var p = CFG.plans[id]; return p ? p.name : (id || "None"); }
    function fmtDate(t) {
      if (!t) return "";
      try { return new Date(t).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); } catch (e) { return ""; }
    }
    function errText(err) {
      var c = err && err.code;
      if (c === "offline") return "No connection. Check your signal and try again.";
      if (c === "not-configured") return "Accounts are not set up yet.";
      if (c === "unauthorized") return "That code didn't work. Check it and try again, or request a new one.";
      return (err && err.message) || "Something went wrong. Try again.";
    }
    var SUPPORT = (CFG.company && CFG.company.supportEmail) || "";

    function iosNotice(h) {
      var P = root.ApexPlans;
      if (!P || !P.platform().ios) return null;
      return h("div", { class: "banner acct-ios", role: "note" },
        h("div", null,
          h("strong", { text: "iPhone and iPad: laser support is under construction." }),
          h("p", { class: "small", text: "Bluetooth laser capture is not available on iPhone or iPad yet. Manual entry, voice, photos and sheets all work fully. Laser-tier pricing is adjusted for iPhone and iPad: you pay the Manual price until laser support ships." })));
    }

    function manageBlock(h) {
      var url = CFG.billing && CFG.billing.portalUrl;
      if (url) {
        return h("a", { class: "btn btn-block", href: url, target: "_blank", rel: "noopener noreferrer", text: "Manage or cancel subscription" });
      }
      return h("p", { class: "muted small acct-note", role: "note" },
        "Billing portal not configured yet. To change or cancel your subscription, email ",
        h("a", { href: "mailto:" + SUPPORT + "?subject=" + encodeURIComponent("Subscription change"), text: SUPPORT }), ".");
    }

    function legalLinks(h) {
      return h("p", { class: "small muted acct-legal" },
        h("a", { href: "#/terms", text: "Terms of Service" }), " · ", h("a", { href: "#/privacy", text: "Privacy Policy" }));
    }

    // ----- sign-in -----
    function signInScreen(ctx) {
      var h = ctx.h;
      var step = "email", email = "";
      var box = h("div", { class: "stack acct" });
      var accept = null;
      if (root.ApexLegal && root.ApexLegal.requireAcceptance) {
        try { accept = root.ApexLegal.requireAcceptance(ctx, function () { draw(); }); } catch (e) { accept = null; }
      }
      var msg = "";
      var busy = false;

      function draw() {
        box.innerHTML = "";
        box.appendChild(h("h2", { class: "acct-title", text: "Sign in to Apex Measure Pro" }));
        var ion = iosNotice(h); if (ion) box.appendChild(ion);
        if (!backend()) {
          box.appendChild(h("p", { text: "Demo mode: no account is needed and everything is unlocked on this device." }));
          return;
        }
        var trial = CFG.billing && CFG.billing.trialDays;
        box.appendChild(h("p", { class: "muted", text: "We email you a one-time code. No password." + (trial ? " Every plan starts with a " + trial + "-day free trial." : "") }));
        if (step === "email") {
          var inp = h("input", { class: "input", type: "email", id: "acct-email", autocomplete: "email", inputmode: "email", placeholder: "you@example.com", value: email, "aria-label": "Email address" });
          inp.addEventListener("input", function () { email = inp.value.trim(); });
          box.appendChild(h("div", { class: "field" }, h("label", { class: "label", for: "acct-email", text: "Email" }), inp));
          if (accept) box.appendChild(accept.node);
          else box.appendChild(legalLinks(h));
          box.appendChild(h("button", { class: "btn btn-primary btn-block", type: "button", disabled: busy ? true : null, text: busy ? "Sending…" : "Email me a code", onclick: function () {
            email = inp.value.trim();
            if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { msg = "Enter a valid email address."; draw(); return; }
            if (accept && !accept.accepted()) { msg = "Please accept the Terms and Privacy Policy to continue."; draw(); return; }
            busy = true; msg = ""; draw();
            Promise.resolve().then(function () { return root.ApexBackend.signInWithEmail(email); }).then(function () {
              if (accept && accept.record) accept.record();
              busy = false; step = "code"; msg = "Code sent to " + email + "."; draw();
            }, function (err) { busy = false; msg = errText(err); draw(); });
          } }));
        } else {
          var code = h("input", { class: "input acct-code", type: "text", id: "acct-code", inputmode: "numeric", autocomplete: "one-time-code", maxlength: "10", "aria-label": "One-time code" });
          box.appendChild(h("div", { class: "field" }, h("label", { class: "label", for: "acct-code", text: "Code from your email" }), code));
          box.appendChild(h("button", { class: "btn btn-primary btn-block", type: "button", disabled: busy ? true : null, text: busy ? "Checking…" : "Sign in", onclick: function () {
            var v = code.value.trim();
            if (!v) { msg = "Enter the code from your email."; draw(); return; }
            busy = true; msg = ""; draw();
            Promise.resolve().then(function () { return root.ApexBackend.verifyCode(email, v); })
              .then(function () {
                // Server-side consent record (best effort; the local record is already stored).
                var L = CFG.legal || {};
                try { var p = root.ApexBackend.recordConsent && root.ApexBackend.recordConsent(L.termsVersion, L.privacyVersion); if (p && p.catch) p.catch(function () {}); } catch (e) {}
              })
              .then(function () { return refresh(); })
              .then(function () { busy = false; ctx.go("#/"); }, function (err) { busy = false; msg = errText(err); draw(); });
          } }));
          box.appendChild(h("button", { class: "btn btn-ghost btn-block", type: "button", text: "Use a different email", onclick: function () { step = "email"; msg = ""; draw(); } }));
        }
        if (msg) box.appendChild(h("p", { class: "acct-msg", role: "status", text: msg }));
        box.appendChild(h("p", { class: "small muted", text: "Your jobs stay on this device whether or not you sign in." }));
      }
      draw();
      return box;
    }

    // ----- plans -----
    function openLink(ctx, planId) {
      var link = CFG.billing && CFG.billing.paymentLinks && CFG.billing.paymentLinks[planId];
      var url = checkoutUrl(link, cur.email, cur.entitlement && cur.entitlement.orgId);
      if (!url) { ctx.snack("Checkout link not configured yet.", { bad: true }); return; }
      try { root.open(url, "_blank", "noopener"); } catch (e) { root.location.href = url; }
    }

    function plansView(ctx, opts) {
      opts = opts || {};
      var h = ctx.h, P = root.ApexPlans;
      var plat = P.platform();
      var trial = CFG.billing && CFG.billing.trialDays;
      var isDemo = cur.status === "demo";
      var wrap = h("div", { class: "stack acct" });
      if (opts.title) wrap.appendChild(h("h2", { class: "acct-title", text: opts.title }));
      if (opts.lede) wrap.appendChild(h("p", { text: opts.lede }));
      var ion = iosNotice(h); if (ion) wrap.appendChild(ion);
      if (trial) wrap.appendChild(h("p", { class: "muted", text: "Every plan starts with a " + trial + "-day free trial. Cancel anytime from the billing portal." }));
      if (isDemo) wrap.appendChild(h("p", { class: "banner", role: "status" }, "Demo mode: billing is not active and everything is unlocked on this device."));
      var list = h("div", { class: "acct-plans" });
      P.describePlans(plat).forEach(function (pl) {
        var card = h("div", { class: "acct-plan" + (cur.plan === pl.id && cur.status !== "locked" ? " acct-plan-current" : "") });
        card.appendChild(h("div", { class: "section-head" }, h("span", { class: "label", text: pl.name }), cur.plan === pl.id && !isDemo && cur.status !== "locked" ? h("span", { class: "pill pill-good", text: "Current" }) : null));
        card.appendChild(h("p", { class: "acct-price" }, h("strong", { text: P.money(pl.cents) }), " / seat / month"));
        if (pl.discounted) card.appendChild(h("p", { class: "small acct-note", text: pl.note }));
        card.appendChild(h("p", { class: "muted", text: pl.tagline }));
        if (pl.minSeats > 1) card.appendChild(h("p", { class: "small muted", text: "Minimum " + pl.minSeats + " seats." }));
        if (pl.laser && !pl.laser.ok) {
          card.appendChild(h("p", { class: "small acct-note", text: pl.laser.reason === "ios-under-construction"
            ? "Laser capture is under construction on iPhone and iPad. Typing, voice and photos work."
            : "Laser capture needs Chrome or Edge on Android or desktop (Web Bluetooth). Not available in this browser." }));
        }
        if (!isDemo) {
          var link = CFG.billing && CFG.billing.paymentLinks && CFG.billing.paymentLinks[pl.id];
          if (cur.status === "signed-out" || !cur.email) {
            card.appendChild(h("button", { class: "btn btn-block", type: "button", text: "Sign in to subscribe", onclick: function () { ctx.go("#/account"); } }));
          } else if (!link) {
            card.appendChild(h("p", { class: "muted small acct-note", role: "status", text: "Checkout link not configured yet" }));
          } else {
            card.appendChild(h("button", { class: "btn btn-primary btn-block", type: "button", text: trial ? "Start " + trial + "-day free trial" : "Subscribe", onclick: function () { openLink(ctx, pl.id); } }));
          }
        }
        list.appendChild(card);
      });
      wrap.appendChild(list);
      wrap.appendChild(h("p", { class: "small muted", text: "After checkout, come back and tap Refresh. Prices are per seat per month in US dollars." }));
      wrap.appendChild(h("button", { class: "btn btn-block", type: "button", text: "Refresh my subscription", onclick: function () {
        ctx.snack("Checking…");
        refresh().then(function () { ctx.go("#/account"); });
      } }));
      wrap.appendChild(legalLinks(h));
      return wrap;
    }

    function statusLine(s) {
      var e = s.entitlement || {};
      if (s.status === "demo") return "Demo mode: everything unlocked, no billing.";
      if (s.status === "ok") {
        if (e.status === "trialing") return "Free trial" + (e.currentPeriodEnd ? " until " + fmtDate(e.currentPeriodEnd) : "") + ".";
        if (e.status === "canceled") return "Canceled. Access continues until " + fmtDate(e.currentPeriodEnd) + ".";
        return "Active" + (e.currentPeriodEnd ? ", renews " + fmtDate(e.currentPeriodEnd) : "") + ".";
      }
      if (s.status === "grace") return s.reason === "past-due"
        ? "Payment problem. Update your card in the billing portal by " + fmtDate(s.graceUntil) + "."
        : "Offline. Access continues until " + fmtDate(s.graceUntil) + "; connect to the internet to re-check.";
      if (s.status === "locked") {
        if (s.reason === "needs-online") return "We couldn't check your subscription. Connect to the internet and tap Refresh.";
        if (s.reason === "grace-expired") return "We haven't been able to verify your subscription in " + CFG.offlineGraceDays + " days. Connect to the internet to unlock.";
        if (s.reason === "payment-failed") return "Payment failed and the grace period ended.";
        return "No active subscription.";
      }
      if (s.status === "checking") return "Checking your subscription…";
      return "";
    }

    function accountView(ctx) {
      var h = ctx.h, s = state();
      if (s.status === "signed-out") return signInScreen(ctx);
      var wrap = h("div", { class: "stack acct" });
      wrap.appendChild(h("h2", { class: "acct-title", text: "Account" }));
      if (s.status === "demo") {
        wrap.appendChild(h("p", { text: "Demo mode: no account or subscription is needed. Everything is unlocked on this device and your jobs are stored locally." }));
        wrap.appendChild(legalLinks(h));
        return wrap;
      }
      wrap.appendChild(h("div", { class: "acct-card" },
        h("p", { class: "row-sub", text: s.email }),
        h("p", { class: "row-title", text: "Plan: " + (s.plan ? planName(s.plan) : "none") }),
        h("p", { class: "muted", text: statusLine(s) })));
      wrap.appendChild(manageBlock(h));
      wrap.appendChild(h("button", { class: "btn btn-block", type: "button", text: "See plans", onclick: function () { ctx.go("#/plans"); } }));
      wrap.appendChild(h("button", { class: "btn btn-block", type: "button", text: "Refresh", onclick: function () {
        ctx.snack("Checking…"); refresh().then(function () { ctx.go("#/account"); });
      } }));
      wrap.appendChild(signOutBtn(ctx));
      wrap.appendChild(h("p", { class: "small muted", text: "Signing out never deletes your jobs. They stay on this device." }));
      wrap.appendChild(legalLinks(h));
      return wrap;
    }

    function signOutBtn(ctx) {
      return ctx.h("button", { class: "btn btn-ghost btn-block", type: "button", text: "Sign out", onclick: function () {
        ctx.confirmDialog("Sign out? Your jobs stay on this device.", "Sign out").then(function (ok) {
          if (ok) signOut().then(function () { ctx.go("#/"); });
        });
      } });
    }

    function paywallView(ctx, why) {
      var h = ctx.h, s = state();
      var wrap = h("div", { class: "stack acct" });
      wrap.appendChild(h("div", { class: "banner banner-bad", role: "alert" },
        h("div", null, h("strong", { text: "Subscription needed to capture or export." }), h("p", { class: "small", text: statusLine(s) }))));
      wrap.appendChild(h("p", { text: "Your jobs are safe. You can still open and read them, and back them up from Settings." }));
      wrap.appendChild(h("div", { class: "row-actions" },
        h("button", { class: "btn", type: "button", text: "My jobs", onclick: function () { ctx.go("#/"); } }),
        h("button", { class: "btn", type: "button", text: "Back up my jobs", onclick: function () { ctx.go("#/settings"); } }),
        h("button", { class: "btn", type: "button", text: "Refresh", onclick: function () { refresh().then(function () { ctx.go(root.location.hash || "#/"); }); } })));
      wrap.appendChild(manageBlock(h));
      wrap.appendChild(plansView(ctx, {}));
      return wrap;
    }

    function checkingView(ctx) {
      return ctx.h("div", { class: "stack acct" },
        ctx.h("p", { role: "status", text: "Checking your subscription…" }),
        ctx.h("button", { class: "btn btn-block", type: "button", text: "Try again", onclick: function () { refresh().then(function () { ctx.go(root.location.hash || "#/"); }); } }));
    }

    // ----- registrations -----
    ["account", "plans"].forEach(function (name) {
      X.routeParsers.push(function (parts) { return parts[0] === name ? { name: name } : null; });
    });
    X.routes.account = function (r, ctx) { ctx.setBar({ title: "Account", back: "#/settings" }); ctx.mount(accountView(ctx)); };
    X.routes.plans = function (r, ctx) { ctx.setBar({ title: "Plans", back: "#/account" }); ctx.mount(plansView(ctx, { title: "Plans and pricing" })); };

    var OPEN = { terms: 1, privacy: 1, plans: 1, account: 1, settings: 1, orders: 1 };
    var NEEDS_SUB = { capture: 1, export: 1, "new": 1 };

    X.beforeRoute.push(function (route, ctx) {
      if (OPEN[route.name]) return true;
      var wait = readyDone ? Promise.resolve() : Promise.race([readyP, new Promise(function (res) { setTimeout(res, 6000); })]);
      return wait.then(function () {
        var s = state();
        if ((s.status === "ok" || s.status === "grace") && s.entitlement && s.entitlement.role === "viewer" && NEEDS_SUB[route.name]) {
          // Free viewer seats are read-only: no new capture/export (server reports plan "crew" for them).
          ctx.setBar({ title: "Viewer access", back: "#/" });
          ctx.mount(ctx.h("div", { class: "stack acct" },
            ctx.h("div", { class: "banner", role: "status" }, ctx.h("div", null, ctx.h("strong", { text: "Viewer access is read-only." }),
              ctx.h("p", { class: "small", text: "You can open and read shared jobs. Ask a team admin for a member seat to capture or export." }))),
            ctx.h("button", { class: "btn btn-block", type: "button", text: "My jobs", onclick: function () { ctx.go("#/"); } })));
          return false;
        }
        if (s.status === "demo" || s.status === "ok" || s.status === "grace") return true;
        if (s.status === "locked") {
          if (!NEEDS_SUB[route.name]) return true;
          ctx.setBar({ title: "Subscription", back: "#/" });
          ctx.mount(paywallView(ctx));
          return false;
        }
        ctx.setBar({ home: true });
        ctx.mount(s.status === "signed-out" ? signInScreen(ctx) : checkingView(ctx));
        return false;
      });
    });

    X.homeBlocks.push(function (ctx) {
      var h = ctx.h, s = state();
      if (s.status === "locked") {
        return h("div", { class: "banner banner-bad", role: "alert" },
          h("div", null, h("strong", { text: "Subscription inactive." }), h("p", { class: "small", text: "Your jobs are safe and readable. New capture and export are paused. " + statusLine(s) })),
          h("button", { class: "btn", type: "button", text: "Plans", onclick: function () { ctx.go("#/plans"); } }));
      }
      if (s.status === "grace") {
        return h("div", { class: "banner", role: "status" },
          h("div", null, h("strong", { text: s.reason === "past-due" ? "Payment problem." : "Working offline." }), h("p", { class: "small", text: statusLine(s) })),
          h("button", { class: "btn", type: "button", text: "Account", onclick: function () { ctx.go("#/account"); } }));
      }
      return null;
    });

    X.settingsBlocks.push(function (ctx) {
      var h = ctx.h, s = state();
      var sec = h("div", { class: "section form-grid acct" }, h("div", { class: "section-head" }, h("span", { class: "label", text: "Account and plan" })));
      if (s.status === "demo") {
        sec.appendChild(h("p", { class: "muted", text: "Demo mode: everything is unlocked and no account is needed." }));
        sec.appendChild(legalLinks(h));
        return sec;
      }
      if (s.status === "signed-out" || s.status === "checking") {
        sec.appendChild(h("p", { class: "muted", text: s.status === "checking" ? "Checking your subscription…" : "You're signed out." }));
        sec.appendChild(h("button", { class: "btn btn-block", type: "button", text: s.status === "checking" ? "Account" : "Sign in", onclick: function () { ctx.go("#/account"); } }));
        sec.appendChild(legalLinks(h));
        return sec;
      }
      sec.appendChild(h("p", { class: "row-sub", text: s.email }));
      sec.appendChild(h("p", { class: "row-title", text: "Plan: " + (s.plan ? planName(s.plan) : "none") }));
      sec.appendChild(h("p", { class: "muted small", text: statusLine(s) }));
      sec.appendChild(manageBlock(h));
      sec.appendChild(h("button", { class: "btn btn-block", type: "button", text: "Account and plans", onclick: function () { ctx.go("#/account"); } }));
      sec.appendChild(signOutBtn(ctx));
      sec.appendChild(legalLinks(h));
      return sec;
    });

    // boot
    readyP = refresh().then(function () { readyDone = true; }, function () { readyDone = true; });
    X.onBoot.push(function () { readyP.then(function () { /* state already cached; routes re-gate on navigation */ }); });
    root.addEventListener && root.addEventListener("online", function () { refresh(); });
  };

  return api;
});
