// Apex Measure Pro — Stripe webhook (Supabase Edge Function, Deno).
// UNTESTED against live Stripe/Supabase (no accounts yet). Deploy WITHOUT JWT verification — Stripe
// does not send a Supabase JWT; the Stripe signature is the authentication:
//   supabase functions deploy stripe-webhook --no-verify-jwt
//
// Secrets (supabase secrets set ...; NEVER commit them, never put them in js/config.js):
//   STRIPE_SECRET_KEY       sk_live_... (or sk_test_...)   used for signature verification + reading subscriptions
//   STRIPE_WEBHOOK_SECRET   whsec_...                       the signing secret of THIS endpoint
//   PRICE_MANUAL, PRICE_LASER, PRICE_CREW    Stripe Price IDs (price_...) → plan mapping
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  injected automatically by Supabase
//
// Behaviour
//   * verifies the signature over the RAW body (constructEventAsync — Deno needs the async/SubtleCrypto form)
//   * idempotent: every event id is recorded once in public.stripe_events; Stripe retries are no-ops
//   * out-of-order safe: a subscription row only accepts events at least as new as the last applied one
//   * writes ONLY public.subscriptions (service role). The app derives entitlement from it (get_entitlement()).
//   * org linking: checkout.session.completed carries client_reference_id = the org id (the app appends
//     ?client_reference_id=<orgId> to the Payment Link). It is trusted only when the payer's email is an
//     owner/admin of that org; otherwise the org whose owner has the customer's email is used.

import Stripe from "npm:stripe@17";
import { createClient } from "npm:@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
  httpClient: Stripe.createFetchHttpClient(),
});
const cryptoProvider = Stripe.createSubtleCryptoProvider();

const db = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Plan = "none" | "manual" | "laser" | "crew";
type Status = "none" | "trialing" | "active" | "past_due" | "canceled";

function planForPrice(priceId: string | undefined): Plan {
  if (!priceId) return "none";
  if (priceId === Deno.env.get("PRICE_MANUAL")) return "manual";
  if (priceId === Deno.env.get("PRICE_LASER")) return "laser";
  if (priceId === Deno.env.get("PRICE_CREW")) return "crew";
  return "none"; // unknown price → grants nothing
}

