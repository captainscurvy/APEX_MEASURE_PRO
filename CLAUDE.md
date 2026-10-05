# Apex Measure Pro — project invariants

These are fixed decisions. Do not change, remove, or "clean up" any of them without an explicit request from the owner.

## 1. Owner access is permanent and free

`apexinstallationsok@gmail.com` always passes the subscription gate. The owner never pays for their own app.

- **Netlify** (`apexmeasurepro`, serves measure.apexinstallationsok.com): `ADMIN_EMAILS` must always contain `apexinstallationsok@gmail.com`. Other emails may be added; this one is never removed.
- **Supabase** (`apex-measure-pro`): `public.admin_emails` must always contain `apexinstallationsok@gmail.com`.
- Any new gating code path (Stripe check, Supabase entitlement, offline cache) must keep an owner bypass. If a change would lock the owner out, stop and flag it.
- Never put real secrets or the admin list's full contents in the repo or in logs.

## 2. Email

- Outbound email is sent through **Resend** from `mail@apexinstallationsok.com` (domain `apexinstallationsok.com`, DNS on Netlify DNS).
- Replies go to the owner's Outlook mailbox via the `Reply-To` header. No MX / inbound mail is configured on the domain.
- A Netlify-routed address is not needed to send through Resend.
- See `docs/EMAIL-SETUP.md`.

## 3. Locked app logic

Capture flow (arm/lock/advance timing), `reduce.js` flooring to 1/8", subscription-gating logic, and Excel export mapping are locked. Style them; don't rewire them. `node apex-measure-pro_1/reduce.test.js` must pass after any change.
