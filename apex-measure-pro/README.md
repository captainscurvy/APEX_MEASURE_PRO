# Apex Measure Pro

## 1. What it is

A laser-measurement capture app for window-treatment professionals. It connects to a Leica DISTO
over Bluetooth, records every width and height shot exactly as taken, orders the **smallest reading
floored to the nearest 1/8 inch**, and produces a completed measure sheet (.xlsx or PDF). It records
inside mount (IB) or outside mount (OB) and never applies manufacturer deductions. No accounts, no
server, no tracking. Everything stays on the device.

## 2. Platform support

| | Bluetooth laser capture | Manual entry, sheets, everything else |
|---|---|---|
| Android — Chrome / Edge | ✅ | ✅ |
| Windows / macOS / Linux / ChromeOS — Chrome / Edge | ✅ | ✅ |
| iPhone / iPad — any browser (Chrome for iOS included) | ❌ no Web Bluetooth on iOS | ✅ |
| Firefox, Safari (desktop) | ❌ no Web Bluetooth | ✅ |

iOS has no Web Bluetooth in any browser. That isn't a permissions problem and there's no workaround.
The app detects this and runs in manual-entry mode with a one-time notice.

Verified hardware: **Leica DISTO D2** only (see §7).

## 3. How to deploy

Zip this folder and drag it onto Netlify (app.netlify.com → Sites → drag and drop). That's the whole
release process. There is no build step, no `npm install`, no functions. `_headers` sets
`Permissions-Policy: bluetooth=(self)` and makes sure `sw.js` is always re-checked.

**Before every release, bump the cache key in `sw.js`** (see §5).

## 4. How to run locally

Open `index.html`. Double-clicking works: the app runs from `file://` (Bluetooth from `file://`
has been verified on Windows Chrome and Android Chrome). The service worker doesn't run from
`file://`. It isn't needed there, because the files are already on disk.

To test the installed-PWA path locally, serve the folder over http, for example
`npx http-server -c-1 .`, and open `http://localhost:8080`.

**Why classic scripts and not ES modules:** Chrome blocks ES-module imports from `file://` (CORS,
origin `null`), which would break the open-from-disk path. So every file under `js/` is a plain
script that registers one global (`ApexReduce`, `ApexCapture`, …) and also exports through
`module.exports` for Node. Still no bundler and no build: the files you edit are the files that ship.

### Tests

```
node --test                  # pure modules: reduce, capture, store (model/validation), sheet, contrast
```

Then open `tests/browser.html`, from disk or served, for the browser suite: BLE reconnect against a
fake DISTO, IndexedDB, and memory-only mode.

- `js/reduce.test.js` — every §4.3 vector, every §5.2–5.4 format example, property tests (never
  rounds up, fractions reduced, smallest-wins), and every exact eighth from 0" to 400" through the
  real float32 wire format.
- `js/capture.test.js` — every §7.2 auto-lock edge case, the §7.1 field order, and the shot cap.
- `tests/store.test.js` — model, labels, completeness, migrations, and each of the six §14.3 import
  failures.
- `tests/sheet.test.js` — the §9.1 sheet from the default config, the Depth column vanishing, the
  forced attribution, unknown keys, and an .xlsx round-trip.
- `tests/contrast.test.js` — the §11.3 contrast table, recomputed from `css/tokens.css`. **Re-run
  it after changing any token.**
- `tests/browser.html` — disconnect → reconnect → readings resume; "connected" shown only after
  subscribing; the backoff schedule; pause while hidden; manual Reconnect; the trigger gate;
  multi-tab detection; IndexedDB; memory-only mode.

### A note on float32

The DISTO sends metres as a 4-byte float. Widened to a JS number, 914.4 mm (exactly 36") arrives as
`0.91439998…` m = 35.9999993", which would floor to 35 7/8" while the laser's own screen says 36".
`reduce.js` therefore converts a laser reading through the float32's **canonical decimal** (the
shortest decimal that encodes to the same 4 bytes) before converting to inches. The reading itself is
unchanged: it is the same float32. `floorEighth` is exactly the §4.1 function, and the never-rounds-up
property holds. The test suite pushes every exact eighth from 0" to 400", and every 0.1 mm from 0 to
5 m, through the wire format.

## 5. Offline behavior