function mapStatus(s: string): Status {
  switch (s) {
    case "trialing": return "trialing";
    case "active": return "active";
    case "past_due": return "past_due"; // access continues only for 7 days past period end (enforced in SQL)
    case "unpaid": // Stripe gave up collecting → no access
    case "canceled":
    case "incomplete_expired":
    case "paused": return "canceled";
    default: return "none"; // incomplete: not paid yet → no access
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// deno-lint-ignore no-explicit-any
type Any = any;

async function orgExists(id: string | null | undefined): Promise<string | null> {
  if (!id || !UUID.test(id)) return null;
  const { data } = await db.from("orgs").select("id").eq("id", id).maybeSingle();
  return data ? data.id : null;
}

async function orgForEmail(email: string | null | undefined): Promise<string | null> {
  if (!email) return null;
  const { data, error } = await db.rpc("org_id_for_email", { p_email: email });
  if (error) throw new Error("org lookup failed: " + error.message);
  return (data as string | null) ?? null;
}

async function customerEmail(customerId: string | null): Promise<string | null> {
  if (!customerId) return null;
  const c = await stripe.customers.retrieve(customerId);
  return (c as Any).deleted ? null : ((c as Any).email ?? null);
}

// Insert/update the subscriptions row for a Stripe subscription.
async function upsertSubscription(sub: Stripe.Subscription, orgHint: string | null, eventCreated: number) {
  const item: Any = sub.items?.data?.[0];
  const priceId: string | undefined = item?.price?.id;
  const plan = planForPrice(priceId);
  if (plan === "none") console.warn("subscription " + sub.id + ": price not mapped to a plan (check PRICE_* secrets)");
  const customerId = typeof sub.customer === "string" ? sub.customer : (sub.customer as Any)?.id ?? null;
  // Stripe moved current_period_end from the subscription to the item in newer API versions.
  const cpe: number | null = (sub as Any).current_period_end ?? item?.current_period_end ?? null;

  const { data: existing, error: readErr } = await db.from("subscriptions")
    .select("org_id,last_event_created").eq("stripe_subscription_id", sub.id).maybeSingle();
  if (readErr) throw new Error("read failed: " + readErr.message);

  // Resolve the org: explicit hint > existing link > another row of the same customer > owner email.
  let orgId: string | null = (await orgExists(orgHint)) ?? existing?.org_id ?? null;
  if (!orgId && customerId) {
    const { data: sib } = await db.from("subscriptions").select("org_id")
      .eq("stripe_customer_id", customerId).not("org_id", "is", null).limit(1).maybeSingle();
    orgId = sib?.org_id ?? null;
  }
  if (!orgId) orgId = await orgForEmail(await customerEmail(customerId));

  const stale = existing && Number(existing.last_event_created) > eventCreated;
  if (stale) {
    // An older event must not overwrite newer state — but it may still supply a missing org link.
    if (orgId && !existing.org_id) {
      await db.from("subscriptions").update({ org_id: orgId }).eq("stripe_subscription_id", sub.id);
    }
    return;
  }

  const row = {
    stripe_subscription_id: sub.id,
    org_id: orgId,
    stripe_customer_id: customerId,
    plan,
    status: mapStatus(sub.status),
    seats: Math.max(0, Number(item?.quantity ?? 1)),
    current_period_end: cpe ? new Date(cpe * 1000).toISOString() : null,
    last_event_created: eventCreated,
    updated_at: new Date().toISOString(),
  };
  const { error } = await db.from("subscriptions").upsert(row, { onConflict: "stripe_subscription_id" });
  if (error) throw new Error("upsert failed: " + error.message);
}

async function handle(event: Stripe.Event) {
  switch (event.type) {
    case "checkout.session.completed": {
      const s = event.data.object as Stripe.Checkout.Session;
      if (s.mode !== "subscription" || !s.subscription) return;
      const subId = typeof s.subscription === "string" ? s.subscription : s.subscription.id;
      const sub = await stripe.subscriptions.retrieve(subId);
      // client_reference_id is attacker-controllable (it is a URL parameter). Honour it ONLY if the
      // payer's email belongs to an owner/admin of that org; otherwise fall back to the owner-email match.
      const email = s.customer_details?.email ?? s.customer_email ?? null;
      let org: string | null = null;
      const hint = await orgExists(s.client_reference_id);
      if (hint && email) {
        const { data: ok, error: e } = await db.rpc("org_admin_has_email", { p_org: hint, p_email: email });
        if (e) throw new Error("admin check failed: " + e.message);
        if (ok === true) org = hint;
      }
      if (!org) org = await orgForEmail(email);
      await upsertSubscription(sub, org, event.created);
      return;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      await upsertSubscription(event.data.object as Stripe.Subscription, null, event.created);
      return;
    }
    case "invoice.payment_failed": {
      const inv: Any = event.data.object;
      const subId: string | null = (typeof inv.subscription === "string" ? inv.subscription : inv.subscription?.id) ??
        inv.parent?.subscription_details?.subscription ?? null;
      if (!subId) return;
      // Only flips status (plan/seats untouched) and only if this event is newer than the last one applied.
      const { error } = await db.from("subscriptions")
        .update({ status: "past_due", last_event_created: event.created, updated_at: new Date().toISOString() })
        .eq("stripe_subscription_id", subId).lte("last_event_created", event.created).neq("status", "canceled");
      if (error) throw new Error("update failed: " + error.message);
      return;
    }
    default:
      return; // other event types are acknowledged and ignored
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const sig = req.headers.get("stripe-signature");
  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!sig || !secret) return json({ error: "not configured" }, 400);

  const raw = await req.text(); // the RAW body — parsing it first would break the signature
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, sig, secret, undefined, cryptoProvider);
  } catch (_e) {
    return json({ error: "invalid signature" }, 400); // deliberately no details
  }

  // Idempotency: claim the event id first; a duplicate delivery stops here.
  const claim = await db.from("stripe_events").insert({ id: event.id });
  if (claim.error) {
    if (claim.error.code === "23505") return json({ ok: true, duplicate: true });
    console.error("claim failed", claim.error.message);
    return json({ error: "server" }, 500);
  }

  try {
    await handle(event);
    console.log("handled", event.type, event.id);
    return json({ ok: true });
  } catch (e) {
    // Release the claim so Stripe's retry is processed, then ask for a retry.
    await db.from("stripe_events").delete().eq("id", event.id);
    console.error("handler failed", event.type, event.id, (e as Error).message);
    return json({ error: "server" }, 500);
  }
});
