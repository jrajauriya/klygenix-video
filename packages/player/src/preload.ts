export function preloadHls(): void {
  void import("hls.js").catch(() => undefined)
}

const warmed = new Set<string>()

async function firstLine(url: string, test: (line: string) => boolean): Promise<string | null> {
  const res = await fetch(url, { credentials: "omit" })
  if (!res.ok) return null
  const line = (await res.text()).split("\n").map((l) => l.trim()).find(test)
  return line ? new URL(line, url).toString() : null
}

export function warmHls(master: string | null | undefined): void {
  if (!master || warmed.has(master) || !/\.m3u8(\?|$)/i.test(master)) return
  warmed.add(master)
  const isUri = (l: string) => l.length > 0 && !l.startsWith("#")
  void firstLine(master, isUri)
    .then((variant) => (variant ? firstLine(variant, isUri) : null))
    .then((segment) => (segment ? fetch(segment, { credentials: "omit" }) : null))
    .catch(() => undefined)
}
