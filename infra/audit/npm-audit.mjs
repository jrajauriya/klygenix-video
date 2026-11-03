/** Fail the build on any high or critical npm advisory that is not written down (§23). */

import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const allow = JSON.parse(readFileSync(join(here, "npm-allowlist.json"), "utf8"))

let raw
try {
  raw = execFileSync("npm", ["audit", "--json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
} catch (error) {
  // npm audit exits non-zero whenever it finds anything; the JSON is still on stdout.
  raw = error.stdout
}
const report = JSON.parse(raw)
const serious = Object.entries(report.vulnerabilities ?? {}).filter(([, v]) =>
  ["high", "critical"].includes(v.severity),
)

const today = new Date().toISOString().slice(0, 10)
const expired = allow.review_by < today
const covered = (name, v) =>
  name in allow.packages && v.nodes.every((node) => allow.packages[name].nodes.includes(node))
const unlisted = serious.filter(([name, v]) => !covered(name, v))
const stale = Object.keys(allow.packages).filter((name) => !serious.some(([n]) => n === name))

for (const [name, v] of serious) {
  const tag = covered(name, v) ? "allowed" : "NEW"
  console.log(`  [${tag}] ${v.severity} ${name} at ${v.nodes.join(", ")}`)
}
for (const name of stale) {
  console.log(`  [stale] ${name} is allowed but no longer vulnerable — remove it from the list`)
}

let failed = false
if (unlisted.length) {
  console.log(`\n${unlisted.length} high or critical advisory(ies) not on the allowlist.`)
  failed = true
}
if (expired && serious.length) {
  console.log(`\nThe allowlist's review date (${allow.review_by}) has passed. Look again, then move it.`)
  failed = true
}
if (stale.length) {
  console.log("\nAn allowlist entry that no longer matches anything is how the list stops meaning something.")
  failed = true
}
console.log(failed ? "\nnpm audit: FAIL" : `\nnpm audit: PASS (${serious.length} allowed, reviewed by ${allow.review_by})`)
process.exit(failed ? 1 : 0)
