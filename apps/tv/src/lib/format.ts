const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 })

export function compactNumber(n: number): string {
  return compact.format(n)
}

export function views(n: number | null | undefined): string {
  const v = n ?? 0
  return `${compact.format(v)} ${v === 1 ? "view" : "views"}`
}

export function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, "0")
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${String(m).padStart(2, "0")}:${s}`
}

export function when(iso: string | null | undefined, lang = "en"): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleString(lang === "hi" ? "hi-IN" : "en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })
}

export function host(url: string): string {
  try {
    const u = new URL(url)
    return `${u.host}${u.pathname === "/" ? "" : u.pathname}`
  } catch {
    return url
  }
}
