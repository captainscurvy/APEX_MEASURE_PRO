# Apex Measure Pro — "Precision Instrument" Visual & Motion Overhaul

**Date:** 2026-07-18
**Status:** Design — awaiting user approval before implementation planning
**Type:** Visual / UX / motion only (no logic changes)
**Target file:** `apex-measure-pro_1/index.html` (all styling + UI is inline in this single file)

---

## 1. Objective

Make Apex Measure Pro look and feel like a state-of-the-art precision instrument — a $29/month premium tool that clearly outclasses competitors (FSS Window Pro, WindowMaker Measure) that read as decade-old generic business software. The reference language is **high-end camera UI, aviation/marine instrument displays, and premium watch faces** — *not* flat consumer card-and-shadow design, gradient blobs, or glassmorphism.

**Chosen aesthetic direction: Hybrid "A + C" — Avionics-HUD identity on flat, sunlight-legible screens.** The armed cell gets a heads-up-display *reticle-lock* treatment (the signature "wow" moment), rendered on flat blackout screens with high-legibility readouts (camera-viewfinder restraint) so a moving element never competes with the live number. The luxury "machined bezel sheen" (direction B) is held in reserve for non-critical flourishes (BLE connecting, export completion), never on the capture cell.

### Locked tokens (unchanged)
- Colors: bronze `#B08D57` / `#C9A87C` on near-black `#0F0F10`; existing `--panel #16161A`, `--panel-2 #1E1E23`, `--screen #0B0B0C`, `--ink #F5F2EC`, `--muted #A8A29A`, `--line #2A2A2E`, `--good #35c46b`.
- Type: **Sora** (display) + **Inter** (body).

---

## 2. The Safety Contract (how "aggressive" stays non-breaking)

This overhaul is a **skin swap on a frozen skeleton.** The following are out of scope and must be byte-identical / behaviorally identical after the change. Each is re-verified in §9.

**Untouched logic files**
- `reduce.js`, `reduce.test.js` — not edited at all.

**Untouched behavior (in `index.html` `<script>`)**
- Capture state machine: `armCell`, `startLockCountdown`, `lockAndAdvance`, `nextField`, `fileShot`, `commitManual`; `LOCK_MS = 3000`; all lock/unlock/arm/advance conditions and the Width→Height→next-line→append sequence.
- Subscription gating **logic**: `accessLocked`, `runCheck`, `applyGate`, `saveEmail`, grace-window math, admin bypass, and the BLE-disconnect-when-locked. Only the *visual presentation* of the gate overlays changes.
- Excel export **data**: column mapping, formulas, dropdowns, `Reduce.reduceInches` usage, `startFreshAfterExport` timing. Only the button's *animation* changes (§4.6).
- Haptics (`buzz`), wake-lock, service worker registration, IndexedDB, PWA manifest behavior.

**Untouched DOM contract** — the JS reads/writes these; they are preserved exactly (may be restyled and may gain **decorative child/pseudo-elements**, never renamed or removed):
- Structural: `.line`, `.top`, `.no`, `.room`, `.mount`, `.cells`, `.cell`, `.clabel`, `.val` (`.num`/`.den`/glyph), `.raw`, `.edit`, `.clear`, `.minput`, `.lockbar`, `#rows`, `.addrow`.
- State classes toggled by JS: `.armed`, `.counting`, `.locked`, `.empty`, `.editing`, `.flash`, `.armbar.live`, `.armbar.stray`, `#rows.fading`, `#exportBtn.success-anim`.
- Attributes queried by JS: `data-idx`, `data-field`.
- Status: `.dot.on`, `.dot.off`, `.dot.wait`.
- Gate: `.gate`, `.gate.show`, and element IDs `#gateEmail`, `#gateLocked`, `#gateLockedMsg`, `#gateLockedEmail`, `#gateManage`, `#gateEmailInput`, etc.

**Rule of thumb:** the reticle brackets, glows, and sweeps are implemented as **CSS pseudo-elements and transitions on existing elements** wherever possible, so zero JS changes are required and no animation can sit in the capture code path or delay a shot.

---

## 3. Aesthetic system

