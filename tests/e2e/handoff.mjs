import { chromium } from "playwright"

const WEB = process.env.WEB_URL || "http://localhost:5300"
const STUDIO = process.env.STUDIO_URL || "http://localhost:5301"
const API = process.env.KV_API || "http://localhost:9300"
const KEY = "klygenix-video-auth"
let failed = 0
const check = (name, ok, extra = "") => { console.log(`  [${ok ? "PASS" : "FAIL"}] ${name}${extra ? " — " + extra : ""}`); if (!ok) failed++ }
const uid = () => Math.random().toString(16).slice(2, 10)

async function account(handle) {
  const r = await fetch(`${API}/api/auth/signup`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Handoff Viewer", email: `suite-${uid()}@example.com`, password: "Welcome@12345", birth_date: "1994-03-14", country: "IN", language: "en", handle }),
  })
  return r.json()
}

const browser = await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }))
const stored = (p) => p.evaluate((k) => JSON.parse(localStorage.getItem(k) || "{}")?.state?.token ?? null, KEY)

async function signedInContext(auth, origin = WEB) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await ctx.addInitScript(([k, v, origin]) => {
    if (location.origin === origin && !localStorage.getItem(k)) localStorage.setItem(k, v)
  }, [KEY, JSON.stringify({ state: { token: auth.access_token, user: auth.user }, version: 0 }), new URL(origin).origin])
  return ctx
}

console.log("\n== Play → Studio without signing in again")
const viewer = await account(null)
{
  const ctx = await signedInContext(viewer)
  await ctx.route("**/api/video/tenant-features", async (route) => {
    await new Promise((r) => setTimeout(r, 800))
    await route.fulfill({ json: { "video.live": false } })
  })
  const p = await ctx.newPage()
  await p.goto(WEB + "/")
  await p.getByRole("button", { name: "Account menu" }).click()
  await p.getByRole("menuitem", { name: "Klygenix Studio" }).click()
  await p.waitForURL((u) => u.origin === new URL(STUDIO).origin && !u.pathname.startsWith("/auth/continue"), { timeout: 20000 }).catch(() => {})
  const url = new URL(p.url())
  check("landed on Studio", url.origin === new URL(STUDIO).origin, p.url())
  check("not the login page", !url.pathname.startsWith("/login"), url.pathname)
  check("no code left in the address bar", !p.url().includes("code="))
  check("Studio has its own session", Boolean(await stored(p)))
  await p.waitForTimeout(2500)
  check("Studio renders without a crash", (await p.getByText(/Unexpected Application Error|Something went wrong/).count()) === 0, p.url())
  const r = await p.evaluate(async ([api, k]) => {
    const t = JSON.parse(localStorage.getItem(k)).state.token
    return (await fetch(`${api}/api/auth/me`, { headers: { Authorization: `Bearer ${t}` } })).json()
  }, [API, KEY])
  check("as the same person", r.email === viewer.user.email, r.email)
  await ctx.close()
}

console.log("\n== Upload goes straight to the Studio uploader")
const makerHandle = `suite-${uid()}`
const maker = await account(makerHandle)
{
  const ctx = await signedInContext(maker)
  const p = await ctx.newPage()
  await p.goto(WEB + "/")
  await p.getByRole("link", { name: "Upload in Klygenix Studio" }).click()
  await p.waitForURL((u) => u.origin === new URL(STUDIO).origin && u.pathname === "/videos", { timeout: 20000 }).catch(() => {})
  check("on the Studio videos page", new URL(p.url()).pathname === "/videos", p.url())
  check("upload asked for", new URL(p.url()).searchParams.get("upload") === "1")

  await ctx.close()
}

console.log("\n== Studio → Play")
{
  const ctx = await signedInContext(maker, STUDIO)
  const p = await ctx.newPage()
  await p.goto(STUDIO + "/")
  await p.getByRole("button", { name: /Handoff Viewer/ }).first().click()
  await p.getByRole("link", { name: "Open Klygenix Play" }).click()
  await p.waitForURL((u) => u.origin === new URL(WEB).origin && !u.pathname.startsWith("/auth/continue"), { timeout: 20000 }).catch(() => {})
  check("back on Play", new URL(p.url()).origin === new URL(WEB).origin, p.url())
  check("signed in on Play", Boolean(await stored(p)))
  await ctx.close()
}

console.log("\n== Account page")
{
  const ctx = await signedInContext(viewer)
  const p = await ctx.newPage()
  await p.goto(WEB + "/account")
  await p.getByRole("tab", { name: "Profile" }).waitFor()
  check("no Sign out button on the page", (await p.locator("main").getByRole("button", { name: "Sign out" }).count()) === 0)
  const tabs = p.getByRole("tab")
  const n = await tabs.count()
  let hidden = 0
  for (let i = 0; i < n; i++) {
    const box = await tabs.nth(i).boundingBox()
    if (!box || box.x < 0 || box.x + box.width > 1280) hidden++
  }
  check("every tab fully visible at 1280px", n === 10 && hidden === 0, `${n} tabs, ${hidden} cut off`)
  const x1 = (await p.getByRole("heading", { name: "Account" }).boundingBox()).x
  await p.getByRole("tab", { name: "Purchases" }).click()
  await p.waitForTimeout(500)
  const x2 = (await p.getByRole("heading", { name: "Account" }).boundingBox()).x
  await p.getByRole("tab", { name: "Profile" }).click()
  await p.waitForTimeout(500)
  const x3 = (await p.getByRole("heading", { name: "Account" }).boundingBox()).x
  check("the page does not shift between tabs", x1 === x2 && x2 === x3, `${x1} ${x2} ${x3}`)
  check("language switch has no translate glyph", (await p.locator("svg.lucide-languages").count()) === 0)
  await ctx.close()
}

console.log("\n== Subscriptions shows who you follow")
{
  const handle = maker.user.channel_handle ?? makerHandle
  await fetch(`${API}/api/video/channels/${handle}/follow`, { method: "POST", headers: { Authorization: `Bearer ${viewer.access_token}` } })
  const ctx = await signedInContext(viewer)
  const p = await ctx.newPage()
  await p.goto(WEB + "/subscriptions")
  const row = p.getByRole("navigation", { name: "Channels you follow" })
  await row.waitFor({ timeout: 10000 }).catch(() => {})
  check("channel row shown", (await row.count()) === 1, handle ?? "no handle")
  check("Manage links to the Following tab", (await row.getByRole("link", { name: "Manage" }).getAttribute("href").catch(() => null)) === "/account?tab=following")
  await ctx.close()
}

await browser.close()
console.log(failed ? `\n${failed} failed` : "\nall passed")
process.exit(failed ? 1 : 0)
