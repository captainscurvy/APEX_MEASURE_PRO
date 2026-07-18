# Apex Measure Pro — Continuity / Handoff Doc
*Paste this as the first message in a new chat. Supersedes the 2026-07-11 project log — everything below reflects the real, current state as of this handoff.*

---

## 1. Locked decisions (unchanged, do not re-litigate)
- **Platform:** Android. Web Bluetooth PWA (open a URL, Add to Home Screen). No native build.
- **App name/brand:** **Apex Measure Pro, by Apex Installations LLC — CONFIRMED FINAL for now.** A future neutral-brand split for industry-wide sale is a real possibility discussed and explicitly parked, not a near-term plan (see §7).
- **Host:** Netlify. Live subdomain: **measure.apexinstallationsok.com** (confirmed live and working by the user).
- **Build environment:** Claude Code desktop for app code. Chat/Cowork for planning, Stripe/Netlify config, and anything needing direct tool access (Stripe API, browser).
- **Display format:** fractional inches, e.g. `34 7/8"`.
- **The math — reduce only:** floor to nearest 1/8", never round up. `reduce.js` is the single source of truth, untouched throughout this entire session, verified clean.
- **D2 Bluetooth facts:** Leica custom service `3ab10100-…`; measurement char `3ab10101-…` (little-endian float32, **meters**); units flag `3ab10102-…`. **Leica DISTO D2-specific only** — hardcoded to Leica's proprietary BLE protocol. Confirmed via research: no universal Bluetooth-laser standard exists; other brands (Bosch, Kobalt, etc.) use their own proprietary protocols and would require separate, real integration work to support.
- **Data model:** offline-first, no accounts except the subscription email. All job data lives in IndexedDB, on-device only, no cloud backup, no sync across devices. This is a stated, disclosed tradeoff, not an oversight.

---

