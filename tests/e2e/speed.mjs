import { createServer } from "node:http"
import { existsSync, readFileSync, statSync } from "node:fs"
import { extname, join, normalize } from "node:path"
import { gzipSync } from "node:zlib"
import { chromium } from "playwright"

const ROOT = new URL("../../apps/web/dist-e2e/", import.meta.url).pathname
const PORT = Number(process.env.KV_SPEED_PORT ?? 5310)
const API = process.env.KV_API ?? "http://localhost:9300"
const BUDGET = {
  lcp: Number(process.env.KV_LCP_MS ?? 2500),
  start: Number(process.env.KV_START_MS ?? 2000),
  tbt: Number(process.env.KV_TBT_MS ?? 300),
  js: { home: 260_000, reels: 420_000, watch: 420_000 },
}
const PROFILES = {
  "4G": { latency: 170, down: 9_000_000, up: 9_000_000 },
  "Slow 4G": { latency: 150, down: 1_600_000, up: 750_000 },
}
const TYPES = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".json": "application/json" }

let PASS = 0
let FAIL = 0
function check(name, cond, detail = "") {
  if (cond) {
    PASS += 1
    console.log(`  [PASS] ${name} ${detail}`)
  } else {
    FAIL += 1
    console.log(`  [FAIL] ${name} — ${detail}`)
  }
}

const cache = new Map()
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://x")
  let file = normalize(join(ROOT, decodeURIComponent(url.pathname)))
  if (!file.startsWith(ROOT) || !existsSync(file) || statSync(file).isDirectory()) file = join(ROOT, "index.html")
  const type = TYPES[extname(file)] ?? "application/octet-stream"
  let body = cache.get(file)
  if (!body) {
    const raw = readFileSync(file)
    body = /text|javascript|json|svg/.test(type) ? gzipSync(raw, { level: 6 }) : raw
    cache.set(file, body)
  }
  const headers = { "Content-Type": type, "Content-Length": body.length }
  if (/text|javascript|json|svg/.test(type)) headers["Content-Encoding"] = "gzip"
  if (file.includes("/assets/")) headers["Cache-Control"] = "public, max-age=31536000, immutable"
  res.writeHead(200, headers)
  res.end(body)
})

async function measure(browser, path, profile) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  const cdp = await ctx.newCDPSession(page)
  await cdp.send("Network.enable")
  const net = PROFILES[profile]
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: net.latency, downloadThroughput: net.down / 8, uploadThroughput: net.up / 8 })
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 })
  let js = 0
  cdp.on("Network.loadingFinished", (e) => {
    if (types.get(e.requestId) === "Script") js += e.encodedDataLength
  })
  const types = new Map()
  let apiFailed = 0
  let apiOk = 0
  cdp.on("Network.responseReceived", (e) => {
    types.set(e.requestId, e.type)
    if (e.response.url.includes("/api/")) e.response.status < 400 ? (apiOk += 1) : (apiFailed += 1)
  })
  cdp.on("Network.loadingFailed", (e) => {
    if (types.get(e.requestId) !== "Script") apiFailed += 1
  })
  await page.addInitScript(() => {
    window.__lcp = 0
    window.__tbt = 0
    window.__start = 0
    document.addEventListener("playing", () => {
      if (!window.__start) window.__start = performance.now()
    }, true)
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) window.__lcp = e.startTime
    }).observe({ type: "largest-contentful-paint", buffered: true })
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) window.__tbt += Math.max(0, e.duration - 50)
    }).observe({ type: "longtask", buffered: true })
  })
  await page.goto(`http://localhost:${PORT}${path}`, { waitUntil: "load", timeout: 60000 })
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(2500)
  const m = await page.evaluate(() => ({ lcp: Math.round(window.__lcp), tbt: Math.round(window.__tbt), start: Math.round(window.__start) }))
  await ctx.close()
  return { ...m, js, apiOk, apiFailed }
}

async function main() {
  await new Promise((r) => server.listen(PORT, r))
  const feed = await (await fetch(`${API}/api/video/feed/home?limit=1`)).json()
  const reel = (await (await fetch(`${API}/api/video/feed/reels?limit=1`)).json())[0]
  const routes = [["home", "/"], ["reels", reel ? `/reels/${reel.id}` : "/reels"], ["watch", feed[0] ? `/watch/${feed[0].id}` : "/"]]
  const args = ["--autoplay-policy=no-user-gesture-required"]
  const browser = await chromium.launch({ args }).catch(() => chromium.launch({ channel: "chrome", args }))
  console.log("\n== Speed at 390 px on 4G (9 Mbps, 170 ms), 4x CPU, cold cache — the plan's target")
  for (const [label, path] of routes) {
    const m = await measure(browser, path, "4G")
    check(`${label} loaded its data`, m.apiOk > 0 && m.apiFailed === 0, `${m.apiOk} ok, ${m.apiFailed} failed`)
    check(`${label} LCP under ${BUDGET.lcp} ms`, m.lcp > 0 && m.lcp <= BUDGET.lcp, `${m.lcp} ms`)
    if (label !== "home") check(`${label} video starts under ${BUDGET.start} ms`, m.start > 0 && m.start <= BUDGET.start, `${m.start} ms`)
    check(`${label} TBT under ${BUDGET.tbt} ms`, m.tbt <= BUDGET.tbt, `${m.tbt} ms`)
    check(`${label} JS over the wire under ${Math.round(BUDGET.js[label] / 1000)} KB`, m.js <= BUDGET.js[label], `${Math.round(m.js / 1000)} KB`)
  }
  console.log("\n== Stress: Slow 4G (1.6 Mbps, 150 ms), 4x CPU — reported, not gated")
  for (const [label, path] of routes) {
    const m = await measure(browser, path, "Slow 4G")
    console.log(`  [INFO] ${label}: LCP ${m.lcp} ms${label !== "home" ? `, video start ${m.start} ms` : ""}, TBT ${m.tbt} ms`)
  }
  await browser.close()
  server.close()
  console.log(`\n${PASS} passed, ${FAIL} failed`)
  process.exit(FAIL ? 1 : 0)
}

main().catch((e) => {
  console.log(`  [FAIL] speed crashed: ${e.stack ?? e}`)
  server.close()
  process.exit(1)
})
