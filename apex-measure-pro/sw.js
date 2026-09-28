/* Apex Measure Pro service worker — offline-first.
 * Bump CACHE manually on EVERY release, or updates never reach installed users.
 * No skipWaiting(): a new worker waits and takes over on the next cold start,
 * so an in-flight job is never interrupted by a reload (§13.4). */
const CACHE = "apex-measure-v1.2.0";

const PRECACHE = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/tokens.css",
  "./css/app.css",
  "./js/reduce.js",
  "./js/capture.js",
  "./js/store.js",
  "./js/profile.js",
  "./js/sheet.js",
  "./js/ble.js",
  "./js/main.js",
  "./vendor/exceljs.min.js",   // lazy-loaded on first export, but precached so export works offline
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./LICENSE",
  "./NOTICES"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)));
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
