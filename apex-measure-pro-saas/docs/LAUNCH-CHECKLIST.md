# Launch checklist — what only you can do

## Accounts to create (none are needed to try the app in demo mode)
1. **Supabase** (free tier to start): create a project → run `supabase/schema.sql` → set an email template with `{{ .Token }}`
   and a production SMTP sender → put the project URL + anon key in `js/config.js` (`backend`). Follow `supabase/README.md`.
2. **Stripe**: create 3 recurring Prices (Manual / Laser / Crew), 3 Payment Links (14-day trial), the **Customer Portal** (this is the
   working "cancel anytime" button) → put the links in `js/config.js` (`billing`). Deploy `supabase/functions/stripe-webhook`
   and set secrets `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PRICE_MANUAL`, `PRICE_LASER`, `PRICE_CREW`.
3. **Apple Developer Program ($99/yr) + a Mac** — only when you're ready to ship the iPhone laser (`native/README.md`).
4. **Hosting** for the static files (Netlify, Cloudflare Pages, etc.) with your domain; edit the CSP `connect-src` in `_headers`.

## Decisions / content
- **Crew $39 is locked** and has a live Stripe Payment Link in config.js (price_1UN1Ow…, 14-day trial, qty min 2). Manual $15 / Laser $29 still need Prices + links in `js/config.js` → `plans`.
- **Attorney review** of both legal drafts; fill `[REFUND POLICY PLACEHOLDER]` and `[ATTORNEY TO CONFIRM]` (Oklahoma venue/arbitration).
- Set `ApexConfig.iosBluetoothShipped = true` ONLY after a real-device test (`native/TEST-PLAN.md`).
- Discover the D2's remote-trigger command with `tools/ble-probe.html` on real hardware (`TRIGGER_COMMAND` is still null).

## Known limitations
- Never run against live Supabase/Stripe; first end-to-end test with Stripe **test mode** is mandatory.
- Local job deletes don't sync to teammates (documented); ownership transfer UI not built.
- Photo bytes may linger in Supabase Storage until its cleanup (guaranteed purge needs a scheduled function).
- Voice uses the device recognizer (on-device where the browser reports it ready, otherwise the browser speech service which may need internet). The native wrapper uses the OS recognizer; untested until an Apple device is available.
- Client-side gating can always be bypassed locally; the server (RLS + webhook) is the real gate for sync/team.
- Hero re-rendered (v2.1) with depth of field, mirror floor and bokeh; re-run `brand/blender/apex_point.py` to tweak.
