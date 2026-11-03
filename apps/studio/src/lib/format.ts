import { formatDate } from "@klygenixvideo/client"

export const TZ = "Asia/Kolkata"
export const WEB_URL: string = (import.meta.env.VITE_WEB_URL as string | undefined) || "http://localhost:5300"

export const channelUrl = (handle: string) => `${WEB_URL.replace(/\/$/, "")}/@${handle}`
export const watchUrl = (publicId: string) => `${WEB_URL.replace(/\/$/, "")}/watch/${publicId}`

export function detail(err: unknown, fallback: string): string {
  const d = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  if (typeof d === "string") return d
  if (d && typeof d === "object" && "message" in d && typeof (d as { message: unknown }).message === "string") {
    return (d as { message: string }).message
  }
  return fallback
}

export function status(err: unknown): number | undefined {
  return (err as { response?: { status?: number } })?.response?.status
}

export function clock(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—"
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = String(s).padStart(2, "0")
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`
}

export function seconds(ms: number): string {
  return (ms / 1000).toFixed(1)
}

export function compact(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—"
  return new Intl.NumberFormat("en-IN", { notation: n >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(n)
}

export function watchTime(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  if (ms > 0 && minutes === 0) return `${Math.round(ms / 1000)} s`
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `${h} h ${m} min` : `${h} h`
}

export function when(value: string | null | undefined, withTime = false): string {
  return formatDate(value, TZ, withTime)
}

export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function fromLocalInput(local: string): string | null {
  if (!local) return null
  const d = new Date(local)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export function splitTags(text: string): string[] {
  return text
    .split(/[,\n#]/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 12)
}

export const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "hi", label: "Hindi" },
  { value: "mr", label: "Marathi" },
  { value: "bn", label: "Bengali" },
  { value: "ta", label: "Tamil" },
  { value: "te", label: "Telugu" },
  { value: "kn", label: "Kannada" },
  { value: "ml", label: "Malayalam" },
  { value: "gu", label: "Gujarati" },
  { value: "pa", label: "Punjabi" },
]

export const languageName = (code: string) => LANGUAGES.find((l) => l.value === code)?.label ?? code.toUpperCase()
