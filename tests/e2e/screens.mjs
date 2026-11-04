import { readFileSync } from "node:fs"
import { chromium } from "playwright"

const WEB = process.env.KV_WEB ?? "http://localhost:5310"
const STUDIO = process.env.KV_STUDIO ?? "http://localhost:5311"
const ADMIN = process.env.KV_ADMIN ?? "http://localhost:5312"
const TV = process.env.KV_TV ?? "http://localhost:5313"
const API = process.env.KV_API ?? "http://localhost:9300"
const CREATOR = process.env.KV_CREATOR ?? "asha@demo.klygenix.com"
const VIEWER = process.env.KV_VIEWER ?? "rohan@demo.klygenix.com"
const DEMO_PASSWORD = process.env.KV_DEMO_PASSWORD ?? "Welcome@12345"
const ADMIN_EMAIL = process.env.KV_ADMIN_EMAIL ?? "admin@klygenix.com"
const ADMIN_PASSWORD = process.env.KV_ADMIN_PASSWORD ?? "admin123"

let PASS = 0
let FAIL = 0
const ERRORS = []

function check(name, cond, detail = "") {
  if (cond) {
    PASS += 1
    console.log(`  [PASS] ${name}`)
  } else {
    FAIL += 1
    ERRORS.push(`${name}: ${detail}`)
    console.log(`  [FAIL] ${name} — ${detail}`)
  }
}

const navOf = (file) =>
  [...readFileSync(new URL(file, import.meta.url), "utf8").matchAll(/\{\s*to:\s*"(\/[^"]*)",\s*label:\s*"([^"]+)"/g)].map((m) => [m[1], m[2]])
const STUDIO_SCREENS = navOf("../../apps/studio/src/components/layout/nav.ts")
const ADMIN_SCREENS = navOf("../../apps/admin/src/components/layout/nav.ts")

const IGNORED = [/favicon/i, /React DevTools/i, /ERR_NAME_NOT_RESOLVED/i, /i\.ytimg\.com|youtube\.com|bilibili|hdslb/i, /Failed to load resource.*404/i]
const interesting = (text) => !IGNORED.some((p) => p.test(text))

async function api(path, { token, method = "GET", body } = {}) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${await r.text()}`)
  return r.status === 204 ? null : r.json()
}

function watch(page) {
  let thrown = []
  let failed = []
  page.on("pageerror", (e) => thrown.push(String(e.message ?? e)))
  page.on("console", (m) => {
    if (m.type() === "error" && interesting(m.text())) thrown.push(m.text())
  })
  page.on("response", (r) => {
    if (r.url().includes("/api/") && r.status() >= 400 && r.status() !== 401) failed.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`)
  })
  return () => {
    const out = { thrown, failed }
    thrown = []
    failed = []
    return out
  }
}

async function signIn(page, origin, email, password) {
  await page.goto(`${origin}/login`)
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password", { exact: true }).fill(password)
  await page.getByRole("button", { name: /sign in|log in/i }).first().click()
  await page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 15000 }).catch(() => {})
  return !page.url().endsWith("/login")
}

async function visit(page, drain, label, url, expectText) {
  await page.goto(url)
  await page.waitForLoadState("networkidle").catch(() => {})
  await page.waitForTimeout(400)
  const { thrown, failed } = drain()
  const body = (await page.locator("body").innerText().catch(() => "")).trim()
  check(`${label} renders`, body.length > 20 && !/Something went wrong|Unexpected Application Error/i.test(body), body.slice(0, 120))
  check(`${label} has no script errors`, thrown.length === 0, thrown.join(" | ").slice(0, 300))
  check(`${label} has no failed API calls`, failed.length === 0, failed.join(", "))
  if (expectText) check(`${label} shows ${expectText}`, body.includes(expectText), body.slice(0, 160))
}

