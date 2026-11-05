/* Subtext service worker: works offline, and receives things shared to it from other apps.
 *
 * Offline: the app's own files are kept in a cache. Every request tries the network first (so a new
 * version shows up straight away) and falls back to the cached copy when there's no connection.
 * Other sites (the font, the screenshot reader's CDN) are left to the browser.
 *
 * Share menu (Android, installed app): the manifest's share_target posts what was shared to
 * ./share-target. That request never reaches a server: it is answered here, the text and files are
 * kept in an on-device cache, and the app opens at #shared to read them (and then deletes them).
 */
const VERSION = "subtext-v1";
const SHARE_CACHE = "subtext-share";
const APP_FILES = [
  "./", "./index.html", "./app.css", "./app.js", "./data.js", "./parse.js", "./engine.js",
  "./importers.js", "./screenshots.js", "./charts.js", "./manifest.webmanifest",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/maskable-512.png", "./icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== SHARE_CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === "POST" && url.pathname.endsWith("/share-target")) {
    event.respondWith(receiveShare(event.request));
    return;
  }
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  event.respondWith(fromNetworkThenCache(event.request));
});

async function fromNetworkThenCache(request) {
  const cache = await caches.open(VERSION);
  try {
    const fresh = await fetch(request);
    if (fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch {
    const kept = await cache.match(request, { ignoreSearch: true })
      || (request.mode === "navigate" && await cache.match("./index.html"));
    if (kept) return kept;
    throw new Error("offline and not cached");
  }
}

async function receiveShare(request) {
  const form = await request.formData();
  // Apps fill these differently: a message usually arrives as "text", a link as "url", a subject as "title".
  const text = ["title", "text", "url"].map((k) => form.get(k)).filter((v) => typeof v === "string" && v.trim())
    .filter((v, i, all) => all.indexOf(v) === i).join("\n");
  const files = form.getAll("files").filter((f) => f && typeof f === "object" && f.size);
  const cache = await caches.open(SHARE_CACHE);
  for (const key of await cache.keys()) await cache.delete(key); // only the latest share is kept
  await cache.put("./shared/meta", new Response(JSON.stringify({ text, files: files.map((f) => ({ name: f.name, type: f.type })) })));
  await Promise.all(files.map((f, i) => cache.put(`./shared/file-${i}`, new Response(f))));
  return Response.redirect("./#shared", 303);
}
