import { readFileSync } from "node:fs"
import AxeBuilder from "@axe-core/playwright"
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
const REPORT = process.argv.includes("--report")
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]

const navOf = (file) =>
  [...readFileSync(new URL(file, import.meta.url), "utf8").matchAll(/\{\s*to:\s*"(\/[^"]*)",\s*label:\s*"([^"]+)"/g)].map((m) => [m[1], m[2]])

let PASS = 0
let FAIL = 0
const ERRORS = []

async function audit(page, label, url) {
  await page.goto(url)
  await page.waitForLoadState("networkidle").catch(() => {})
  await page.waitForTimeout(500)
  const result = await new AxeBuilder({ page }).withTags(TAGS).exclude("iframe").analyze()
  const serious = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical")
  if (REPORT) for (const v of result.violations) console.log(`    ${v.impact} ${v.id} ×${v.nodes.length} — ${v.help}`)
  if (serious.length) {
    FAIL += 1
    const line = `${label}: ${serious.map((v) => `${v.id} ×${v.nodes.length} (${v.nodes[0]?.target?.join(" ")})`).join("; ")}`
    ERRORS.push(line)
    console.log(`  [FAIL] ${line}`)
  } else {
    PASS += 1
    console.log(`  [PASS] ${label}`)
  }
}

async function signIn(page, origin, email, password) {
  await page.goto(`${origin}/login`)
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password", { exact: true }).fill(password)
  await page.getByRole("button", { name: /sign in|log in/i }).first().click()
  await page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 15000 }).catch(() => {})
}

async function main() {
  const browser = await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }))
  const feed = await (await fetch(`${API}/api/video/feed/home?limit=1`)).json()
  const long = feed[0]
  const handle = long?.channel?.handle ?? "klygenix"

  console.log("\n== a11y: web, anonymous, desktop and 360px")
  for (const viewport of [{ width: 1280, height: 860 }, { width: 360, height: 780 }]) {
    const ctx = await browser.newContext({ viewport, colorScheme: "dark" })
    const page = await ctx.newPage()
    for (const [label, path] of [["home", "/"], ["reels", "/reels"], ["watch", long ? `/watch/${long.id}` : "/"],
                                 ["search", "/search?q=azure"], ["channel", `/@${handle}`], ["plans", "/plans"],
                                 ["login", "/login"], ["signup", "/signup"], ["grievance", "/legal/grievance"]]) {
      await audit(page, `web ${label} @${viewport.width}`, WEB + path)
    }
    await ctx.close()
  }

  console.log("\n== a11y: web, signed in")
  let ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } })
  let page = await ctx.newPage()
  await signIn(page, WEB, VIEWER, DEMO_PASSWORD)
  for (const [label, path] of [["account", "/account"], ["watch", long ? `/watch/${long.id}` : "/"]]) await audit(page, `web ${label} (signed in)`, WEB + path)
  await ctx.close()

  for (const [name, origin, email, password, nav] of [
    ["studio", STUDIO, CREATOR, DEMO_PASSWORD, "../../apps/studio/src/components/layout/nav.ts"],
    ["admin", ADMIN, ADMIN_EMAIL, ADMIN_PASSWORD, "../../apps/admin/src/components/layout/nav.ts"],
  ]) {
    console.log(`\n== a11y: ${name}`)
    for (const scheme of ["light", "dark"]) {
      ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme })
      page = await ctx.newPage()
      await audit(page, `${name} login (${scheme})`, `${origin}/login`)
      await signIn(page, origin, email, password)
      for (const [path, label] of navOf(nav)) await audit(page, `${name} ${label} (${scheme})`, origin + path)
      await ctx.close()
    }
  }

  console.log("\n== a11y: tv")
  const streams = await (await fetch(`${API}/api/video/live?limit=1`)).json()
  const tvScreens = [["home", "/"], ["search", "/search?q=azure"], ["watch", long ? `/watch/${long.id}` : "/"], ["channel", `/channel/${handle}`],
                     ["profile", "/profile"], ["sign-in", "/login"], ["feedback", "/feedback"], ["404", "/no-such-page"]]
  if (streams[0]) tvScreens.push(["live", `/live/${streams[0].id}`])
  ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, colorScheme: "dark" })
  page = await ctx.newPage()
  for (const [label, path] of tvScreens) await audit(page, `tv ${label}`, TV + path)
  await ctx.close()
  const tvLogin = await (await fetch(`${API}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: VIEWER, password: DEMO_PASSWORD }) })).json()
  ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, colorScheme: "dark" })
  await ctx.addInitScript((auth) => localStorage.setItem("klygenix-video-auth", JSON.stringify({ state: auth, version: 0 })),
    { token: tvLogin.access_token, user: tvLogin.user })
  page = await ctx.newPage()
  for (const [label, path] of [["home", "/"], ["profile", "/profile"], ["channel", `/channel/${handle}`]]) await audit(page, `tv ${label} (signed in)`, TV + path)
  await ctx.close()

  await browser.close()
  console.log(`\na11y: ${PASS} passed, ${FAIL} failed`)
  if (FAIL) for (const e of ERRORS) console.log(`  - ${e}`)
  process.exit(FAIL ? 1 : 0)
}

main().catch((e) => {
  console.log(`  [FAIL] a11y crashed: ${e.stack ?? e}`)
  process.exit(1)
})
