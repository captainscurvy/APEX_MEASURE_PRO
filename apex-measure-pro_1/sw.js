/* Apex Measure Pro service worker — makes the app work fully offline.
   Cache-first for the app shell; runtime-cache same-origin GETs AND the Google
   Fonts used for the Apex look (so type survives offline after first load);
   fall back to the app on navigation when offline. Bump CACHE to force update. */
var CACHE = "apex-measure-pro-v1";
var ASSETS = ["./", "./index.html", "./reduce.js", "./exceljs.min.js",
  "./manifest.json", "./icon-192.png", "./icon-512.png", "./logo-mark-512.png"];
var FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request).then(function (hit) {
      return hit || fetch(e.request).then(function (res) {
        var copy = res.clone();
        try {
          var u = new URL(e.request.url);
          var isFont = FONT_HOSTS.indexOf(u.host) !== -1;      // opaque responses are fine to cache
          if ((res.ok && u.origin === self.location.origin) || isFont) {
            caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
          }
        } catch (_) {}
        return res;
      }).catch(function () {
        return e.request.mode === "navigate" ? caches.match("./index.html") : Promise.reject();
      });
    })
  );
});
