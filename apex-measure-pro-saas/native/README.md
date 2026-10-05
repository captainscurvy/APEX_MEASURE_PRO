# Native iPhone/iPad shell (Capacitor) — WRITTEN BUT UNTESTED

Status: nothing in this folder has been built or run. There was no Mac, no Apple Developer
account and no laser hardware when it was written. It is assumed to work like other DISTO iOS
apps; unverified. At launch iPhone/iPad Bluetooth is "under construction" and
`ApexConfig.iosBluetoothShipped` stays `false`.

## What you need (plainly)
- A Mac with Xcode (current release).
- An Apple Developer Program membership: $99/year. Required to run on a real device beyond
  7-day test installs, and to use TestFlight / the App Store.
- A Leica DISTO D2 (or other BLE DISTO) and an iPhone for testing. The iOS Simulator has no Bluetooth.

## Steps
1. From the project folder (`apex-measure-pro-saas`), in a new npm workspace (e.g. `native-build/`):
   `npm init -y`
   `npm i @capacitor/core @capacitor/cli @capacitor/ios @capacitor-community/bluetooth-le @capacitor-community/speech-recognition`
2. Copy `native/capacitor.config.json` next to that package.json. Make a `www/` folder containing
   only the shipped web files (index.html, js/, css/, icons/, fonts/, vendor/, manifest.json) and set
   `webDir` to `www`.
3. `npx cap add ios`
4. Merge `native/ios/Info.plist-additions.xml` into `ios/App/App/Info.plist`.
5. No bundler needed: `js/native-bridge.js` builds `window.BleClient` from the raw BluetoothLe plugin, and
   `js/native-speech.js` plugs the device's own speech recognizer (Apple SFSpeechRecognizer) into the voice
   feature. Both only activate inside the Capacitor shell. Both are written to the plugins' documented APIs and
   are untested on a device.
6. `npx cap sync ios`, then `npx cap open ios`. Set your Team under Signing & Capabilities, enable the
   Background Modes capability only if you decide to support background BLE (not assumed).
7. Run on a real iPhone. Work through `native/TEST-PLAN.md`.
8. Only after the whole plan passes on real hardware: set `iosBluetoothShipped: true` in
   `js/config.js`, rebuild the web assets, `npx cap sync ios`, then archive for TestFlight.
   Also remove the "under construction" wording on the marketing/signup pages.

## Notes
- Web Bluetooth does not exist in iOS Safari or in WKWebView, so the native plugin is the only route.
- App Store review will want a privacy policy URL and the permission strings above.
- The Android Chrome PWA already works via Web Bluetooth; a native Android build is optional.
