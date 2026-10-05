# Real-device test plan — iPhone + Leica DISTO D2 (NOT YET RUN)

Nothing here has been verified. Assumed to work like other DISTO iOS apps; unverified.
Record device model, iOS version, D2 firmware, app build, date, and pass/fail per item.

## Setup
- [ ] Build installs on a real iPhone; Bluetooth permission prompt shows the honest text.
- [ ] Denying permission gives a clear message, not a crash or silent failure.

## Pairing and capture
- [ ] "Connect laser" shows the iOS picker listing the D2; selecting it reaches status "connected".
- [ ] 20 shots: every reading lands in the armed field; none duplicated or dropped.
- [ ] Include exact-eighth values (e.g. 34 7/8", 34 29/32" = 34.90625"). Confirm rounding matches the
      typed-value result and the displayed fraction is what the laser shows.
- [ ] Very short (<0.1 m) and long (>20 m) shots behave sanely; nothing over 200 m is accepted.

## Lifecycle
- [ ] Lock the phone for 1 min and unlock: state is correct; reconnect happens or is offered.
- [ ] Background the app 5 min, foreground: reconnects without re-picking the device.
- [ ] Turn the D2 off, wait, turn on: status goes reconnecting then connected and re-subscribes
      (readings flow again). Backoff does not spin the battery while the app is in the background.
- [ ] Walk out of range and back.
- [ ] Airplane mode on mid-session, then off.
- [ ] Bluetooth switched off in Control Centre, then on.

## Multi-device
- [ ] Two phones, one D2: second phone's behaviour is understandable (the D2 holds one link).
- [ ] Phone A disconnect then phone B connect works.

## Regression
- [ ] Manual typing and voice entry still work with the laser connected and disconnected.
- [ ] Sheet export unchanged.

## Open questions
1. Remote trigger: the D2 command that fires a measurement is UNKNOWN. `TRIGGER_COMMAND` is `null`
   in `js/ble.js` and the native laser's `trigger()` always returns false. Use `tools/ble-probe.html`
   (Web Bluetooth, Android/desktop Chrome) against real hardware to discover the writable
   characteristic and command; do not guess.
2. Does the community plugin's `requestDevice({services})` list the D2 reliably on iOS, or is a
   `namePrefix: "DISTO"` filter needed too?
3. Does the plugin surface the disconnect callback promptly when the D2 powers off?
4. Is background BLE needed (bluetooth-central background mode), or is foreground-only acceptable?
5. Units: the D2 sends meters in the measurement characteristic regardless of its display unit; confirm.


## v2.1 additions to test on the first Apple device
- [ ] Voice: tap Voice, speak "thirty four and a half" -> read-back card, "yes" locks. Airplane mode on: still works (on-device).
- [ ] Voice permission prompt text matches Info.plist strings; deny -> typed-entry fallback message shows.
- [ ] Laser: Connect shows the native iOS device picker; DISTO appears; a reading lands in the armed slot.
- [ ] Laser: power-cycle the DISTO mid-session -> app shows "reconnecting" and recovers without re-pairing.
- [ ] Remote trigger (the on-screen Measure button) stays hidden until TRIGGER_COMMAND is discovered with tools/ble-probe.html.
- [ ] Button click sound plays on tap; silent switch respected; Settings toggle turns it off.
