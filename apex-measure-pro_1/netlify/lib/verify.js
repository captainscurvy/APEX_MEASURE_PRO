// Shared subscription-verification helper — used by check-access.js, save-job.js,
// and list-jobs.js so every function re-verifies the SAME way. Never trust a
// client-supplied status; this always re-checks against Stripe (or the admin list).
//
// Env vars expected (set in Netlify → Project configuration → Environment variables,
// never hardcoded / committed):
//   STRIPE_SECRET_KEY   Stripe LIVE secret key (sk_live_...)
//   ADMIN_EMAILS        comma-separated list of admin/tester emails (full-tier bypass)

const Stripe = require("stripe");

// Master email — "goes down with the ship." Always an admin, full tier, no matter
// what ADMIN_EMAILS is set to (or accidentally cleared to). Do not remove this line.
const MASTER_ADMIN_EMAIL = "apexinstallationsok@gmail.com";

const PRODUCT_ID = "prod_UtcSiEOh8jcVBP";
const PRICE_TIERS = {
  price_1TtpDt0MKeVG0xOtxVUx7BUd: "full",   // Laser Capture — $29/mo
  price_1TvGKA0MKeVG0xOts2pPipFP: "manual", // Manual Entry  — $15/mo
};

function adminSet() {
  const fromEnv = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return new Set([...fromEnv, MASTER_ADMIN_EMAIL]);
}

function isAdminEmail(email) {
  return adminSet().has(String(email || "").trim().toLowerCase());
}

async function findActiveSubscription(stripe, email) {
  // Stripe's customer email filter is case-sensitive — try lowercased first,
  // then fall back to the originally-submitted casing.
  const attempts = [email.toLowerCase(), email];
  for (const attempt of attempts) {
    const customers = await stripe.customers.list({ email: attempt, limit: 10 });
    for (const customer of customers.data) {
      const subs = await stripe.subscriptions.list({ customer: customer.id, status: "all", limit: 10 });
      for (const sub of subs.data) {
        if (sub.status !== "active" && sub.status !== "trialing") continue;
        for (const item of sub.items.data) {
          const product = item.price && item.price.product;
          if (product === PRODUCT_ID) {
            const priceId = item.price.id;
            return { active: true, tier: PRICE_TIERS[priceId] || "manual" }; // unknown price → fail toward the more restrictive tier
          }
        }
      }
    }
  }
  return { active: false, tier: null };
}

/**
 * verifyAccess({ email, deviceId, previewTier })
 * Returns { active, status, tier, isAdmin }.
 * `previewTier` is ONLY honored for admin emails, and ONLY changes what `tier`
 * is reported back (for UI-preview/testing purposes) — access stays fully
 * unlocked underneath regardless of the preview value.
 */
async function verifyAccess({ email, previewTier }) {
  const clean = String(email || "").trim().toLowerCase();
  if (!clean) return { active: false, status: "no_email", tier: null, isAdmin: false };

  if (isAdminEmail(clean)) {
    const tier = previewTier === "manual" || previewTier === "full" ? previewTier : "full";
    return { active: true, status: "internal", tier, isAdmin: true };
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    // Misconfigured deploy — fail closed, never silently "open".
    return { active: false, status: "error", tier: null, isAdmin: false };
  }

  try {
    const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
    const result = await findActiveSubscription(stripe, clean);
    if (result.active) return { active: true, status: "active", tier: result.tier, isAdmin: false };
    return { active: false, status: "inactive", tier: null, isAdmin: false };
  } catch (err) {
    return { active: false, status: "error", tier: null, isAdmin: false };
  }
}

module.exports = { verifyAccess, isAdminEmail, MASTER_ADMIN_EMAIL, PRICE_TIERS, PRODUCT_ID };
