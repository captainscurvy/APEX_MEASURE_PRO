# Apex Measure Pro

Laser-measuring PWA for **Apex Installations LLC**. It pairs with a **Leica DISTO D2** over Web Bluetooth, floors every reading to the nearest **1/8"** (never rounds up), labels each opening by room and IB/OB mount, and exports a branded Excel estimate — all offline-first and installable to the home screen.

**Live:** https://measure.apexinstallationsok.com

---

## What it does

- **Bluetooth capture** — reads the Leica DISTO D2 measurement characteristic (little-endian float32, meters) over Web Bluetooth and files each shot into the armed cell.
- **Arm → shoot → lock → advance** — tap a Width or Height cell to arm it, take the shot, and after a 3-second window the value locks and focus auto-advances. **Full tier (laser):** Width → Height → next line's Width → …, appending a fresh line after the last one's Height. **Manual tier ($15/mo) only:** Width → Height → next line's **Room name** (no timer — you type at your own pace) → that line's Width → …, so you name the room you're about to measure before you measure it.
- **Manual entry** — the ✎ button lets you type a value by hand (`34 7/8`, `7/8`, `34.875`, or `34`); it runs through the same lock/advance flow as a laser shot. The ✕ button clears a cell.
- **Floors to 1/8"** — the one safety-critical operation, isolated in `reduce.js` and unit-tested. A reading exactly on an eighth passes through unchanged; everything else floors down, matching how custom window treatments are ordered.
- **Branded Excel export** — one tap produces a styled, print-ready `.xlsx` estimate (header band, embedded logo, per-line rows, product/control dropdowns, totals formulas, terms + signature block). A separate **blank template** export is also available.
- **Offline-first** — a service worker caches the app shell and fonts, so capture, job building, and export all work with no signal. Job data lives only on the device.

## How the math works

`reduce.js` is the single source of truth and is intentionally never forked — the browser loads it via `<script src>` and the test suite requires it under Node, so what ships is what's tested.

```
laser reading (meters, over BLE)
  → convert to inches (× 39.3701)
  → floor to the nearest 1/8"   (never rounds up)
  → a value exactly on an eighth passes through unchanged
```

