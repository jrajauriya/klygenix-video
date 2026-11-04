import { chromium } from "playwright"

const DOMAIN = process.env.KV_STACK_DOMAIN ?? "play.localhost"
const PORT = process.env.KV_STACK_PORT ?? "8443"
const suffix = PORT === "443" ? "" : `:${PORT}`
const WEB = `https://${DOMAIN}${suffix}`
const STUDIO = `https://studio.${DOMAIN}${suffix}`
const ADMIN = `https://admin.${DOMAIN}${suffix}`
const TV = `https://tv.${DOMAIN}${suffix}`
const API = `https://api.${DOMAIN}${suffix}`
const ADMIN_EMAIL = process.env.KV_ADMIN_EMAIL ?? "admin@klygenix.com"
const ADMIN_PASSWORD = process.env.KV_ADMIN_PASSWORD ?? "admin123"

let PASS = 0
let FAIL = 0

function check(name, cond, detail = "") {
  if (cond) {
    PASS += 1
    console.log(`  [PASS] ${name}`)
  } else {
    FAIL += 1
    console.log(`  [FAIL] ${name} — ${detail}`)
  }
}

async function probe(page, label, url, origin) {
  const violations = []
  const foreignFonts = []
  page.removeAllListeners("console")
  page.removeAllListeners("request")
  page.on("console", (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text().slice(0, 200))
  })
  page.on("request", (r) => {
    if (r.resourceType() === "font" && !r.url().startsWith(origin)) foreignFonts.push(r.url())
  })
  await page.addInitScript(() => {
    window.__csp = []
    document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`))
  })
  const response = await page.goto(url)
  await page.waitForLoadState("networkidle").catch(() => {})
  await page.waitForTimeout(500)
  const events = await page.evaluate(() => window.__csp ?? [])
  const csp = response?.headers()["content-security-policy"] ?? ""
  check(`${label}: CSP header present`, csp.length > 0, "missing")
  check(`${label}: no CSP violation`, events.length === 0 && violations.length === 0, [...events, ...violations].join(" | "))
  check(`${label}: fonts from its own origin`, foreignFonts.length === 0, foreignFonts.join(", "))
}

async function main() {
  const browser = await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }))
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 860 } })
  const page = await ctx.newPage()
  const feed = await page.request.get(`${API}/api/video/feed/home?limit=1`).then((r) => r.json()).catch(() => [])
  const long = feed[0]

  console.log(`\n== CSP through nginx on ${WEB}`)
  for (const [label, path] of [["web home", "/"], ["web reels", "/reels"], ["web watch", long ? `/watch/${long.id}` : "/"],
                               ["web search", "/search?q=azure"], ["web login", "/login"], ["web plans", "/plans"]]) {
    await probe(page, label, WEB + path, WEB)
  }
  for (const [label, origin] of [["studio login", STUDIO], ["admin login", ADMIN]]) await probe(page, label, `${origin}/login`, origin)
  await probe(page, "tv home", `${TV}/`, TV)
  await probe(page, "web activate", `${WEB}/activate?code=ABCD-2345`, WEB)
  await probe(page, "web waitlist", `${WEB}/waitlist`, WEB)

  await page.goto(`${ADMIN}/login`)
  await page.getByLabel("Email").fill(ADMIN_EMAIL)
  await page.getByLabel("Password", { exact: true }).fill(ADMIN_PASSWORD)
  await page.getByRole("button", { name: /sign in|log in/i }).first().click()
  await page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 15000 }).catch(() => {})
  await probe(page, "admin dashboard (signed in)", `${ADMIN}/`, ADMIN)

  await browser.close()
  console.log(`\ncsp: ${PASS} passed, ${FAIL} failed`)
  process.exit(FAIL ? 1 : 0)
}

main().catch((e) => {
  console.log(`  [FAIL] csp crashed: ${e.stack ?? e}`)
  process.exit(1)
})
