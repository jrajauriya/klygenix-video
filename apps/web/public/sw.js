const VERSION = "kv-web-1"
const SHELL = `${VERSION}-shell`
const ASSETS = `${VERSION}-assets`
const MAX_ASSETS = 160
const STATIC = ["/", "/manifest.webmanifest", "/favicon.svg", "/icon-192.png", "/icon-512.png"]
const NEVER = /\.(m3u8|ts|m4s|mp4|m4a|webm|mp3|aac|vtt|key)$/i

const OFFLINE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0b0b12">
<title>Offline · Klygenix Play</title>
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0b12;color:#f4f4f7;font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;padding:24px;box-sizing:border-box}
main{max-width:420px;text-align:center}
h1{font-size:22px;margin:16px 0 8px}
p{color:#b9b9c6;margin:0 0 6px;font-size:14px}
a{display:inline-block;margin-top:20px;padding:10px 22px;border-radius:999px;background:#a21caf;color:#fff;text-decoration:none;font-weight:600;font-size:14px}
a:focus-visible{outline:2px solid #f0abfc;outline-offset:3px}
.mark{width:56px;height:56px;border-radius:16px;margin:0 auto;background:linear-gradient(135deg,#c026d3,#6b21a8);display:flex;align-items:center;justify-content:center}
</style>
</head>
<body>
<main>
<div class="mark" aria-hidden="true"><svg viewBox="0 0 24 24" width="24" height="24"><path d="M8 5.5v13l10.5-6.5z" fill="#fff"/></svg></div>
<h1>You're offline</h1>
<p>Klygenix Play needs a connection to load this page. Check your internet and try again.</p>
<p lang="hi">आप ऑफ़लाइन हैं। यह पेज खोलने के लिए इंटरनेट चाहिए। कनेक्शन जाँचकर दोबारा कोशिश करें।</p>
<a href="">Try again · दोबारा कोशिश करें</a>
</main>
</body>
</html>`

function cacheable(request, url) {
  if (request.method !== "GET" || url.origin !== self.location.origin) return false
  if (url.pathname.startsWith("/api/") || NEVER.test(url.pathname) || request.headers.has("range")) return false
  return !["video", "audio", "track"].includes(request.destination)
}

async function precache() {
  const cache = await caches.open(SHELL)
  const assets = await caches.open(ASSETS)
  const index = await fetch("/", { cache: "no-cache" })
  if (!index.ok) return
  const html = await index.clone().text()
  await cache.put("/", index)
  const linked = [...new Set([...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]))]
  await Promise.all([
    ...STATIC.filter((p) => p !== "/").map((p) => cache.add(p).catch(() => undefined)),
    ...linked.map((p) => assets.add(p).catch(() => undefined)),
  ])
}

async function trim() {
  const cache = await caches.open(ASSETS)
  const keys = await cache.keys()
  await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_ASSETS)).map((k) => cache.delete(k)))
}

async function fromAssets(request) {
  const cache = await caches.open(ASSETS)
  const hit = await cache.match(request)
  if (hit) return hit
  const response = await fetch(request)
  if (response.ok && response.type === "basic") {
    await cache.put(request, response.clone())
    trim()
  }
  return response
}

async function navigate(event) {
  try {
    const preload = await event.preloadResponse
    if (preload) return preload
    return await fetch(event.request)
  } catch {
    return new Response(OFFLINE, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } })
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(precache().catch(() => undefined).then(() => self.skipWaiting()))
})

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys()
    await Promise.all(names.filter((n) => n.startsWith("kv-web-") && !n.startsWith(`${VERSION}-`)).map((n) => caches.delete(n)))
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable().catch(() => undefined)
    await self.clients.claim()
  })())
})

self.addEventListener("fetch", (event) => {
  const { request } = event
  const url = new URL(request.url)
  if (!cacheable(request, url)) return
  if (request.mode === "navigate") {
    event.respondWith(navigate(event))
    return
  }
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(fromAssets(request))
    return
  }
  if (STATIC.includes(url.pathname) && url.pathname !== "/") {
    event.respondWith(caches.match(request).then((hit) => hit || fetch(request)))
  }
})
