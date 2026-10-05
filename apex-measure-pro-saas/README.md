# Apex Measure Pro — SaaS build (v2.0.0)

Proprietary © Apex Installations LLC. Laser-or-voice measurement capture for window-treatment pros:
floors every reading to the nearest **1/8"** (never rounds up), exports branded sheets (.xlsx / PDF),
works offline, optional cloud sync + team sharing on paid plans.

## Open it right now
Double-click `index.html` (Chrome or Edge). It runs in **DEMO MODE**: no accounts, everything unlocked,
data stays on this device. Add `?mock=1` to the URL on a local/file:// copy to try sign-in, plans and
Team with a fake in-memory server (any email, code `123456`).

## What's in the box
| Feature | Where | Status |
|---|---|---|
| Measuring core (arm → shoot → lock → advance, 1/8" floor, photos, sheets) | `js/reduce.js` `capture.js` `store.js` `sheet.js` | Proven, unit-tested |
| Brand + visual pass | `brand/` `css/brand.css` `css/polish.css` | Done; browser-checked |
| Plans, sign-in, paywall, cancel link, iPhone notice | `js/plans.js` `account.js` | Built; needs your Stripe/Supabase values |
| Terms + Privacy | `js/ui-legal.js` | **DRAFTS — attorney review required** |
| Voice entry (read-back + confirm before saving) | `js/voice.js` `ui-voice.js` | Built; tested with a scripted mic only |
| Hardware-agnostic laser layer | `js/transport.js` | Android/desktop: wraps proven code. iPhone: **under construction** |
| Cloud sync + team sharing | `js/backend.js` `sync.js` `ui-team.js` `supabase/` | Built; SQL tested on Postgres, **never run against real Supabase/Stripe** |
| Order-ready supplier output | `js/ui-orders.js` | Placeholder screen only (waiting on supplier talks) |
| Native iPhone wrapper | `native/` | Written, **untested** (needs Mac, Xcode, Apple Developer account) |

Read `docs/LAUNCH-CHECKLIST.md` before charging anyone. Module rules: `docs/CONTRACT.md`.

## Tests
`node --test` (158 tests) and open `tests/browser.html` for the browser suite.

## Deploy (static)
Drag the folder to any static host. `_headers` carries a strict Content-Security-Policy and permissions policy
(edit the `connect-src` Supabase URL). Production URL: https://app.apexinstallationsok.com (CNAME `app` -> your static host; set the same host in Supabase Auth redirect URLs). Bump `CACHE` in `sw.js` on every release.