## 2. What's actually LIVE right now (verified by direct code review of the real deployed zip, not assumption)
- **Full rename complete:** title, header, manifest (`name`/`short_name`), Excel export (title block + both filenames), service worker cache key (`apex-measure-pro-v1`), README. Nothing missed.
- **Auto-lock/auto-advance capture flow**, fully verified in actual code:
  - 3-second lock timer on any value landing in an armed field (laser shot OR manual ✎ entry, treated identically)
  - Sequence: Width → Height → next line's Width → … → locking the **last line's Height auto-creates a new line** and arms its Width (confirmed correct per the user's explicit correction earlier in this project)
  - Locked cells: distinct visual state, still editable via ✕ (clear) and ✎ (manual) without needing to re-arm first; tapping a locked cell re-arms it
  - Manually tapping a different cell mid-sequence breaks the fixed path; auto-advance resumes from wherever the user actually is, not a pre-planned route
- **Post-export clean slate:** `startFreshAfterExport()` fires only on the priced-export path (never the blank template), only after confirmed successful download. Old job stays saved in IndexedDB, just no longer the active one — nothing is deleted.
- **Subscription gating**, fully verified in actual code:
  - Identity = billing email (not a custom access code — simplified from the original plan)
  - 5-day offline grace period once a cache exists from a prior successful check
  - Admin bypass via `ADMIN_EMAILS` env var, checked server-side before any Stripe call
  - Locked state disconnects Bluetooth (prevents stray shots on a dead subscription) and does NOT delete any local job data
  - `PORTAL_URL` constant is still blank — self-documented as a known gap in the code
- **reduce.js, sw.js, manifest.json** — all verified clean and correct via direct code read, matching spec exactly.

---

## 3. Stripe — live objects, real IDs (already created, do not recreate)
- **Account:** `acct_1TrGKd0MKeVG0xOt` — Apex Installations LLC, **live mode**
- **Product:** `prod_UtcSiEOh8jcVBP` — "Apex Measure Pro — Company Subscription"
- **Price:** `price_1TtpDt0MKeVG0xOtxVUx7BUd` — $29.00/month USD, flat rate
- **Payment Link (live, actively shareable):** `https://buy.stripe.com/9B64gr1UB60z9Gf2MjcAo00` — 14-day trial, card required upfront. Confirmation message has been corrected to say "use the same email in the app" (an earlier version incorrectly promised a nonexistent access code — that's fixed now).
- **Netlify env vars set:** `ADMIN_EMAILS=apexinstallationsok@gmail.com`; `STRIPE_SECRET_KEY` was set directly by the user (never pasted into any chat, by design).
- **Support contact, confirmed:** apexinstallationsok@gmail.com

---

## 4. Confirmed still-open items (nothing built yet on these)
- **New logo integration — BLOCKED, unanswered question:** does the user have a transparent-background and/or dark-background version of the new "A" mark (uploaded file was `apex_icon_reversed_v1.png`, cream background)? Icons (`icon-192.png`, `icon-512.png`, `logo-mark-512.png`) currently still show the OLD "eye of blinds" bronze-slat design. **Ask this again before any icon-swap prompt gets written.**
- **Antigravity delegation for the logo swap** — user wants to hand this specific, scoped task to Antigravity (a separate agentic coding tool they also use) rather than Claude Code. Not yet drafted. Must carry the same "do not touch reduce.js / capture logic / gating logic" guardrail as every other prompt in this project, and the resulting output should be verified afterward the same way this session verified a prior Antigravity code review — that review contained two confirmed factual errors when checked against the real code (a fabricated worked-example calculation, and a claimed "Area" export column that doesn't exist), so don't take its output on faith either.
- **Stripe Customer Portal** not yet enabled in the Dashboard (Settings → Billing → Customer Portal — one toggle). Once enabled, grab the portal URL and fill in the app's `PORTAL_URL` constant.
- **Job History UI** — still doesn't exist. Known gap since the original project log, more urgent now that strangers (not just insiders) will hit it.
- **Accessibility pass** — confirmed real gap. Grid cells and controls are generic `div`/`span` with click handlers, no `tabindex`/`role`/`aria-label`, no keyboard support.
- **Business header info (phone/license #) in Excel export** — user has decided this will be filled in by hand directly in Excel each time, NOT a code task. Deprioritized permanently, not a bug.
- **Legal — Terms of Service & Privacy Policy** — NOT drafted yet. This was the explicit next deliverable when this session ended (user said "This is where we need to focus heavy on to stay out of legal trouble"). Must include: subscription/cancellation terms, the "data lives only on your phone, no cloud backup" disclosure stated plainly, a liability-limiting statement about measurement accuracy (installer remains responsible for verifying critical measurements — see the FAQ language in §6 below, which should carry over into the ToS), and general acceptable-use terms. Caveat to carry forward: Claude is not a lawyer; recommend a cheap professional review before this is truly final, especially before real strangers' money is involved.
- **Sales tax on the SaaS subscription** — explicitly flagged as an "ask an actual accountant" item, not something to guess at. Varies by state, not resolved.
- **Landing/explainer page** — see §6, new this session, not yet built.

---

## 5. Two prompts, fully written, reviewed, READY TO RUN — but explicitly NOT YET ENTERED anywhere (saved by the user in their own notes for safekeeping, pending final review)

### Prompt 1 — gating/security hardening bundle
```
Harden the subscription-gating system. Do not touch reduce.js, reduce.test.js, capture-state.test.js, the auto-lock/auto-advance capture logic, the post-export clean-slate logic, or the Excel export itself.

PART 1 — netlify/functions/check-access.js changes:

1. EMAIL CASE FIX: Stripe's customer email filter is case-sensitive. Before searching, do NOT rely on lowercasing alone to guarantee a match — search using the lowercased email AND, if no match, retry once with the email in its originally-submitted casing (pre-lowercase) as a fallback. Return whichever search succeeds.

2. DUPLICATE CUSTOMER FIX: When listing customers by email, increase the limit from 1 to 10. Iterate over all returned customer records, checking each one's subscriptions for an active/trialing subscription on the known product ID. Only return active:false if NONE of the matching customer records have an active subscription.

3. DEVICE CAP: Accept an additional "deviceId" field in the POST body (a client-generated random string, not tied to any personal info). Track, in a lightweight persistent store (use Netlify Blobs), which distinct deviceIds have successfully checked in against which email over the last 30 days. Cap it at 5 distinct devices per email. If a 6th distinct device attempts to check in for an email that already has 5 devices on file within that window, return { active: false, status: "device_limit" } instead of checking Stripe at all. Do not count the admin-bypass path against this cap. Expose the current device count for an email somewhere I (the admin) can see it later — a simple log line is fine for now, doesn't need a UI.

4. RATE LIMITING: Add basic per-IP rate limiting using the same Netlify Blobs store — cap at 5 requests per minute per IP address (use the standard forwarded-for header Netlify provides). Requests beyond that limit should return HTTP 429 with { active: false, status: "rate_limited" } without calling Stripe.

PART 2 — client-side (main app file):

1. Generate a random deviceId once on first load if one doesn't exist yet (crypto.randomUUID() or equivalent), store it in localStorage, and include it in every check-access call alongside the email.

2. FIRST-OPEN OFFLINE GRACE: If there is no cached status yet AND the device is offline (or the very first check-access call fails for any reason) AND this is a newly-entered email (no prior cache exists), allow the app to function normally for up to 48 hours rather than locking immediately, on the assumption a brand-new subscriber may be somewhere without signal on day one. After that 48-hour window with still no successful check, lock as normal.

3. If check-access returns status "device_limit" or "rate_limited", show a distinct message on the locked screen (not the generic "subscription inactive" message) — something like "This subscription is already active on the maximum number of devices. Contact Apex Installations if you need this raised."

After building: confirm reduce.test.js and capture-state.test.js still pass. Summarize every change, file by file, and the exact Netlify Blobs key structure used for device tracking and rate limiting.
```

### Prompt 2 — real server-side export enforcement
```
Harden Excel export so that a client-side bypass (e.g. manually setting localStorage values) cannot produce a valid export. Currently, export happens entirely client-side using the vendored ExcelJS library with no server involvement — this means the UI lock can theoretically be defeated via devtools. Do not touch reduce.js, reduce.test.js, capture-state.test.js, or the auto-lock/auto-advance capture logic.

APPROACH: Move Excel file generation to a new Netlify Function, e.g. netlify/functions/generate-export.js.

1. This function receives the job data as JSON (line items, room/mount/width/height, job name) plus the subscriber's email and deviceId in the POST body.
2. Before generating anything, it independently re-verifies subscription status the same way check-access.js does (admin bypass, then real Stripe lookup against the known product ID) — do NOT trust any status passed in from the client. If not active, return 403 with no file.
3. If active, build the same styled workbook (header band, meta block, 11-column table, dropdowns, totals formulas, terms/signature block — match the existing exportExcel() layout and styling exactly, including the low-ink white-sheet design and the embedded logo mark) using ExcelJS running in Node inside the function, and return the .xlsx file as a base64 body with the correct content-type headers.
4. Client-side: exportExcel() (priced path only — the blank template export can remain fully client-side and ungated, since it contains no real job data) now POSTs the job data to generate-export.js instead of building the file locally, then downloads the returned file. Keep the existing post-export clean-slate behavior (startFreshAfterExport()) firing only after a successful download from this new server path.
5. If the server call fails (network error, 403, etc.), show a clear error and do NOT trigger the clean-slate behavior — same as today's error handling, just relocated.

This is a bigger change than Prompt 1 — take your time on it, and after building, manually test: (a) a valid admin/active email can still export successfully and the file matches the current styling, (b) an inactive email is rejected by the server even if localStorage is manually tampered with to claim active:true, (c) reduce.test.js and capture-state.test.js still pass.

Summarize every change and confirm the exported file's visual layout is unchanged from before.
```

**Note:** the device cap number in Prompt 1 (5) is already confirmed and correct as written — no edit needed there before running.

---

## 6. Landing page project (new this session, not yet built)

**URL structure, decided ("textbook-clean" version, chosen because nobody has installed the app yet except the admin — no disruption risk):**
- `measure.apexinstallationsok.com/` (root) → **new** landing/explainer page (does not exist yet)
- `measure.apexinstallationsok.com/app/` → the actual working tool, moved as a complete, unmodified unit one folder deeper. Because everything inside already uses relative paths, this move needs **zero changes to any app code** — pure move-and-relink.
- The Netlify Function path is unaffected either way.
- **Follow-up after the landing page lands (not done yet):** update the Payment Link's `after_completion` to redirect straight into `/app/` instead of Stripe's generic hosted confirmation screen.

**Sequencing decided:** subdomain landing page first (direct conversion path, most urgent), then a matching section on the main `apexinstallationsok.com` site second (should reuse most of the same content).

**Page structure agreed as a good length ("decent start, not overwhelming"):**
- Headline: *"Laser to line item. No re-typing, no mistakes."*
- Subheadline: *"Apex Measure Pro connects straight to your Leica DISTO D2, floors every reading to the nearest 1/8", and builds a branded estimate before you've left the driveway."*
- 4 feature bullets (Bluetooth capture, auto-lock, Excel export, offline)
- Trust line — **confirmed direction:** lean into "built by a working install crew." Best version from this session: *"Built by a working install crew — not a software company that's never touched a blind."*
- Price/trial line: $29/month, 14-day free trial, card required, cancel anytime
- Primary CTA: "Start your free trial" → Payment Link above
- Secondary CTA: "Already subscribed? Open the app" → `/app/`
- Full FAQ section (below)
- Screenshot: user will provide later; not a launch blocker, can ship without one initially

**Full FAQ content, drafted this session (ready to use as-is or lightly edit):**

> **What laser does this work with?**
> The Leica DISTO D2, specifically. That's the hardware this is built around today.
>
> **Will it work with my Bosch/Kobalt/other laser?**
> Not currently — this app is built specifically for the Leica DISTO D2's Bluetooth protocol. Other brands would need separate support built for them.
>
> **Where is my measurement data stored? Is it private?**
> On your phone, only. There's no cloud server, no account database — nothing about your jobs or measurements ever leaves your device unless you choose to export and send a file yourself.
>
> **Why does the app need Bluetooth access?**
> Solely to talk to your Leica DISTO D2 laser and receive measurements as you take them. Nothing else uses it.
>
> **What happens if I lose my phone or delete the app?**
> Any job data on that device goes with it — there's currently no cloud backup. Export anything important to Excel before that risk applies.
>
> **Does it work without internet/signal?**
> Yes — capturing measurements, building jobs, and exporting estimates all work fully offline. The app only needs a connection occasionally to confirm your subscription is active, with several days of grace if you're offline when that check would normally happen.
>
> **How does billing work?**
> $29/month per company, flat rate. Every new subscription starts with a 14-day free trial — a card is required upfront, and you won't be charged until the trial ends.
>
> **Can I cancel anytime?**
> Yes, no contract, cancel whenever. *(Needs the real Customer Portal link once enabled — currently a promise without a live mechanism.)*
>
> **Can more than one person on my crew use this?**
> Yes — one subscription, shared under your company's account email, works across your whole crew, up to a reasonable device limit per subscription.
>
> **Do you sell or share my data with anyone?**
> No.
>
> **How accurate is this, and who's responsible if a measurement is wrong?**
> The app floors every reading to the nearest 1/8" and never rounds up, matching how the trade actually orders custom product. Like any measuring tool, it's still on the installer to verify critical measurements before placing an order — this speeds up and reduces errors in the process, it doesn't replace professional judgment. *(This exact framing should also carry into the Terms of Service as a liability-limiting statement.)*
>
> **I found a bug or have a problem — who do I contact?**
> apexinstallationsok@gmail.com
>
> **Is this a real company?**
> Yes — Apex Installations LLC, a working window treatment installation business based in the Tulsa, Oklahoma area.

---

## 6b. Leica hardware compatibility — researched and resolved this session

**Confirmed via Leica's own official "DISTO transfer BT LE" app** (a first-party Leica Geosystems product): Bluetooth Smart (BLE) support is shared across **D1, D110, D2, X3, X4, D510, D810 touch, and S910** — treated as one compatible family by Leica's own software. Independently corroborated by two real competitors: FSS Window Pro (pairs with X3, X4, X6, D5, D2, E7100i, D810, S910) and Aufmaß App (supports the full Leica Disto BLE lineup as one group).

**Important technical distinction, works in Apex's favor for clarity:** Leica has two separate Bluetooth generations — older "Bluetooth Classic" (D330i, D8, D3aBT, "plus", A6) and newer "Bluetooth Smart"/BLE (the list above). **Web Bluetooth — what this entire app is built on — can only ever connect to the BLE generation, period, regardless of anything else.** So the honest, permanent compatibility boundary is: works with Leica's Bluetooth Smart DISTO line (D1, D110, D2, X3, X4, D510, D810 touch, S910); cannot and will never work with the older Bluetooth Classic models; does not currently work with any other brand.

**Status: strong evidence, not yet independently verified.** The app has only ever actually been tested on the specific D2 unit. The above is well-corroborated from three independent sources but has not been confirmed by plugging in an actual D110/X3/X4/etc. **Recommended before wide launch:** get brief hands-on time with at least one other model (tool rental counter, surveying supply shop, anyone in-network) to convert "should work" into "confirmed."

**FAQ language to use (already drafted, ready to paste into the landing page FAQ from §6):**
> **Which Leica DISTO models does this work with?**
> Built and tested on the Leica DISTO D2. Based on Leica's own documented Bluetooth Smart compatibility, it's also expected to work with the D110, X3, X4, D510, D810 touch, and S910 — though we haven't personally verified those models yet. It does not work with older "Bluetooth Classic" Leica models (D330i, D8, D3aBT and similar).
>
> **Will you support other laser brands (Bosch, Kobalt, etc.) in the future?**
> Not currently. Each brand uses its own Bluetooth protocol, so adding a new brand means real, separate integration work — it's possible down the line, but nothing is built or promised yet.
>
> **Why doesn't my data sync across devices?**
> By design — your measurements and job data stay only on the phone that captured them, with no cloud server in between. That's a deliberate privacy and reliability choice, not a missing feature: it means nothing about your jobs is sitting on someone else's server, and the app works fully offline no matter what.
>
> **Is this app accessible if I use a screen reader or can't use a touchscreen easily?**
> We're actively working on this. If you run into an accessibility issue, tell us at apexinstallationsok@gmail.com and we'll prioritize it.
>
> **Is this affiliated with Leica Geosystems?**
> No. Apex Measure Pro is an independent tool built by Apex Installations LLC that connects to Leica DISTO hardware — it is not made, endorsed, or supported by Leica Geosystems AG.

These five should be added to the FAQ list already drafted in §6, positioned near the existing "What laser does this work with?" entry (which should be replaced by the more precise version above).

## 6c. Competitive research — FSS Window Pro, WindowMaker Measure, Aufmaß App (researched this session)

Reviewed for structure/patterns only — no text copied verbatim from any of these, per standard practice; all findings below are paraphrased observations, not quotes.

- **FSS Window Pro** (by Franchise Support Services): cloud-based — all job data stored centrally, not on-device (direct contrast to Apex's local-only model). Subscription-based. Teams join via a 9-digit company code (different mechanism than Apex's shared-email + device-cap approach, but solves the same problem). Has its own web portal for report generation, photo download, and CSV export of measurements.
- **WindowMaker Measure** (by Windowmaker Software Ltd, 40+ years in window/door industry software): free base app + paid "PRO" tier (freemium, not a straight subscription). Apple's own privacy label states the developer collects no data at all — same honest claim Apex is positioned to make. Has a simple, adoptable accessibility commitment: actively working on accessibility, invites users to report issues via a support email. Support contact pattern: dedicated email (measure@windowmaker.com).
- **Aufmaß App** (German competitor): supports five different laser brands in one app (Leica, Stabila, Würth, Reekon, Nedo) — real-world confirmation that multi-brand support is done elsewhere in this exact space, requiring real per-brand integration work each time. Runs a usage-based free trial (25 free measurements, no card, no contract) rather than a time-based trial — a different, lower-friction acquisition model worth knowing about even without adopting it.
- **Leica DISTO transfer (both the classic PC/CAD version and the BT LE Android version)**: Leica's own first-party utility software, not a real competitor as a business — its value here was purely as the definitive source confirming shared Bluetooth Smart compatibility across the Leica DISTO line (see §6b).

**New legal item surfaced by this research — add to the Terms of Service:** every reviewed competitor names Leica's hardware by brand, which is fine and standard — but it comes with a standard companion disclaimer that Apex's ToS should also include: explicit statement that Apex Measure Pro is not affiliated with, endorsed by, or sponsored by Leica Geosystems AG. Costs nothing to add, closes a real trademark-confusion risk.

## 6d. Terms of Service — real section structure, informed by this session's research (not yet drafted as full legal text)

1. Acceptance of Terms
2. Description of Service
3. Subscription, Billing, Free Trial & Cancellation
4. Account & Device Access (the 5-device cap from Prompt 1, shared company email model, what counts as misuse)
5. Data & Privacy (cross-reference to Privacy Policy; restate: local-only storage, no data sale, no cloud sync)
6. Acceptable Use
7. **Measurement Accuracy & Limitation of Liability** — installer remains responsible for verifying critical measurements before ordering custom product; the app is a productivity aid, not a substitute for professional judgment (same framing as the FAQ's accuracy answer in §6)
8. **Third-Party Hardware Disclaimer** — not affiliated with Leica Geosystems AG (new this session, see above)
9. Intellectual Property
10. Termination
11. Changes to These Terms
12. Governing Law (Oklahoma)
13. Contact — apexinstallationsok@gmail.com

Full legal drafting of this content is still the next deliverable, not yet written out in full (still in §4's open items list).

## 7. Bigger strategic context — parked, not urgent, revisit later
- **"Whole industry" ambition is the real long-term goal**, confirmed explicitly by the user. Local Tulsa companies are viewed as partners (they call Apex for install help), not competitors — this materially changes the calculus versus a typical competitive-software situation.
- **Recommended approach (still the standing recommendation):** grow organically under the Apex brand with local partners for now; don't force a brand split yet; revisit a neutral, company-agnostic brand once the pilot has proven durable with real paying strangers, not just local trust relationships.
- **Real named competitors surfaced during research**, for reference if useful later: Fenestra+ (iPad drafting/quoting app, no public pricing found), Fenestratio (manufacturer-scale ERP, CAD$300+/month, wrong category/buyer), FenestraPro (enterprise façade design for architecture firms, wrong buyer).
- **Google Play Store**, for whenever that becomes real: technically possible later via Trusted Web Activity (Bubblewrap/PWABuilder tooling), but Google's own documentation explicitly recommends *against* charging for the download itself, since the underlying PWA must stay open to the internet to function and there's no reliable way to detect install source. The legal/compliance work happening now (Privacy Policy, data disclosure, permissions justification, subscription terms) directly doubles as Play Store prep — that's part of why it's being prioritized now rather than later.

---

## 8. Other confirmed decisions worth remembering
- Sign-in required on every single app open: **explicitly rejected** by the user — leave as-is (silent background re-check on launch is sufficient; the existing design already re-verifies status every time the app opens without forcing re-entry of the email).
- Full OTP/magic-link identity verification: **not wanted.** The user's actual concern was one email getting shared far beyond a normal crew size ("a universal email getting out of control"), not proving individual identity — solved instead via the 5-device cap in Prompt 1, which explicitly allows normal company-wide sharing of one email while capping abuse.
- Auto-advance at the last line: **wraps to a new line automatically** (this was a real correction from an earlier draft — confirm this is what's actually in the deployed code, which it is, verified in §2).
