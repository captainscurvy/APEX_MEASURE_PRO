/*
 * ui-legal.js — #/terms and #/privacy (DRAFT documents held as JS data) + ApexLegal.requireAcceptance().
 * These are drafts written in plain English. They are NOT legal advice: have an Oklahoma attorney review before launch.
 */
(function () {
  "use strict";
  var X = window.ApexExt, CFG = window.ApexConfig || {};
  var COMPANY = (CFG.company && CFG.company.legalName) || "Apex Installations LLC";
  var EMAIL = (CFG.company && CFG.company.supportEmail) || "apexinstallationsok@gmail.com";
  var LEGAL = CFG.legal || {};
  var KEY = "apex-legal-accepted";

  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) {} }

  // Document data. Each section: { h: heading, p: [paragraphs], ul: [bullets] }.
  var TERMS = [
    { h: "1. Who we are and what this is", p: [
      "Apex Measure Pro (the \"App\") is a subscription app for window-treatment installers to record window measurements, photos and notes and to produce measurement sheets. It is provided by " + COMPANY + ", an Oklahoma limited liability company (\"Apex\", \"we\", \"us\"). By creating an account or using the App you agree to these Terms. If you do not agree, do not use the App.",
      "If you use the App for a company, you confirm you can bind that company to these Terms."] },
    { h: "2. Accounts", p: [
      "You sign in with your email address and a one-time code. You are responsible for your email account and for activity under your sign-in. Give us accurate information and tell us at " + EMAIL + " if you think someone else has accessed your account."] },
    { h: "3. Subscriptions, free trial and auto-renewal", p: [
      "Paid plans are billed per seat, per month, in US dollars, at the price shown when you subscribe. Prices on the plans screen may differ by device (for example, on iPhone and iPad the Laser plan is billed at the Manual price while laser support for those devices is under construction).",
      "Free trial: if a free trial is offered, its length is shown at checkout. If you do not cancel before the trial ends, your subscription converts to a paid subscription and your payment method is charged.",
      "Auto-renewal: your subscription renews automatically each month until you cancel. You authorize us, through our payment processor Stripe, to charge your payment method each period.",
      "Price changes: we may change prices. We will give you notice by email or in the App before a change applies to your next renewal. If you do not agree, cancel before it takes effect.",
      "Plans, seats and features: what each plan includes is shown on the plans screen and may change over time."] },
    { h: "4. Cancel anytime", p: [
      "You can cancel at any time using \"Manage or cancel subscription\" in the App, which opens your billing portal. Cancellation stops future renewals. Unless we say otherwise in writing, you keep access until the end of the period you already paid for. You can also email " + EMAIL + " and we will help."] },
    { h: "5. Refunds", p: [
      "[REFUND POLICY PLACEHOLDER: Apex to decide before launch. Example options: no refunds for partial months; a full refund within a stated number of days of first charge; refunds where required by law.] Until this section is completed, contact " + EMAIL + " about any billing concern and we will review it in good faith."] },
    { h: "6. Non-payment, suspension and your data", p: [
      "If a payment fails, we may give you a short grace period and then suspend paid features. While suspended, you can still open and read the jobs stored on your device and back them up, but new capture and export may be paused until the account is paid up. We do not delete your on-device data because of non-payment. We may suspend or end accounts that violate these Terms."] },
    { h: "7. Your data", p: [
      "You own your data: your jobs, measurements, photos, notes and customer information. You give us only the limited permission needed to run the App for you (for example, to store and sync data when you use sync or team features, and to back it up). We do not claim ownership of your content.",
      "You are responsible for having the right to record any customer information and photos you enter, and for backing up your work. The App stores jobs on your device first; use the backup feature regularly."] },
    { h: "8. Acceptable use", p: ["You agree not to:"], ul: [
      "break the law or use the App to harm others;",
      "attempt to break, probe or overload the App or its servers, or access accounts or data that are not yours;",
      "copy, resell, reverse engineer or build a competing service from the App, except where the law allows;",
      "share your sign-in with people who are not covered by your seats;",
      "upload malicious code or content you have no right to upload."] },
    { h: "9. Measurement accuracy: verify before you order or cut", p: [
      "The App records the numbers you type, speak, or receive from a laser and rounds them DOWN to the nearest 1/8 inch. Rounding down, laser error, mishearing by speech recognition, typing mistakes, out-of-square openings and many other things can make a recorded number differ from the real opening.",
      "You must verify every measurement yourself before you order, cut, fabricate or install anything. The App is a note-taking and calculation aid, not a substitute for professional judgment. Apex is not responsible for materials, labor or any loss caused by an incorrect or misread measurement."] },
    { h: "10. Third-party hardware, services and trademarks", p: [
      "The App can connect to some Bluetooth laser distance meters. Apex is not affiliated with, endorsed by or sponsored by Leica Geosystems AG or any other device maker. Product names belong to their owners and are used only to describe compatibility. Laser support depends on your device and browser and may be unavailable (for example, it is under construction on iPhone and iPad).",
      "Payments are processed by Stripe. Email codes and, if you use sync, data storage are provided by our backend provider. Your use of those services is also subject to their terms."] },
    { h: "11. Availability and changes", p: [
      "We work to keep the App available but do not promise it will be uninterrupted or error-free. We may change or remove features. We may update these Terms; if a change is material we will tell you in the App or by email, and continued use after the effective date means you accept it."] },
    { h: "12. Disclaimer of warranties", p: [
      "THE APP IS PROVIDED \"AS IS\" AND \"AS AVAILABLE\" WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NON-INFRINGEMENT, TO THE FULLEST EXTENT ALLOWED BY LAW."] },
    { h: "13. Limitation of liability", p: [
      "TO THE FULLEST EXTENT ALLOWED BY LAW, APEX WILL NOT BE LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL OR PUNITIVE DAMAGES, OR FOR LOST PROFITS, LOST DATA, WASTED MATERIALS OR LABOR, OR REPLACEMENT COSTS. APEX'S TOTAL LIABILITY FOR ANY CLAIM RELATING TO THE APP WILL NOT EXCEED THE AMOUNT YOU PAID US IN THE 12 MONTHS BEFORE THE CLAIM. Some places do not allow certain limits, so parts of this section may not apply to you."] },
    { h: "14. Indemnity", p: [
      "You agree to cover claims and costs that come from your misuse of the App, your violation of these Terms, or your content, to the extent the law allows."] },
    { h: "15. Governing law and disputes", p: [
      "These Terms are governed by the laws of the State of Oklahoma, without regard to conflict-of-law rules. Any dispute will be brought in the state or federal courts located in Oklahoma, and you and Apex consent to those courts. [ATTORNEY TO CONFIRM: venue county, and whether to add arbitration or a class-action waiver.]"] },
    { h: "16. Ending these Terms", p: [
      "You may stop using the App at any time. We may suspend or end your access for violating these Terms or for non-payment. Sections that by their nature should survive (data ownership, disclaimers, liability limits, governing law) survive."] },
    { h: "17. Contact", p: ["Questions or notices: " + COMPANY + ", Oklahoma, " + EMAIL + "."] }
  ];

  var PRIVACY = [
    { h: "1. Summary", p: [
      "Apex Measure Pro is local-first. By default your jobs, measurements and photos stay on your own device. We collect only what we need to run accounts and billing, and, if you are on a plan with team features, the jobs created while you are on a team (and any existing jobs you explicitly choose to share). We do not sell your data."] },
    { h: "2. What we collect", ul: [
      "Account email: to sign you in with a one-time code and to contact you about your account.",
      "Subscription status: your plan, seats, trial and renewal dates, received from our payment processor.",
      "Job data, measurements, notes and photos: ONLY for jobs synced under a team plan (new jobs while on a team, or existing jobs you explicitly share). Without sync, this data stays on your device and we never receive it.",
      "Team information: if you join a team, your email, role and the shared jobs of that team are visible to the team's owner and members according to their roles.",
      "Basic technical data our backend provider and hosting may log (such as IP address and request time) for security and reliability.",
      "On your device only: your settings, a cached copy of your subscription status (so the app works offline for a few days), and whether you accepted the Terms and Privacy Policy and which version."] },
    { h: "3. Payments", p: [
      "Billing is handled by Stripe. Your card details go to Stripe; we never see or store your card number. We receive your subscription status and limited billing information such as plan, dates and the last four digits of a card as shown by Stripe."] },
    { h: "4. Voice input", p: [
      "If you use voice entry, the App uses your browser's speech recognition. Depending on your browser or device, your audio may be sent to the browser vendor's speech service (for example Google for Chrome, or Apple for Safari) and processed under that vendor's privacy policy. Apex does not receive or store your audio. Voice is optional: you can type every measurement instead."] },
    { h: "5. Laser and Bluetooth", p: [
      "When you connect a laser, the App talks to the device over Bluetooth on your device. Readings are used to fill in measurements and are not sent to us unless you sync that job."] },
    { h: "6. How we use information", ul: [
      "to provide, secure and support the App and your account;",
      "to process subscriptions and send receipts and account notices;",
      "to sync and share jobs when you ask us to;",
      "to fix bugs and prevent abuse;",
      "to meet legal obligations."], p: ["We do not use your jobs or photos for advertising and we do not sell or rent your personal information."] },
    { h: "7. Who we share with", p: [
      "Only service providers that help us run the App (for example Stripe for payments and our backend/database host for sign-in and sync), and as required by law or to protect rights and safety. If you join a team, your team members can see what the team shares. These providers may only use data to provide their service to us."] },
    { h: "8. Retention and deletion", p: [
      "We keep account and billing records while your account is active and as long as needed afterward for taxes, disputes and legal compliance. Synced job data is kept until you delete the job or your account is closed; when you delete a synced job, its contents and photos are removed from our servers (backups may persist briefly). You can ask us to delete your account and synced data at any time by emailing " + EMAIL + "; we will act on verified requests within a reasonable time, normally within 30 days. Data stored only on your device is controlled by you and can be removed from within the App or by clearing the site's data in your browser."] },
    { h: "9. Your choices", p: [
      "You can use the App without a team plan, so job data never leaves your device. You can ask to access, correct, export or delete your information by emailing " + EMAIL + ". Residents of some states may have additional rights under their state privacy laws; we will honor valid requests as required."] },
    { h: "10. Security", p: [
      "We use encrypted connections and access controls, and we limit who can access data. No system is perfectly secure, so keep backups and use a strong email password."] },
    { h: "11. Children", p: [
      "The App is for working professionals and is not directed to children under 13. We do not knowingly collect information from children. If you believe a child has given us information, email " + EMAIL + " and we will delete it."] },
    { h: "12. Changes", p: [
      "We may update this policy. If a change is material we will tell you in the App or by email before it takes effect. The version and date are shown at the top of this page."] },
    { h: "13. Contact", p: [COMPANY + ", Oklahoma. " + EMAIL + "."] }
  ];

  function h(tag, props) {
    var n = document.createElement(tag);
    if (props) Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (v === null || v === undefined || v === false) return;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === "checked") n.checked = !!v;
      else n.setAttribute(k, v === true ? "" : v);
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined || c === false) continue;
      n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return n;
  }

  function docView(kind) {
    var isTerms = kind === "terms";
    var data = isTerms ? TERMS : PRIVACY;
    var version = isTerms ? LEGAL.termsVersion : LEGAL.privacyVersion;
    var wrap = h("article", { class: "legal" },
      h("div", { class: "banner banner-bad legal-draft", role: "note" },
        h("div", null,
          h("strong", { text: "DRAFT — have an attorney review before launch" }),
          h("p", { class: "small", text: "Version " + (version || "draft") + ". This draft is not legal advice." }))),
      h("h2", { class: "legal-title", text: isTerms ? "Terms of Service" : "Privacy Policy" }),
      h("p", { class: "small muted", text: COMPANY + " · Version " + (version || "draft") }));
    data.forEach(function (s) {
      var sec = h("section", { class: "legal-sec" }, h("h3", { text: s.h }));
      (s.p || []).forEach(function (t) { sec.appendChild(h("p", { text: t })); });
      if (s.ul) { var ul = h("ul"); s.ul.forEach(function (t) { ul.appendChild(h("li", { text: t })); }); sec.appendChild(ul); }
      wrap.appendChild(sec);
    });
    wrap.appendChild(h("p", { class: "small muted" },
      h("a", { href: isTerms ? "#/privacy" : "#/terms", text: isTerms ? "Read the Privacy Policy" : "Read the Terms of Service" })));
    return wrap;
  }

  function hasAccepted() {
    try {
      var a = JSON.parse(lsGet(KEY));
      return !!a && a.terms === LEGAL.termsVersion && a.privacy === LEGAL.privacyVersion;
    } catch (e) { return false; }
  }
  function record() {
    lsSet(KEY, JSON.stringify({ terms: LEGAL.termsVersion, privacy: LEGAL.privacyVersion, at: new Date().toISOString() }));
  }

  // Returns { node, accepted(), record() }. Nothing is stored or sent until record() is called.
  function requireAcceptance(ctx, onChange) {
    var make = (ctx && ctx.h) || h;
    var box = make("input", { type: "checkbox", id: "legal-accept", checked: hasAccepted() });
    box.addEventListener("change", function () { try { if (onChange) onChange(box.checked); } catch (e) {} });
    var node = make("label", { class: "check-row legal-accept", for: "legal-accept" }, box,
      make("span", null, "I accept the ",
        make("a", { href: "#/terms", target: "_blank", rel: "noopener", text: "Terms of Service" }), " and ",
        make("a", { href: "#/privacy", target: "_blank", rel: "noopener", text: "Privacy Policy" }), "."));
    return { node: node, accepted: function () { return !!box.checked; }, record: record };
  }

  window.ApexLegal = { requireAcceptance: requireAcceptance, hasAccepted: hasAccepted, record: record,
    terms: TERMS, privacy: PRIVACY };

  if (!X) return;
  ["terms", "privacy"].forEach(function (name) {
    X.routeParsers.push(function (parts) { return parts[0] === name ? { name: name } : null; });
    X.routes[name] = function (r, ctx) {
      ctx.setBar({ title: name === "terms" ? "Terms of Service" : "Privacy Policy", back: "#/settings" });
      ctx.mount(docView(name));
    };
  });
})();
