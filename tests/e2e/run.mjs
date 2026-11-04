import { spawn } from "node:child_process"
import { setTimeout as wait } from "node:timers/promises"

const SERVERS = [
  { name: "web", dir: "apps/web", port: 5310, path: "/" },
  { name: "studio", dir: "apps/studio", port: 5311, path: "/" },
  { name: "admin", dir: "apps/admin", port: 5312, path: "/" },
  { name: "tv", dir: "apps/tv", port: 5313, path: "/" },
]

const started = []

async function up(port, path = "/") {
  for (let i = 0; i < 60; i += 1) {
    try {
      const response = await fetch(`http://localhost:${port}${path}`)
      if (response.ok) return true
    } catch {
    }
    await wait(500)
  }
  return false
}

function stop() {
  for (const child of started) child.kill("SIGTERM")
}

process.on("SIGINT", () => {
  stop()
  process.exit(130)
})

for (const server of SERVERS) {
  const build = spawn("npx", ["vite", "build", "--mode", "e2e", "--outDir", "dist-e2e", "--emptyOutDir"], { cwd: server.dir, stdio: "ignore" })
  const code = await new Promise((resolve) => build.on("exit", resolve))
  if (code !== 0) {
    console.log(`  [FAIL] ${server.name} did not build in e2e mode`)
    process.exit(1)
  }
}

for (const server of SERVERS) {
  const child = spawn("npx", ["vite", "preview", "--outDir", "dist-e2e", "--port", String(server.port)], {
    cwd: server.dir,
    stdio: "ignore",
    detached: false,
  })
  started.push(child)
}

let failed = 0
try {
  for (const server of SERVERS) {
    if (!(await up(server.port, server.path))) {
      console.log(`  [FAIL] ${server.name} never came up on ${server.port} — did the e2e build succeed?`)
      failed = 1
    }
  }

  if (!failed) {
    const suite = spawn("node", ["tests/e2e/screens.mjs"], { stdio: "inherit" })
    failed = await new Promise((resolve) => suite.on("exit", (code) => resolve(code ?? 1)))
    const a11y = spawn("node", ["tests/e2e/a11y.mjs"], { stdio: "inherit" })
    failed = (await new Promise((resolve) => a11y.on("exit", (code) => resolve(code ?? 1)))) || failed
  }
} finally {
  stop()
}

if (!failed) {
  await wait(1000)
  const speed = spawn("node", ["tests/e2e/speed.mjs"], { stdio: "inherit" })
  failed = await new Promise((resolve) => speed.on("exit", (code) => resolve(code ?? 1)))
}

process.exit(failed)