async function main() {
  const browser = await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }))

  console.log("\n== web (anonymous)")
  const feed = await api("/api/video/feed/home?limit=5")
  const reel = (await api("/api/video/feed/reels?limit=1"))[0]
  const long = feed[0]
  const handle = long?.channel?.handle ?? "klygenix"
  let ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } })
  let page = await ctx.newPage()
  let drain = watch(page)
  const anonymous = [
    ["home", "/"],
    ["reels", "/reels"],
    ["watch", long ? `/watch/${long.id}` : "/"],
    ["search", "/search?q=azure"],
    ["channel", `/@${handle}`],
    ["plans", "/plans"],
    ["login", "/login"],
    ["signup", "/signup"],
    ["terms", "/legal/terms"],
    ["privacy", "/legal/privacy"],
    ["guidelines", "/legal/guidelines"],
    ["copyright", "/legal/copyright"],
    ["grievance", "/legal/grievance"],
  ]
  for (const [label, path] of anonymous) await visit(page, drain, `web ${label}`, WEB + path)
  await page.goto(`${WEB}/no-such-page-here`)
  check("web 404 page", /not found|404|isn.t here/i.test(await page.locator("body").innerText()), "no 404 text")
  drain()
  await ctx.close()

  console.log("\n== web (signed in, phone width)")
  ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  page = await ctx.newPage()
  drain = watch(page)
  check("web sign-in", await signIn(page, WEB, VIEWER, DEMO_PASSWORD), page.url())
  drain()
  for (const [label, path] of [["home", "/"], ["reels", reel ? `/reels/${reel.id}` : "/reels"], ["watch", long ? `/watch/${long.id}` : "/"], ["account", "/account"], ["plans", "/plans"]]) {
    await visit(page, drain, `web ${label} (signed in)`, WEB + path)
  }
  if (long) {
    await page.goto(`${WEB}/watch/${long.id}`)
    await page.waitForLoadState("networkidle").catch(() => {})
    const scroll = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    check("watch page has no sideways scroll at 390px", scroll <= 1, `overflow ${scroll}px`)
    drain()
  }
  await ctx.close()

  console.log("\n== studio")
  ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  page = await ctx.newPage()
  drain = watch(page)
  check("studio sign-in through the login screen", await signIn(page, STUDIO, CREATOR, DEMO_PASSWORD), page.url())
  drain()
  check("studio nav has screens", STUDIO_SCREENS.length >= 6, `${STUDIO_SCREENS.length}`)
  for (const [path, label] of STUDIO_SCREENS) await visit(page, drain, `studio ${label}`, STUDIO + path)
  const login = await api("/api/auth/login", { method: "POST", body: { email: CREATOR, password: DEMO_PASSWORD } })
  const vids = await api("/api/video/studio/videos?status=published&limit=1", { token: login.access_token })
  if (vids[0]) await visit(page, drain, "studio video detail", `${STUDIO}/videos/${vids[0].id}`, vids[0].title.slice(0, 20))
  await page.goto(`${STUDIO}/videos?upload=1`)
  await page.waitForTimeout(600)
  check("studio upload drawer opens", (await page.getByRole("dialog").count()) > 0, "no dialog")
  drain()
  await ctx.close()

  console.log("\n== admin")
  ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  page = await ctx.newPage()
  drain = watch(page)
  check("admin sign-in through the login screen", await signIn(page, ADMIN, ADMIN_EMAIL, ADMIN_PASSWORD), page.url())
  drain()
  check("admin nav has screens", ADMIN_SCREENS.length >= 5, `${ADMIN_SCREENS.length}`)
  for (const [path, label] of ADMIN_SCREENS) await visit(page, drain, `admin ${label}`, ADMIN + path)
  await ctx.close()

  console.log("\n== tv")
  ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } })
  page = await ctx.newPage()
  drain = watch(page)
  const streams = await api("/api/video/live?limit=1")
  const tvScreens = [
    ["home", "/", "Recommended"],
    ["search", "/search?q=azure", "Results for"],
    ["watch", long ? `/watch/${long.id}` : "/"],
    ["channel", `/channel/${handle}`, "Videos"],
    ["profile", "/profile", "Sign in with your phone"],
    ["sign-in", "/login", "Enter this code"],
    ["feedback", "/feedback", "Send feedback"],
  ]
  for (const [label, path, text] of tvScreens) await visit(page, drain, `tv ${label}`, TV + path, text)
  if (streams[0]) {
    await page.goto(`${TV}/live/${streams[0].id}`)
    await page.waitForTimeout(2500)
    const { thrown, failed } = drain()
    const real = failed.filter((f) => !/^404 GET \/api\/video\/sandbox\/live\//.test(f))
    check("tv live renders", (await page.locator("body").innerText()).includes("Back"), "no live screen")
    check("tv live has no script errors", thrown.length === 0, thrown.join(" | ").slice(0, 300))
    check("tv live has no failed API calls (a sandbox stream with no ingest has no playlist)", real.length === 0, real.join(", "))
  }

  const focused = () => page.evaluate(() => {
    const a = document.activeElement
    return a?.getAttribute("data-focus-id") ?? (a && a !== document.body ? a.textContent.trim().slice(0, 30) : "")
  })
  await page.goto(`${TV}/`)
  await page.waitForFunction(() => document.activeElement?.hasAttribute("data-focus-id"), null, { timeout: 8000 }).catch(() => {})
  const first = await focused()
  check("tv home focuses a card on load", first.includes(":"), first)
  await page.keyboard.press("ArrowRight")
  const right = await focused()
  check("tv ArrowRight moves focus along the row", right.includes(":") && right !== first, `${first} → ${right}`)
  await page.keyboard.press("ArrowDown")
  const below = await focused()
  check("tv ArrowDown moves focus to the next row", below !== right && below !== "", `${right} → ${below}`)
  await page.keyboard.press("ArrowUp")
  check("tv ArrowUp returns to the same card", (await focused()) === right, await focused())
  await page.keyboard.press("Enter")
  await page.waitForURL(/\/(watch|live)\//, { timeout: 8000 }).catch(() => {})
  check("tv Enter opens Watch", /\/watch\//.test(new URL(page.url()).pathname), page.url())
  await page.waitForTimeout(1200)
  await page.keyboard.press("Escape")
  await page.waitForURL((u) => u.pathname === "/", { timeout: 8000 }).catch(() => {})
  check("tv Escape returns to Home", new URL(page.url()).pathname === "/", page.url())
  await page.waitForTimeout(800)
  check("tv focus comes back to the card it left", (await focused()) === right, await focused())
  drain()

  const creative = long ? (await api(`/api/video/videos/${long.id}`)).playback?.url : null
  if (long && creative) {
    let adUrl = creative
    await page.route("**/api/video/ads/breaks*", (r) => r.fulfill({ json: { eligible: true, reason: null, pre: true, mid: [] } }))
    await page.route("**/api/video/ads/decision*", (r) => r.fulfill({ json: { ad: { token: "e2e-tv-ad-token-0001", brand: "E2E Brand", label: "Ad", slot: "pre",
      skip_after_seconds: 2, click_url: "https://example.com/e2e", duration_ms: 20000, playback: { type: "hls", url: adUrl } } } }))
    const sent = []
    await page.route("**/api/video/ads/events", (r) => {
      sent.push(r.request().postDataJSON()?.event)
      r.fulfill({ status: 202, json: { counted: false } })
    })
    await page.goto(`${TV}/watch/${long.id}`)
    check("tv pre-roll shows Ad · brand", await page.getByText("Ad · E2E Brand").waitFor({ timeout: 8000 }).then(() => true, () => false), "no ad label")
    const skip = await page.getByRole("button", { name: /Skip ad/ }).waitFor({ timeout: 12000 }).then(() => true, () => false)
    check("tv Skip ad appears after the skip delay", skip, "no skip button")
    if (skip) {
      const skipped = page.waitForRequest((r) => r.url().includes("/api/video/ads/events") && r.postDataJSON()?.event === "skip", { timeout: 5000 }).catch(() => null)
      await page.keyboard.press("Enter")
      await skipped
    }
    check("tv content plays after the ad", await page.getByRole("button", { name: /^(Play|Pause)$/ }).waitFor({ timeout: 8000 }).then(() => true, () => false), "no player controls")
    check("tv ad sends start and skip", sent.includes("start") && sent.includes("skip"), sent.join(","))
    adUrl = `${TV}/no-such-ad/master.m3u8`
    await page.goto(`${TV}/watch/${long.id}`)
    check("tv a broken ad falls through to the video", await page.getByRole("button", { name: /^(Play|Pause)$/ }).waitFor({ timeout: 15000 }).then(() => true, () => false), "stuck on the ad")
    await page.unrouteAll({ behavior: "ignoreErrors" })
    drain()
  }
  await ctx.close()

  await browser.close()
  console.log(`\n${PASS} passed, ${FAIL} failed`)
  if (FAIL) for (const e of ERRORS) console.log(`  - ${e}`)
  process.exit(FAIL ? 1 : 0)
}

main().catch((e) => {
  console.log(`  [FAIL] screens crashed: ${e.stack ?? e}`)
  process.exit(1)
})
