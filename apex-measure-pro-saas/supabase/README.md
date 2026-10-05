# Supabase + Stripe setup (Apex Measure Pro)

Everything here is **written but untested against a live project** — there is no Supabase or Stripe account yet.
The SQL was executed against a local Postgres 16 with stubbed `auth`/`storage` schemas (RLS flows verified);
the client code is tested against an in-memory mock. Expect to fix small things on first contact with the real services.

Steps marked **[OWNER]** need Apex's own accounts (login, payment method, identity). The rest is copy/paste.

## 1. Create the Supabase project  [OWNER]
1. supabase.com → New project (any region near Oklahoma, e.g. `us-east`/`us-central`). Save the database password in your password manager.
2. Settings → API: copy **Project URL** and the **anon / public** key. These two go in `js/config.js` (see step 7). The **service_role** key is secret: it is only ever used by the Edge Function (Supabase injects it automatically — you never paste it anywhere).

## 2. Run the schema
Dashboard → SQL Editor → New query → paste all of `supabase/schema.sql` → Run. Safe to re-run.
It creates tables, Row Level Security, the signup trigger (every new user gets a personal org), the entitlement RPC `get_entitlement()`, the team/invite RPCs and the private `photos` Storage bucket.

## 3. Email sign-in with a 6-digit code  [OWNER]
The app signs users in with an emailed one-time code (no passwords).
1. Authentication → Providers → Email: enabled, "Confirm email" on.
2. Authentication → Email Templates → **Magic Link** (and "Confirm signup"): include the code, e.g. `Your Apex Measure Pro code: {{ .Token }}`. If the template only has `{{ .ConfirmationURL }}` no code is sent.
3. Authentication → URL configuration: Site URL = your hosted app URL.
4. The built-in mailer is rate-limited (a few emails/hour). Before real customers: Authentication → SMTP Settings → connect a real sender (e.g. Resend/Postmark) from `apexinstallationsok.com`  [OWNER: domain DNS].

## 4. Stripe products  [OWNER]
In the Stripe Dashboard (Test mode first):
1. Products → create three recurring monthly products matching `js/config.js` `plans`: **Manual $15**, **Laser $29**, **Crew $39 per seat** (Crew: "Per unit" pricing, **minimum quantity 2** via the Payment Link's quantity limits). Add a 14-day free trial on the Payment Link / price if wanted (`billing.trialDays`).
2. Copy each **Price ID** (`price_...`).
3. Payment Links → create one per price. Crew: allow adjustable quantity (min 2). On each link: *After payment* → redirect to your app's URL; *Collect email* on.
4. Settings → Billing → **Customer Portal** → activate (allow cancel, update payment method, change quantity). Copy the portal login link.

> The app appends `?client_reference_id=<orgId>&prefilled_email=<email>` to the Payment Link (the org id comes from `get_entitlement().orgId`). That is how a payment is tied to the right company. Because that URL parameter can be edited by anyone, the webhook **only honours it when the payer's email is an owner/admin of that org**; otherwise it falls back to the org whose owner has the payer's email. A payer who types a different email than they sign in with stays unlinked until support links it by hand (set `subscriptions.org_id`).
> A stricter option, if you outgrow Payment Links: create Checkout Sessions server-side (a small Edge Function called by the signed-in user) so the org id is set by the server from the user's JWT and can't be tampered with.

## 5. Deploy the webhook function
Install the Supabase CLI (`npm i -g supabase`), then from the repo root:
```
supabase login                                  # [OWNER] opens a browser
supabase link --project-ref <your-project-ref>  # ref = the xxxx in https://xxxx.supabase.co
supabase secrets set STRIPE_SECRET_KEY=sk_test_... STRIPE_WEBHOOK_SECRET=whsec_... \
  PRICE_MANUAL=price_... PRICE_LASER=price_... PRICE_CREW=price_...
supabase functions deploy stripe-webhook --no-verify-jwt
```
`--no-verify-jwt` is required: Stripe doesn't send a Supabase token; the Stripe signature is the check.
The function URL is `https://<project-ref>.supabase.co/functions/v1/stripe-webhook`.

## 6. Point Stripe at it  [OWNER]
Stripe → Developers → Webhooks → Add endpoint → the URL above → events:
`checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`.
Reveal the endpoint's **Signing secret** (`whsec_...`) and set it as `STRIPE_WEBHOOK_SECRET` (step 5, re-run `secrets set`).
Test: `stripe trigger checkout.session.completed` won't link an org; do a real test-mode purchase through a Payment Link and check the `subscriptions` table.

## 7. Where each value goes in `js/config.js`
| Value | Config key |
|---|---|
| Supabase Project URL | `backend.url` |
| Supabase anon/public key | `backend.anonKey` |
| Payment Link URLs | `billing.paymentLinks.manual / laser / crew` |
| Customer Portal link | `billing.portalUrl` |
| `price_...` IDs | **not** in config — Supabase secrets `PRICE_MANUAL/LASER/CREW` only |
| `sk_...`, `whsec_...`, service-role key | **never** in config or git — Supabase secrets only |

With `backend.url` + `backend.anonKey` filled in, `ApexConfig.demo` turns false and the app starts requiring sign-in.

## 8. Go-live checklist
- Switch Stripe to Live mode: recreate products/links/webhook, re-run `secrets set` with live keys and live Price IDs.
- Authentication → rate limits / CAPTCHA reviewed; custom SMTP in place.
- Database → Backups: enable (paid plan) — customer measurements live here.
- Try the full loop with two real phones: sign up, buy Crew (test card `4242 4242 4242 4242`), invite a second email, accept the code, edit the same job offline on both, reconnect, confirm a "(conflict …)" copy appears.

## Team model (for support questions)
- Every user belongs to exactly one org. Signing up creates a personal org.
- Only the **Crew** plan syncs jobs. Owner/admin/member can edit; **viewer** (office staff) is read-only and **free** (doesn't use a seat).
- Invites are bound to an email address, valid 7 days, single use. The owner/admin shares the code manually (no outbound email is sent by the server).
- Accepting an invite moves the person into the inviter's org. If they hold their own active subscription they must cancel it first (the app says so).
- Removed members keep the jobs on their own phone; the company's copy stays with the company.
- Past-due payments keep access for 7 days after the period end (Stripe retries meanwhile); then, like `canceled`/`unpaid`, sync writes stop. Nothing is ever deleted locally.
- Deleting a shared job on the server wipes its data to a tombstone and removes its photo rows from Storage (a trigger). Supabase may keep the raw file bytes until its own cleanup; for guaranteed byte purge add a scheduled Edge Function that calls the Storage API `remove` for `photos/<orgId>/<projectId>/`.
- `consents` table + `record_consent()` keep a server-side log of which Terms/Privacy version each user accepted.
- An owner can't leave a team that still has other members (`transfer-ownership-first`); ownership transfer isn't built yet, so remove the others first.
- Stripe customer ids are not readable by any client role (column privileges); only the webhook (service role) sees them.
