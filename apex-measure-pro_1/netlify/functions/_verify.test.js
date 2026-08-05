// Local logic tests for _verify.js — the admin/master-email and tier-preview paths,
// which don't need a live Stripe connection. Real Stripe lookups still need to be
// smoke-tested against the actual Stripe account once deployed (can't be done from
// here without live credentials).
const assert = require("assert");
const { verifyAccess, isAdminEmail, MASTER_ADMIN_EMAIL } = require("./_verify");

(async () => {
  // 1. Master email is always admin, even with ADMIN_EMAILS unset.
  delete process.env.ADMIN_EMAILS;
  assert.strictEqual(isAdminEmail(MASTER_ADMIN_EMAIL), true, "master email must be admin with no ADMIN_EMAILS set");
  assert.strictEqual(isAdminEmail("APEXinstallationsOK@gmail.com"), true, "master email check must be case-insensitive");

  // 2. Master email survives ADMIN_EMAILS being set to something that omits it entirely.
  process.env.ADMIN_EMAILS = "someoneelse@example.com";
  assert.strictEqual(isAdminEmail(MASTER_ADMIN_EMAIL), true, "master email must survive ADMIN_EMAILS not containing it");
  assert.strictEqual(isAdminEmail("someoneelse@example.com"), true, "additional admin emails from env still work");
  assert.strictEqual(isAdminEmail("stranger@example.com"), false, "non-admin emails are not admin");

  // 3. Additional admin emails can be many, comma-separated, whitespace-tolerant.
  process.env.ADMIN_EMAILS = "a@example.com, B@Example.com ,c@example.com";
  assert.strictEqual(isAdminEmail("a@example.com"), true);
  assert.strictEqual(isAdminEmail("b@example.com"), true, "case-insensitive additional admin");
  assert.strictEqual(isAdminEmail("c@example.com"), true);
  assert.strictEqual(isAdminEmail(MASTER_ADMIN_EMAIL), true, "master still present alongside a full list");

  // 4. verifyAccess admin path defaults to tier 'full'.
  process.env.ADMIN_EMAILS = "";
  let r = await verifyAccess({ email: MASTER_ADMIN_EMAIL });
  assert.strictEqual(r.active, true);
  assert.strictEqual(r.isAdmin, true);
  assert.strictEqual(r.tier, "full", "admin defaults to full tier with no previewTier");

  // 5. Admin tier-preview override — reports 'manual' for UI testing, stays fully active.
  r = await verifyAccess({ email: MASTER_ADMIN_EMAIL, previewTier: "manual" });
  assert.strictEqual(r.active, true, "preview override must never lock out the admin");
  assert.strictEqual(r.isAdmin, true);
  assert.strictEqual(r.tier, "manual", "previewTier=manual should be honored for admins");

  // 6. previewTier is ignored for non-admins (no Stripe key configured here -> fails closed, not spoofed open).
  delete process.env.STRIPE_SECRET_KEY;
  r = await verifyAccess({ email: "stranger@example.com", previewTier: "full" });
  assert.strictEqual(r.active, false, "a non-admin can never use previewTier to unlock access");
  assert.strictEqual(r.status, "error", "missing STRIPE_SECRET_KEY fails closed, not open");

  // 7. Empty email fails closed cleanly.
  r = await verifyAccess({ email: "" });
  assert.strictEqual(r.active, false);
  assert.strictEqual(r.status, "no_email");

  console.log("7 passed, 0 failed");
})().catch((e) => { console.error("FAIL:", e); process.exit(1); });
