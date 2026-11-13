import AxeBuilder from "@axe-core/playwright"
import { chromium, devices } from "playwright"

const BASE = process.env.WEB_URL || "http://localhost:5300"
const WHATSAPP = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 WhatsApp/2.24"
let failed = 0
const check = (name, ok, extra = "") => { console.log(`  [${ok ? "PASS" : "FAIL"}] ${name}${extra ? " — " + extra : ""}`); if (!ok) failed++ }

const browser = await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }))

async function page(device, { ua, standalone = false, prompt = false } = {}) {
  const ctx = await browser.newContext({ ...devices[device], ...(ua ? { userAgent: ua } : {}) })
  await ctx.addInitScript(({ standalone, prompt }) => {
    if (standalone) {
      const mm = window.matchMedia.bind(window)
      window.matchMedia = (q) => q.includes("display-mode: standalone") ? { matches: true, media: q, addEventListener() {}, removeEventListener() {} } : mm(q)
    }
    window.__prompted = 0
    if (prompt) {
      window.addEventListener("DOMContentLoaded", () => setTimeout(() => {
        const e = new Event("beforeinstallprompt", { cancelable: true })
        e.prompt = async () => { window.__prompted++ }
        e.userChoice = Promise.resolve({ outcome: "accepted" })
        window.dispatchEvent(e)
      }, 50))
    }
  }, { standalone, prompt })
  const p = await ctx.newPage()
  return { ctx, p }
}

const headerBtn = (p) => p.locator("header button[aria-label='Install app']")

console.log("\n== Install app on every device")
{
  const { ctx, p } = await page("iPhone 15")
  await p.goto(BASE + "/")
  await headerBtn(p).waitFor({ timeout: 15000 })
  check("iPhone Safari: header button shows", await headerBtn(p).isVisible())
  check("iPhone: bar hidden on the first visit", (await p.getByRole("region", { name: "Get the app" }).count()) === 0)
  await headerBtn(p).click()
  const sheet = p.getByRole("dialog", { name: "Install Klygenix Play" })
  check("iPhone: sheet opens", await sheet.isVisible())
  check("iPhone: Safari steps name Add to Home Screen", (await sheet.innerText()).includes("Add to Home Screen") && (await sheet.innerText()).includes("bottom of the screen"))
  await p.getByRole("button", { name: "Show me" }).click()
  check("iPhone: pointer to Safari's Share button", await p.getByRole("button", { name: /Share, then Add to Home Screen/ }).isVisible())
  await p.close()
  const p2 = await ctx.newPage()
  await p2.goto(BASE + "/")
  const bar = p2.getByRole("region", { name: "Get the app" })
  await bar.waitFor({ timeout: 15000 }).catch(() => {})
  check("iPhone: bar shows on the 2nd visit", await bar.isVisible())
  await bar.getByRole("button", { name: "Not now" }).click()
  await p2.reload()
  await headerBtn(p2).waitFor()
  check("iPhone: × keeps the bar hidden after reload", (await p2.getByRole("region", { name: "Get the app" }).count()) === 0)
  check("iPhone: footer block shows", await p2.locator("footer").getByRole("button", { name: "Install app" }).isVisible())
  await ctx.close()
}
{
  const { ctx, p } = await page("iPhone 15", { ua: devices["iPhone 15"].userAgent.replace("Version/", "CriOS/130.0 Version/") })
  await p.goto(BASE + "/")
  await headerBtn(p).click()
  check("iPhone Chrome: steps point at the address-bar Share", (await p.getByRole("dialog").innerText()).includes("address bar at the top right"))
  await ctx.close()
}
{
  const { ctx, p } = await page("Pixel 7", { prompt: true })
  await p.goto(BASE + "/")
  await headerBtn(p).waitFor()
  await p.waitForTimeout(300)
  await headerBtn(p).click()
  await p.waitForTimeout(300)
  check("Android Chrome: one tap opens the native install prompt", (await p.evaluate(() => window.__prompted)) === 1)
  check("Android Chrome: no instruction sheet when the prompt exists", (await p.getByRole("dialog").count()) === 0)
  check("Android: button hides after install", (await headerBtn(p).count()) === 0)
  await ctx.close()
}
{
  const { ctx, p } = await page("iPhone 15", { ua: WHATSAPP })
  await p.goto(BASE + "/")
  await headerBtn(p).click()
  const d = p.getByRole("dialog")
  check("WhatsApp in-app: says open in browser", (await d.innerText()).includes("Open in browser"))
  check("WhatsApp in-app: Copy link button", await p.getByRole("button", { name: "Copy link" }).isVisible())
  await ctx.close()
}
{
  const { ctx, p } = await page("Desktop Chrome")
  await p.goto(BASE + "/")
  await headerBtn(p).click()
  check("Desktop without prompt: Chrome/Edge steps", (await p.getByRole("dialog").innerText()).includes("Chrome or Edge"))
  await ctx.close()
}
{
  const { ctx, p } = await page("iPhone 15", { standalone: true })
  await p.goto(BASE + "/")
  await p.locator("header").waitFor()
  await p.waitForTimeout(800)
  check("Installed: no header button", (await headerBtn(p).count()) === 0)
  check("Installed: no footer block", (await p.locator("footer").getByRole("button", { name: "Install app" }).count()) === 0)
  await ctx.close()
}
{
  const { ctx, p } = await page("iPhone 15")
  const tags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]
  await p.goto(BASE + "/")
  await headerBtn(p).waitFor()
  await p.close()
  const q = await ctx.newPage()
  await q.goto(BASE + "/")
  await q.getByRole("region", { name: "Get the app" }).waitFor()
  let r = await new AxeBuilder({ page: q }).withTags(tags).include("[aria-label='Get the app']").analyze()
  check("axe: install bar", r.violations.length === 0, r.violations.map((v) => v.id).join(", "))
  await headerBtn(q).click()
  r = await new AxeBuilder({ page: q }).withTags(tags).include("[role=dialog]").analyze()
  check("axe: install sheet", r.violations.length === 0, r.violations.map((v) => v.id).join(", "))
  await ctx.close()
}
await browser.close()
console.log(`\n${failed ? failed + " failed" : "all passed"}`)
process.exit(failed ? 1 : 0)
