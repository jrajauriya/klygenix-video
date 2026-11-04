import { readFileSync, writeFileSync } from "node:fs"
import { chromium } from "playwright"

const pub = new URL("../public/", import.meta.url)
const svg = readFileSync(new URL("favicon.svg", pub), "utf8")
const mark = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`

const ICONS = [
  { file: "icon-192.png", size: 192, inset: 0.16, radius: 0.22 },
  { file: "icon-512.png", size: 512, inset: 0.16, radius: 0.22 },
  { file: "icon-maskable-512.png", size: 512, inset: 0.24, radius: 0 },
  { file: "icon-apple-180.png", size: 180, inset: 0.16, radius: 0 },
]

const browser = await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }))
const page = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 1024, height: 1024 } })
for (const icon of ICONS) {
  const pad = Math.round(icon.size * icon.inset)
  await page.setContent(`<html><body style="margin:0;background:transparent">
    <div style="width:${icon.size}px;height:${icon.size}px;background:#ffffff;border-radius:${Math.round(icon.size * icon.radius)}px;display:flex;align-items:center;justify-content:center">
      <img src="${mark}" style="width:${icon.size - pad * 2}px;height:${icon.size - pad * 2}px">
    </div></body></html>`)
  await page.waitForLoadState("load")
  writeFileSync(new URL(icon.file, pub), await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: icon.size, height: icon.size } }))
  console.log(`wrote ${icon.file}`)
}
await browser.close()