Canonical example: `34.90625"` (34 29/32") → **34 7/8"**.

## Subscription gating

Access is verified by billing email against Stripe via a Netlify function (`/.netlify/functions/check-access`), backed by a shared verifier (`netlify/functions/_verify.js`) also used by `save-job.js` and `list-jobs.js`:

- Identity is the **subscription email** — no separate accounts or access codes.
- A successful check is cached with a **5-day offline grace window**, so the app keeps working without signal.
- **Tiers:** each Stripe price maps to a tier — `price_1TtpDt...` → `full` (Laser, $29/mo), `price_1TvGKA...` → `manual` ($15/mo). An unrecognized price fails toward the more restrictive `manual` tier.
- **Admin emails** (`ADMIN_EMAILS`, comma-separated) bypass the Stripe lookup entirely and always resolve to tier `full`. **`apexinstallationsok@gmail.com` is hardcoded into `_verify.js` in addition to the env var** — it is always an admin even if `ADMIN_EMAILS` is ever cleared or misconfigured. Additional tester emails live only in the env var and can be added/removed freely.
- **Admin tier-preview toggle:** admins can pass `previewTier: "full"|"manual"` to `check-access` (there's a UI toggle for this) to see the app render as that tier would — access never actually locks, this only changes what's *displayed*.
- **Device cap:** non-admin subscribers are capped at 5 distinct devices per email per rolling 30 days, tracked in Netlify Blobs (`device-tracking` store). A 6th device returns `status: "device_limit"` without calling Stripe.
- When locked, Bluetooth is disconnected so no stray shots land — **no local job data is ever deleted**.

> The gating is presentational plus a BLE disconnect; it never touches the capture, reduce, or export logic.

## Job History

Subscribers who export a priced job can see it again from any device signed into the same email. Right after a successful **priced** export (never the blank template), the client fires a non-blocking `POST /.netlify/functions/save-job` with a lightweight summary (job name, date, room count, room names — not the full workbook). `list-jobs.js` reads it back for the **History** panel. Storage is Netlify Blobs (`job-history` store), capped at 200 jobs per email (oldest dropped first). If saving fails, the export itself is untouched — it already succeeded.

## Data & privacy

All job data is stored **on-device only**, in IndexedDB. There is no cloud database, no sync across devices, and nothing about your jobs or measurements leaves the phone unless you export and send a file yourself. Bluetooth is used solely to talk to the Leica DISTO D2.

## Hardware compatibility

Built and tested on the **Leica DISTO D2**. Because Web Bluetooth can only reach Leica's *Bluetooth Smart* (BLE) generation, it is expected to work with the rest of that family (D1, D110, X3, X4, D510, D810 touch, S910) — not independently verified on those models yet. It does **not** work with older "Bluetooth Classic" Leica models, or with other brands (each uses its own proprietary protocol). Not affiliated with, endorsed by, or sponsored by Leica Geosystems AG.

---

## Project structure

```
index.html                     App shell, styling, and all UI/capture logic
reduce.js                      Meters → floored-eighths conversion (safety-critical, do not fork)
reduce.test.js                 Node unit tests for reduce.js
exceljs.min.js                 Vendored ExcelJS (branded export, no CDN dependency)
sw.js                          Service worker (offline shell + font caching)
manifest.json                  PWA manifest
icon-192.png / icon-512.png    App icons (any + maskable)
logo-mark-512.png              Logo mark used in the header and Excel export
netlify.toml                   Netlify config (static publish + functions bundler)
package.json                   Function dependencies (stripe, @netlify/blobs) — installed
                               fresh at build time; never commit node_modules.
netlify/functions/
  _verify.js                   Shared subscription/tier/admin verifier — used by all three
                               functions below. STRIPE_SECRET_KEY is read from env, never
                               hardcoded. Do not fork this logic between functions.
  check-access.js              Subscription + tier check, device-cap enforcement (Blobs).
  save-job.js                  Saves a job summary to history after a priced export.
  list-jobs.js                 Reads a subscriber's job history for the History panel.
```

## Local development & tests

No build step — it's a static single-page app. Serve the folder over HTTPS (Web Bluetooth requires a secure context) and open it in Chrome on Android to use the laser.

Run the tests with Node:

```bash
node reduce.test.js
node netlify/functions/_verify.test.js    # needs: npm install (stripe, @netlify/blobs)
```

`_verify.test.js` covers the admin/master-email and tier-preview logic without needing a live Stripe connection — real Stripe lookups still need a smoke test against the actual account once deployed. The capture flow (arm/lock/advance timing, including the manual-tier Room-name step), the subscription-gating logic, and the Excel export data mapping are treated as locked — style them, don't rewire them without updating this doc.

## Deployment (Netlify)

The site deploys to Netlify as a static publish plus one serverless function.

1. Deploy the folder. The subscription function needs bundling, so use a **Git-connected build** or the **Netlify CLI** (`netlify deploy`) — a plain drag-and-drop will not bundle the function's dependencies.
2. Set environment variables (Netlify → Project configuration → Environment variables, Functions scope enabled):
   - `STRIPE_SECRET_KEY` — Stripe live secret key (`sk_live_…`)
   - `ADMIN_EMAILS` — comma-separated admin emails that bypass the Stripe check
3. Web Bluetooth is enabled via the `Permissions-Policy: bluetooth=(self)` header in `netlify.toml`.

**Smoke test:** open the site → enter an admin email → unlocks immediately; enter a non-subscriber email → "Subscription inactive" screen.

---

## Ownership & support

© Apex Installations LLC — a working window-treatment installation business in the Tulsa, Oklahoma area.
Support: **apexinstallationsok@gmail.com**
