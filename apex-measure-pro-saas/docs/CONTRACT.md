# Apex Measure Pro SaaS — module contract

All modules are **classic scripts** (no build, no ES modules; the app must also run opened from disk).
Pure-logic modules use the UMD wrapper seen in `js/reduce.js` so `node --test` can load them
(`module.exports` in Node, `window.ApexXxx` in the browser). DOM-only UI files do not need unit tests.
Never edit a file you don't own. Core app (`main.js`, `index.html`, `sw.js`, `capture.js`, `reduce.js`,
`store.js`, `ble.js`) is owned by the lead — if you need a change there, write it in your report.
Plug into the app ONLY through `ApexExt` (see `js/ext.js` header) and `ApexConfig` (`js/config.js`).
Build helpers: `ctx.h(tag, props, ...children)` is the DOM builder used throughout (see main.js top).
Design tokens: `css/tokens.css`, `css/brand.css` (night/bone/steel, signal orange `#E14E0D` for armed/live only).
Use existing classes (`btn`, `btn-primary`, `btn-block`, `section`, `section-head`, `label`, `list`, `list-row`,
`row-main`, `row-title`, `row-sub`, `banner`, `advisory`, `muted`, `small`, `input`, `form-grid`, `segmented`).

## Owners / files
| Owner | Files |
|---|---|
| plans-account-legal | `js/plans.js`(+test) `js/account.js` `js/ui-legal.js` `js/ui-orders.js` (legal text lives in JS strings) `css/saas.css` (sections marked `/* account */ /* legal */ /* orders */`) |
| backend-sync-team | `js/backend.js`(+test) `js/sync.js`(+test) `js/ui-team.js` `supabase/**` (schema.sql, functions/**) `css/saas.css` (section `/* team */`) |
| voice | `js/voice.js`(+test) `js/ui-voice.js` `css/saas.css` (section `/* voice */`) |
| transport | `js/transport.js`(+test) `native/**` `css/saas.css` (section `/* transport */`) |
| polish | `css/polish.css` `css/tokens.css` (ADD tokens only) `css/brand.css` (append only) |
`css/saas.css` is shared: only edit inside your own marked section (append your section at the end; never touch others').

## ApexConfig (exists) — see js/config.js. `ApexConfig.demo` is true when no backend is configured.

## ApexPlans (owner: plans-account-legal) — pure, UMD
- `platform()` → `{ ios, android, desktop, webBluetooth, native }` (feature-detect; accepts an injected `env` for tests: `platform(env)`)
- `has(feature, state)` → bool. Features: `manual voice photos export laser team`. `state` defaults to `ApexAccount.state()`.
  Demo mode → everything true EXCEPT `laser` when the platform cannot do laser (iOS today) .
- `laserAvailable(platform)` → `{ ok:boolean, reason:"" | "ios-under-construction" | "no-web-bluetooth" }`
- `priceFor(planId, platform)` → `{ cents, note }` — on iOS while `!ApexConfig.iosBluetoothShipped`, `laser` is billed at the manual price (note says why).
- `describePlans(platform)` → array of display-ready plans for the pricing screen.

## ApexAccount (owner: plans-account-legal)
- `state()` → `{ status: "demo"|"signed-out"|"checking"|"ok"|"grace"|"locked", email, plan, entitlement, graceUntil }`
- `refresh()` → Promise (re-checks entitlement via ApexBackend; caches `{entitlement, checkedAt}` in localStorage; offline → uses cache within `offlineGraceDays`)
- `signOut()`, `onChange(fn)` → unsubscribe fn
- Registers: gate (`beforeRoute`) that shows the sign-in / paywall screen when `status` is `signed-out` or `locked` (never blocks `#/terms`, `#/privacy`, `#/plans`, `#/account`; never blocks read access to existing local jobs when merely `locked` — it shows a banner + disables NEW capture/export only), routes `#/account`, `#/plans`, a settings block (plan, manage subscription link = `ApexConfig.billing.portalUrl`, sign out), and the pre-signup iOS notice.
- Locked state NEVER deletes local data.

## ApexBackend (owner: backend-sync-team) — Supabase REST over `fetch` (no SDK), + in-memory mock
- `configured()` → bool (`!ApexConfig.demo`)
- `createMock(opts)` → a full in-memory backend with the same API (used by tests and by `?mock=1` demos)
- Auth: `signInWithEmail(email)` (sends a one-time code), `verifyCode(email, code)` → session `{userId,email,accessToken,refreshToken,expiresAt}`; `session()` (persisted in localStorage; auto-refreshes), `signOut()`
- `getEntitlement()` → `{ plan:"none"|"manual"|"laser"|"crew", status:"none"|"trialing"|"active"|"past_due"|"canceled", currentPeriodEnd:ISO|null, seats:number, orgId:string|null, role:"owner"|"admin"|"member"|"viewer"|null }` — server-derived from the Stripe-webhook-maintained `subscriptions` table; the client NEVER decides entitlement.
- Data: `pushProject(project)`, `pullProjects(sinceISO)`, `deleteProject(id)`, `putPhoto(projectId, photoId, blob)`, `getPhoto(...)`; team: `listMembers()`, `invite(email, role)`, `acceptInvite(code)`, `removeMember(userId)`, `setRole(userId, role)`.
- All calls reject with `Error` having `.code` in: `offline | unauthorized | forbidden | not-configured | conflict | server`.

## ApexSync (owner: backend-sync-team) — pure core + thin runtime
Local-first: IndexedDB stays the source of truth. `onProjectSaved` queues a push (debounced). `pull()` merges by `updatedAt`
(last-writer-wins per project; a project edited on two devices keeps the newer and stores the older as a conflict copy named
"<name> (conflict <date>)" — never silently dropped). Only runs when `ApexPlans.has("team")` and a session exists. Offline queue persists.
Photos sync lazily. Exposes `status()` → `{state:"off"|"idle"|"syncing"|"offline"|"error", pending, lastSyncedAt}`.

## ApexVoice (owner: voice) — pure parser UMD + Web Speech runtime
- `parse(text, {unit})` → `{ ok, inches (raw, may be non-eighth), display, reason }`; fixed grammar, never guesses: "thirty four and seven eighths", "34 7/8", "three quarters", "fifty two and a half", "thirty-four point eight seven five", "two feet three and a half", "eleven sixteenths", "forty one and three sixteenths". Units inches default; feet/inches supported. Word-number homophones handled ("to/too"→2 ONLY inside a number context is NOT allowed — reject ambiguity instead).
- Plausibility window per field kind (default 6"–240" width/height, 0.25"–48" depth); out of range → `ok:false, reason:"out-of-range"` (the UI asks to confirm).
- Look-alike guard: "fifteen"/"fifty", "sixteen"/"sixty", "thirteen"/"thirty", etc. — when the recognizer returns multiple alternatives that parse to different values, `ok:false, reason:"ambiguous", candidates:[…]`.
- Commands: `next`, `back`, `undo`, `clear`, `lock`/`confirm`/`yes`, `cancel`/`no`, `inside mount`, `outside mount`, `left`, `right`.
- Safety contract: a spoken value is NEVER saved without read-back + explicit confirm (voice or tap). The floor-to-1/8" is done by `ApexReduce` only — voice returns the raw inches and the existing capture path (`dispatch({type:"typed"...})`/commit as manual) does the rest. Source recorded as `manual`.
- Runtime uses `SpeechRecognition||webkitSpeechRecognition` with `maxAlternatives`, and `speechSynthesis` for read-back. Must degrade: if unsupported → button hidden + help text. Needs `ApexPlans.has("voice")`.
- `ApexExt.captureTools` button "Voice" on the capture screen.

## ApexTransport (owner: transport) — hardware-agnostic reading layer
- `createLaser(opts)` has EXACTLY the same interface as `ApexBle.createLaser` (see `js/ble.js` + main.js use: `connect, reconnectNow, release, snapshot, trigger?, canTrigger?`; `opts.onReading(meters)`, `opts.onState(snapshot)`; snapshot `{status:"idle"|"unsupported"|"connecting"|"connected"|"reconnecting"|"busy-elsewhere", message, deviceName}`).
- Picks a transport: native Capacitor BLE (iOS/Android shell) → Web Bluetooth (`ApexBle`) → unsupported.
- Device profiles registry (`DEVICES`): `leica-disto-ble` (service `3ab10100-f831-4395-b29d-570977d5bf94`, measurement char `…10101…` float32LE meters) as the only verified profile; the registry shape allows adding other lasers (service/char UUIDs + a `decode(dataView) → meters` function) without touching capture code.
- iOS today (`ApexConfig.iosBluetoothShipped === false`): returns a laser whose snapshot is `{status:"unsupported", message:"iPhone laser support is under construction — type or speak measurements."}` — no connect attempt.
- `native/` holds the Capacitor wiring + iOS Info.plist notes, written but UNTESTED (no Apple dev account/hardware yet) and clearly labelled so.
