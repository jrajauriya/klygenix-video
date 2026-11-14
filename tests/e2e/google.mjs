import AxeBuilder from "@axe-core/playwright"
import { chromium } from "playwright"

const WEB = process.env.WEB_URL || "http://localhost:5300"
const STUDIO = process.env.STUDIO_URL || "http://localhost:5301"
let failed = 0
const check = (name, ok, extra = "") => { console.log(`  [${ok ? "PASS" : "FAIL"}] ${name}${extra ? " — " + extra : ""}`); if (!ok) failed++ }
const uid = () => Math.random().toString(16).slice(2, 10)
const token = (sub, email, name) => "sandbox." + Buffer.from(JSON.stringify({ sub, email, name, email_verified: true })).toString("base64url")

const FAKE_GSI = `window.google = { accounts: { id: {
  initialize(c) { window.__gcb = c.callback; window.__ginit = c },
  renderButton(el, o) { const b = document.createElement("button"); b.type = "button"; b.textContent = "Continue with Google";
    b.onclick = () => window.__gcb({ credential: window.__gtoken }); el.appendChild(b); window.__gopts = o } } } }`

const browser = await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }))

async function open(base, path, credential) {
  const ctx = await browser.newContext()
  await ctx.route("https://accounts.google.com/gsi/client", (r) => r.fulfill({ contentType: "text/javascript", body: FAKE_GSI }))
  await ctx.addInitScript((t) => { window.__gtoken = t }, credential)
  const p = await ctx.newPage()
  await p.goto(base + path)
  return { ctx, p }
}

const google = (p) => p.getByRole("button", { name: "Continue with Google" })
const stored = (p) => p.evaluate(() => JSON.parse(localStorage.getItem("klygenix-video-auth") || "{}")?.state?.token ?? null)

console.log("\n== web: first time with Google")
const sub = `e2e${uid()}${uid()}`
const email = `e2e-${uid()}@gmail.com`
{
  const { ctx, p } = await open(WEB, "/login?returnUrl=%2Flibrary", token(sub, email, "Riya Google"))
  await google(p).waitFor({ timeout: 20000 })
  check("button shows on sign-in", await google(p).isVisible())
  check("the password form is still there", await p.locator("input[type=password]").isVisible())
  check("asked for continue_with text", (await p.evaluate(() => window.__gopts?.text)) === "continue_with")
  await google(p).click()
  await p.getByText("One more step").waitFor({ timeout: 15000 })
  check("finish form names the address", await p.getByText(email).isVisible())
  check("name taken from Google", (await p.getByLabel("Your name").inputValue()) === "Riya Google")
  check("no password asked", (await p.locator("input[type=password]").count()) === 0)
  const axe = await new AxeBuilder({ page: p }).include("form").analyze()
  check("finish form passes axe", axe.violations.length === 0, axe.violations.map((v) => v.id).join(","))
  await p.getByLabel("Date of birth").fill("2012-04-01")
  await p.getByRole("button", { name: "Create account" }).click()
  check("too young is stopped", await p.getByText(/at least 18/).isVisible())
  await p.getByLabel("Date of birth").fill("1995-04-01")
  await p.getByRole("button", { name: "Create account" }).click()
  await p.waitForURL(/\/library/, { timeout: 15000 }).catch(() => {})
  check("account made and back where they started", new URL(p.url()).pathname === "/library", p.url())
  check("signed in", Boolean(await stored(p)))
  await ctx.close()
}

console.log("\n== web: every time after")
{
  const { ctx, p } = await open(WEB, "/login", token(sub, email, "Riya Google"))
  await google(p).click()
  await p.waitForURL((u) => new URL(u).pathname === "/", { timeout: 15000 }).catch(() => {})
  check("one click signs in", Boolean(await stored(p)))
  check("no finish step", (await p.getByText("One more step").count()) === 0)
  await ctx.close()
}

console.log("\n== web: sign-up page")
{
  const { ctx, p } = await open(WEB, "/signup", token(`e2e${uid()}`, `e2e-${uid()}@gmail.com`, "Dev"))
  await google(p).waitFor({ timeout: 20000 })
  check("button shows on sign-up", await google(p).isVisible())
  await google(p).click()
  await p.getByText("One more step").waitFor({ timeout: 15000 })
  await p.getByRole("button", { name: "Use a different account" }).click()
  check("back to the choice", await google(p).isVisible())
  await ctx.close()
}

console.log("\n== studio")
{
  const semail = `e2e-s-${uid()}@gmail.com`
  const { ctx, p } = await open(STUDIO, "/login", token(`e2es${uid()}`, semail, "Studio Person"))
  await google(p).waitFor({ timeout: 20000 })
  check("studio sign-in shows the button", await google(p).isVisible())
  await google(p).click()
  await p.getByText("One more step").waitFor({ timeout: 15000 })
  await p.getByLabel("Date of birth").fill("1990-01-01")
  await p.getByRole("button", { name: "Create account" }).click()
  await p.waitForURL((u) => !new URL(u).pathname.startsWith("/login"), { timeout: 15000 }).catch(() => {})
  check("studio account made and signed in", Boolean(await stored(p)), p.url())
  await ctx.close()
}

await browser.close()
console.log(failed ? `\n${failed} failed` : "\nall passed")
process.exit(failed ? 1 : 0)