- **Cell "bezel" (locked decision #1):** replace soft flat rounded rectangles with a recessed hardware-screen look — 5px radius, 1px border, `inset` box-shadow. Flat blackout face (`#0B0B0C`) for sunlight legibility.
- **Numeric readout (locked decision #2):** Inter **500**, `font-variant-numeric: tabular-nums`, `letter-spacing: -0.02em`, subtle bronze `text-shadow` glow. Reads as a calibrated optical readout. **Contrast verified in §7** — the glyph color is fully contrasting; the glow does not reduce it.
- **Signature motion:** the armed cell = HUD reticle brackets (corner L-brackets that scale/fade in) + outer drop-shadow elevation + a low-amplitude **opacity-only** border glow, behind the number. No sweep crosses the digits.

---

## 4. Component & state specification (mapped to locked decisions #1–#8)

### 4.1 Empty cell / blank-job screen (decision #6)
- Per-cell: dim recessed screen, faint bronze `.clabel`, and a single subtle dimmed tick/dot mark. **No** repeated "Ready for Capture" text in each cell.
- Screen level: one calm line of copy on the armbar (e.g. "Ready for capture — arm a Width or Height cell"). Optional (user decision, §10): a faint centered logo watermark behind `#rows` on a fully-empty job.

### 4.2 Armed cell (decision #3)
- Corner reticle brackets fade+scale in via `.cell.armed::before/::after`.
- Outer drop-shadow elevation + `transform: translateY(-1px)` (already present) with smoothed `transition` on focus change (already present at `0.25s cubic-bezier`).
- Border glow breathes on **opacity only**.
- No new DOM; no JS change.

### 4.3 Lock countdown (decision #4)
- Keep the existing `.lockbar` `<i>` tracing the bottom inner edge L→R over `LOCK_MS` (`@keyframes lockcount 3s`). Sharpen the glow and edge; timing unchanged.

### 4.4 Lock snap (decision #4)
- Keep `@keyframes lockSnap` scale-pulse on `.cell.locked`; tighten it. Stays synced to the existing lock (which fires `buzz`). Purely CSS; no timing change.

### 4.5 Filled / locked cell
- Green detent + `✓` on `.clabel::after` (already present); refine to match the instrument look.

### 4.6 Export completion (decision #5)
- `#exportBtn.success-anim` morphs into a glowing bronze checkmark, holds ~800ms while `#rows.fading` fades the new blank job in behind it. **Wraps the existing instant download — never gates or delays it** (the file `a.click()` fires first, unchanged). Reuse a subtle B-style bronze sheen here as the flourish.

### 4.7 BLE indicator (decision #8)
- Connected: breathing glow (`@keyframes breathe`, opacity + box-shadow oscillation) — kept, refined.
- Searching/reconnecting (`.dot.wait`): radar sweep (`@keyframes radar`) — kept, made clearly distinct from connected.
- Connecting handshake: brief B-style bronze sheen flourish.

### 4.8 Gate screens (decision #7)
- `#gateEmail` (first-run) and `#gateLocked` (inactive subscription) rebuilt as **elevated machined cards**: bronze rule, calibrated type, recessed inputs, matching the empty-state polish. These are a paying subscriber's first/recurring impression.
- Preserve distinct visual slots for the future `device_limit` / `rate_limited` messages (text set by JS into `#gateLockedMsg`).

### 4.9 Chrome
- Header, `.armbar`, `.jobbar`, `.mount` select, `.export-btn`, `.template-btn`, `.addrow`, `.foot` restyled into the system. Touch targets preserved (§8).

---

## 5. Motion principles
1. Motion **decorates** instant state changes; it never sits in the capture/lock/advance code path and never delays a shot, lock, or advance.
2. No moving element crosses the live numeric readout.
3. All motion is CSS (keyframes/transitions/pseudo-elements). Respect the existing instant flash/haptic feedback on capture.

---

## 6. Accessibility note
Semantic accessibility (roles/aria/keyboard for the grid cells) is a **known, separate gap** tracked outside this overhaul and is **not** in scope here. This spec covers visual contrast (§7) only. Nothing in this overhaul may make the existing markup *less* accessible.

---

## 7. Contrast — targets, method, and verified numbers

**Target:** WCAG **AA** minimum — 4.5:1 for normal text, 3:1 for large (≥24px/large-bold).
**Method:** WCAG relative luminance with `(L1 + 0.05) / (L2 + 0.05)`, computed against the **actual** surface colors used.

Verified against the `#0B0B0C` cell screen (and `#16161A` panel):

| Element | Color | On `#0B0B0C` | On `#16161A` | AA? |
|---|---|---|---|---|
| Numeric readout glyph | `#F5F2EC` | ~17.7:1 | ~16.2:1 | ✅ AAA |
| Bronze label (`.clabel`) | `#B08D57` | ~6.4:1 | ~5.8:1 | ✅ |
| Bronze-hi accents | `#C9A87C` | higher still | higher | ✅ |

**Resolves the brief's explicit concern:** the numeric readout is weight-500 with a bronze glow, but the *glyph color* `#F5F2EC` contrasts at ~16–18:1; the `text-shadow` is a glow around fully-contrasting glyphs and does **not** pull it toward failure. During build, every final foreground/background pairing (including labels on `--panel`) is re-measured, and anything landing under 4.5:1 is bumped to `--accent-hi`.

---

## 8. Touch-target inventory (must not shrink)

Installers wear work gloves. **No interactive element's padding or `min-height` may decrease.** Baseline to preserve, audited element-by-element in the final report:

| Element | Current baseline to preserve |
|---|---|
| `.cell` | `min-height: 66px` (+ padding) |
| `.export-btn` | `padding: 15px` |
| `.template-btn` | `padding: 13px` |
| `.mini` / connect buttons | `padding: 7px 14px` |
| `.room` input | `padding: 10px 11px` |
| `.mount` select | `width: 78px`, `padding: 10px 6px` |
| `.jobbar input` / `button` | `padding: 11px` |
| `.addrow button` | `padding: 12px`, full width |
| `.edit` / `.clear` hit areas | `28px × 28px` |
| `.minput` | `padding: 8px` |
| Gate inputs/buttons | `padding: 12–13px` |

Visual bezel/glow may extend outward, but the clickable box only grows or stays equal — never shrinks.

---

## 9. Verification plan (reported individually, per the brief)
1. **Run `reduce.test.js`** (`node reduce.test.js` in `apex-measure-pro_1/`) — confirm pass/fail explicitly. (Baseline today: 24 passed, 0 failed.)
2. **State the actual contrast ratio** for the numeric readout against its background (and any pairing that changed).
3. **Confirm element-by-element** that no touch target's clickable area shrank (the §8 table).
4. **Confirm every icon/logo filename reference** is intact and will auto-pick-up the new files (§ below).
5. **List every file modified** (expected: only `index.html`, plus a `sw.js` cache-key bump — see below).

---

## 10. Icon/logo references & service-worker cache

All three filenames the user will overwrite are correctly wired and will pick up the new files instantly:
- `logo-mark-512.png` → header `<img>` **and** the Excel export `fetch("logo-mark-512.png")`.
- `icon-192.png` → favicon **and** apple-touch-icon.
- `icon-192.png` / `icon-512.png` → manifest (`any` + `maskable`); all three precached in `sw.js`.

**Required companion change:** `sw.js` cache key is `apex-measure-pro-v1`. After new icons are dropped, the cache **must** be bumped (e.g. `-v2`) or the service worker will keep serving the old cached icons. This bump is included in the plan (it is the one allowed `sw.js` edit — a version-string change only, no logic).

**Optional gaps (user's call, not required for the swap to work):** manifest declares only 192 + 512; there is no dedicated 180×180 apple-touch-icon (iOS falls back to 192) and no `favicon.ico`. Can be added when the files are dropped if crisp iOS icons are wanted.

---

## 11. Open decisions to confirm at spec review
- **B sheen placement:** used only on BLE-connecting + export completion, *not* the capture cell (recommended for legibility). Flip to include it on the armed cell if maximum flash is preferred over readability.
- **Empty-state presence:** minimal (dim tick + one armbar line). Optional faint centered logo watermark behind an empty job — include or not?

---

## 12. Out of scope (explicitly not part of this overhaul)
- The two saved hardening prompts (gating device-cap/rate-limit, server-side export enforcement).
- `PORTAL_URL` wiring, Job History UI, semantic accessibility, Terms/Privacy, landing page.
- Any change to reduce logic, capture timing, gating logic, or export data.
