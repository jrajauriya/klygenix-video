import { chromium } from "playwright"

const WEB = process.env.WEB_URL || "http://localhost:5300"
const API = process.env.KV_API || "http://localhost:9300"
let failed = 0
const check = (name, ok, extra = "") => { console.log(`  [${ok ? "PASS" : "FAIL"}] ${name}${extra ? " — " + extra : ""}`); if (!ok) failed++ }

const feed = await (await fetch(`${API}/api/video/feed/home`)).json()
const first = (Array.isArray(feed) ? feed : feed.items ?? []).find((v) => v?.title && v?.id)
if (!first) {
  console.log("no published video to suggest; run the suites or seed-demo first")
  process.exit(1)
}
const words = first.title.split(/\s+/).slice(0, 2).join(" ")
const browser = await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }))
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const p = await ctx.newPage()

console.log("\n== Suggestions drop down while typing")
await p.goto(WEB + "/")
const box = p.getByRole("combobox", { name: "Search" })
await box.click()
await box.pressSequentially(words.slice(0, Math.max(3, words.length)), { delay: 40 })
const list = p.getByRole("listbox", { name: "Search suggestions" })
await list.waitFor({ timeout: 5000 }).catch(() => {})
check("a dropdown opens", await list.isVisible())
const video = list.getByRole("option").filter({ hasText: first.title.slice(0, 20) })
await video.first().waitFor({ timeout: 5000 }).catch(() => {})
check("the matching video is suggested", (await video.count()) > 0, words)
check("the last row searches for what was typed", (await list.getByRole("option").last().textContent())?.includes(words) ?? false)
const box2 = await box.boundingBox()
const lb = await list.boundingBox()
check("the dropdown sits right under the box", Boolean(box2 && lb && Math.abs(lb.y - (box2.y + box2.height)) <= 2 && Math.abs(lb.x - box2.x) <= 2))

await box.press("ArrowDown")
check("arrow keys move through the options", (await box.getAttribute("aria-activedescendant")) !== null)
await box.press("Escape")
check("Escape closes it", !(await list.isVisible()))

await box.press("ArrowDown")
await video.first().click()
await p.waitForURL((u) => u.pathname.startsWith("/watch/") || u.pathname.startsWith("/reels/"), { timeout: 10000 }).catch(() => {})
check("clicking a video opens it", /^\/(watch|reels)\/[A-Za-z0-9_-]+$/.test(new URL(p.url()).pathname), p.url())

console.log("\n== Recent searches")
await p.goto(WEB + "/")
await box.fill("zzsuggest probe")
await box.press("Enter")
await p.waitForURL((u) => u.pathname === "/search", { timeout: 10000 }).catch(() => {})
check("Enter still searches", new URL(p.url()).searchParams.get("q") === "zzsuggest probe")
await p.goto(WEB + "/")
await box.click()
const recent = list.getByRole("option").filter({ hasText: "zzsuggest probe" })
await recent.first().waitFor({ timeout: 5000 }).catch(() => {})
check("an empty box shows recent searches", (await recent.count()) === 1)
await recent.getByRole("button", { name: /Remove/ }).click()
check("a recent search can be removed", (await list.getByRole("option").filter({ hasText: "zzsuggest probe" }).count()) === 0)
await p.mouse.click(1200, 700)
check("clicking elsewhere closes it", !(await list.isVisible()))

await browser.close()
console.log(failed ? `\n${failed} failed` : "\nall passed")
process.exit(failed ? 1 : 0)
