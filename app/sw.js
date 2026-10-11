// STEJECT service worker: lets the web version install as an app and open offline.
// Serves the app shell from cache, refreshing it in the background.
// The cache is named after the build, so every deploy starts a fresh one (no manual bump).
try { importScripts("js/build-info.js"); } catch {}
const BUILD = self.STE_BUILD || {};
const CACHE = "steject-shell-" + ([BUILD.version, BUILD.commit || BUILD.built].filter(Boolean).join("-") || "dev");
const SHELL = [
  "./", "index.html", "manifest.webmanifest",
  "css/app.css", "css/fonts.css",
  "js/build-info.js", "js/core.js", "js/safety.js", "js/github.js", "js/ai.js", "js/runner.js", "js/pyworker.js", "js/net.js", "js/networker.js", "js/app.js",
  "preview.html", "starters/starters.js",
  "vendor/jszip.min.js", "vendor/marked.min.js", "vendor/purify.min.js",
  "icons/icon.svg", "icons/icon-32.png", "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png",
  "fonts/big-shoulders-display-latin-700-normal.woff2", "fonts/big-shoulders-display-latin-800-normal.woff2",
  "fonts/public-sans-latin-400-normal.woff2", "fonts/public-sans-latin-500-normal.woff2",
  "fonts/public-sans-latin-600-normal.woff2", "fonts/public-sans-latin-700-normal.woff2",
  "fonts/jetbrains-mono-latin-400-normal.woff2", "fonts/jetbrains-mono-latin-500-normal.woff2",
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return; // never touch API calls
  e.respondWith(caches.open(CACHE).then(async cache => {
    const hit = await cache.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request).then(res => { if (res.ok) cache.put(e.request, res.clone()); return res; }).catch(() => null);
    return hit || (await net) || cache.match("index.html");
  }));
});
