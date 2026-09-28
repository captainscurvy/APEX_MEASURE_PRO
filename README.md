# Apex Measure Pro

Laser-measurement capture for window-treatment professionals. It reads a Leica DISTO over Web
Bluetooth, records every shot exactly as taken, orders the smallest reading floored to the nearest
1/8", and produces a completed measure sheet (.xlsx or PDF). No accounts, no server, no tracking.
It works offline, and it runs from disk.

## Where things are

| Folder | What it is |
|---|---|
| [`apex-measure-pro/`](apex-measure-pro/) | **The app, v1.2** — built to the v1.2 build specification. This folder *is* the release: zip it and drag it onto Netlify. See its [README](apex-measure-pro/README.md). |
| `apex-measure-pro_1/` | The previous single-page app (subscription-gated). Kept for reference; not part of v1.2. |

## Quick start

```bash
cd apex-measure-pro
node --test                 # pure-module tests (1/8" math, capture state machine, sheet, store, contrast)
open index.html             # or double-click it — the app runs from file://
```

Browser tests (BLE reconnect with a fake DISTO, IndexedDB, and memory-only mode) are in
`apex-measure-pro/tests/browser.html`.

MIT licensed — see [`apex-measure-pro/LICENSE`](apex-measure-pro/LICENSE).
