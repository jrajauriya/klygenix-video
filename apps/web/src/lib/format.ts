import { formatDistanceToNowStrict } from "date-fns"

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 })

export function compactNumber(n: number | null | undefined): string {
  return compact.format(n ?? 0)
}

export function views(n: number | null | undefined): string {
  const v = n ?? 0
  return `${compactNumber(v)} ${v === 1 ? "view" : "views"}`
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  const diff = Date.now() - d.getTime()
  if (diff < 60_000) return "just now"
  return `${formatDistanceToNowStrict(d)} ago`
}

export function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = String(s).padStart(2, "0")
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${String(m).padStart(2, "0")}:${ss}`
}

export function longDate(iso: string | null | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
}

export const LANG_NAMES: Record<string, string> = {
  en: "English",
  hi: "हिन्दी",
  mr: "मराठी",
  bn: "বাংলা",
  ta: "தமிழ்",
  te: "తెలుగు",
}

export function langName(code: string): string {
  return LANG_NAMES[code] ?? code.toUpperCase()
}

export function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return "?"
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase()
}

export function hue(seed: string): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360
  return h
}