Everything works with the network off, **including Excel export**. There are no CDN links, web fonts
or remote assets, and the network tab shows zero external requests.

- `sw.js` precaches the app shell, CSS, every `js/` file, the manifest, the icons, and
  `vendor/exceljs.min.js`.
- ExcelJS is **not parsed at startup**. It's loaded on the first export, from the service worker
  cache, so a first export with no signal still works.
- **Updating:** change `const CACHE = "apex-measure-v1.2.0"` at the top of `sw.js` on every
  release. Old caches are deleted on activate. A new version waits and applies silently on the next
  cold start. No `skipWaiting()`, no update prompt, so a job in progress is never interrupted.

Data lives in IndexedDB on the device. If IndexedDB is blocked (private browsing, storage disabled),
the app runs in memory-only mode and shows a banner saying so. Export a backup (.json) from a
project's page. Backups include photos.

## 6. Vendored dependencies and their file sizes

Measured, not estimated:

| File | Bytes | Notes |
|---|---:|---|
| `vendor/exceljs.min.js` | **947,702** (925.5 KiB) | ExcelJS 4.4.0 browser bundle, MIT. Write-only. Lazy-loaded, precached. |

That's the only third-party code. The whole folder is about 1.2 MB, most of it ExcelJS. See
`NOTICES` for attributions.

## 7. The two gated unknowns

These are physical unknowns, not missing features. **Do not invent values for either.**

**1. The remote-trigger command bytes.** The D2 exposes a writable characteristic, so app-initiated
measurement is possible, but the byte sequence that fires it isn't known. The app finds the writable
characteristic by discovery, never by a hardcoded UUID. The Measure button renders only when
`canTrigger()` is true, and that needs `TRIGGER_COMMAND` in `js/ble.js` to be non-null. It's `null`,
so the button never appears.
*To resolve:* open `tools/ble-probe.html` in Chrome, connect to the D2, press **Subscribe** on the
measurement characteristic (`3ab10101…`), then use **Write** on the writable characteristic to send
single-byte candidates (`00`, `01`, …) while watching the log for a NOTIFY carrying a distance. When
one works, set `TRIGGER_COMMAND = [0x..]` in `js/ble.js`. That one constant is the only change.

**2. Which other DISTO models expose this service.** Only the D2 is verified. For any other model,
open `tools/ble-probe.html`, connect, and check whether service `3ab10100-f831-4395-b29d-570977d5bf94`
appears with notify characteristic `3ab10101…` delivering little-endian float32 metres. Use
**Copy report** to keep a record. Confirm each model with the probe rather than assuming it works.

## 8. License

MIT. See `LICENSE`. Third-party notices are in `NOTICES`.

## 9. No warranty

This is free software provided **as is, without warranty of any kind**. There is no support
agreement. Check critical measurements before ordering product. The default terms text on the sheet
is a plain-language measurement disclaimer, not legal advice. Review it before relying on it
commercially.

---

### Owner defaults (swap any time, no code change)

| Item | Where |
|---|---|
| Base sheet layout | `DEFAULT_PROFILE` in `js/profile.js` |
| Terms text | `DEFAULT_TERMS` in `js/profile.js`, or per company in Profile Setup |
| `controlType` list | `CONTROL_TYPES` in `js/store.js` |
| Icon mark | replace the three PNGs in `icons/` (`tools/icon-maker.html` regenerates the default from the tokens) |

### Project structure

```
index.html              shell; feature detection (§14.4); loads js/ in order
manifest.json  sw.js  _headers
css/tokens.css          every colour and metric — nothing hardcoded elsewhere
css/app.css
js/reduce.js            1/8" math + all display formats (pure)
js/capture.js           arm/lock/advance state machine (pure, DOM-free)
js/store.js             data model, IndexedDB + memory fallback, migrations, import validation
js/profile.js           sheet config object, header paste, logo import
js/sheet.js             config-driven .xlsx + preview/print generator
js/ble.js               GATT, reconnect, trigger gate, multi-tab
js/main.js              views and wiring (the only DOM code)
vendor/exceljs.min.js   committed, not installed
icons/                  icon-192, icon-512, icon-maskable-512
tools/ble-probe.html    developer tool (§18)
tools/icon-maker.html   regenerates the default icons from tokens.css
tests/                  Node tests + browser.html
LICENSE  NOTICES  README.md
```
