// Service worker — Voxel Warlock Brawl Arena.
// Strategy: network-first for the app shell (a new deploy always wins),
// cache-first for small same-origin static assets. Non-GET requests and any
// cross-origin request (Supabase, the PeerJS signaling broker, the
// unpkg/esm.sh/jsdelivr import-map CDNs, analytics) are never intercepted —
// they fall straight through to the network.

// Bump this on any deploy that changes a precached/cacheable file. It also
// names the cache, so activate() can garbage-collect every older version.
const SW_VERSION = "2026-07-10-1";
const CACHE_NAME = `warlock-arena-${SW_VERSION}`;
const CACHE_PREFIX = "warlock-arena-";

// Minimal app-shell precache. The big character/mob GLBs under
// assets/characters and assets/mobs are deliberately excluded — they're huge
// and are better left to the browser's own HTTP cache than duplicated here.
const PRECACHE_URLS = ["/", "/index.html", "/src/style.css", "/src/main.js"];

// Same-origin request paths eligible for the cache-first runtime strategy.
// Anything not matched here (GLBs, audio, Meshy assets, etc.) is fetched
// straight from the network with no caching at all.
const CACHEABLE_PATTERNS = [
  /^\/src\/[\w-]+\.js$/,
  /^\/site\.webmanifest$/,
  /^\/favicon(-\d+x\d+)?\.(ico|svg|png)$/,
  /^\/apple-touch-icon\.png$/,
  /^\/icon-(48|192|512|512-maskable)\.png$/,
];

// Skip caching any response bigger than this, even if its path matched above
// — a safety net against accidentally runtime-caching something huge.
const MAX_CACHEABLE_BYTES = 5 * 1024 * 1024;

function isCacheableStaticAsset(pathname) {
  return CACHEABLE_PATTERNS.some((re) => re.test(pathname));
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Non-GET (POST/PUT/PATCH to Supabase, etc.) is never intercepted.
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Cross-origin requests are never intercepted — Supabase, the PeerJS
  // broker, the CDN-hosted three.js/@supabase-js/QRCode modules, and any
  // analytics beacon all need to hit the real network directly.
  if (url.origin !== self.location.origin) return;

  // Navigations and index.html itself: network-first, so a fresh deploy is
  // always what players get; fall back to the cached shell when offline.
  if (request.mode === "navigate" || url.pathname === "/index.html") {
    event.respondWith(networkFirst(request));
    return;
  }

  // Small same-origin static assets: cache-first for instant repeat loads.
  if (isCacheableStaticAsset(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Everything else (character/mob GLBs, audio, Meshy assets, Supabase config
  // shim, etc.) is left completely alone — plain network fetch, no
  // interception, so the browser's own HTTP cache handles it.
});

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    await maybeCache(request, response.clone());
    return response;
  } catch (err) {
    const cached = await caches.match(request, { cacheName: CACHE_NAME });
    if (cached) return cached;
    // Fully offline and this exact URL was never cached — fall back to the
    // precached shell rather than a hard network error.
    const shell = await caches.match("/index.html", { cacheName: CACHE_NAME });
    if (shell) return shell;
    throw err;
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request, { cacheName: CACHE_NAME });
  if (cached) return cached;
  const response = await fetch(request);
  await maybeCache(request, response.clone());
  return response;
}

async function maybeCache(request, response) {
  if (!response || !response.ok) return;
  const len = Number(response.headers.get("content-length") || 0);
  if (len > MAX_CACHEABLE_BYTES) return;
  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response);
}
