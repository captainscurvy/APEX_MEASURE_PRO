/* Apex Measure Pro service worker — offline-first.
 * Bump CACHE manually on EVERY release, or updates never reach installed users.
 * No skipWaiting(): a new worker waits and takes over on the next cold start,
 * so an in-flight job is never interrupted by a reload (§13.4). */
const CACHE = "apex-measure-v2.1.0-saas1";

const PRECACHE = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/tokens.css",
  "./css/app.css",
  "./css/brand.css",
  "./css/saas.css",
  "./css/polish.css",
  "./js/reduce.js",
  "./js/capture.js",
  "./js/store.js",
  "./js/profile.js",
  "./js/sheet.js",
  "./js/boot-theme.js",
  "./js/boot.js",
  "./js/config.js",
  "./js/ext.js",
  "./js/ble.js",
  "./js/native-bridge.js",
  "./js/transport.js",
  "./js/plans.js",
  "./js/backend.js",
  "./js/ui-legal.js",
  "./js/account.js",
  "./js/sync.js",
  "./js/voice.js",
  "./js/native-speech.js",
  "./js/ui-voice.js",
  "./js/sound.js",
  "./js/ui-team.js",
  "./js/ui-orders.js",
  "./js/main.js",
  "./vendor/exceljs.min.js",   // lazy-loaded on first export, but precached so export works offline
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./LICENSE",
  "./NOTICES"
];

// Files a brand layer adds (fonts, artwork). Empty in the base build.
const BRAND_ASSETS = [
  "./fonts/archivo-latin-var.woff2",
  "./brand/hero.webp",
  "./brand/renders/hero-3d-1800.webp",
  "./brand/wordmark-on-dark.svg",
  "./brand/mark-on-dark.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE.concat(BRAND_ASSETS))));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(req, { ignoreSearch: req.mode === "navigate" }).then((hit) => {
      if (hit) return hit;
      return fetch(req).catch(() =>
        req.mode === "navigate" ? caches.match("./index.html") : Response.error()
      );
    })
  );
});
