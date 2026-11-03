import type { ReactNode } from "react"
import { Info } from "lucide-react"
import { Badge, type BadgeColor } from "@klygenixvideo/ui"
import { useAuthStore } from "@klygenixvideo/auth"
import { formatDate, useHasPermission } from "@klygenixvideo/client"

export type Tone = { label: string; color: BadgeColor }

export const VIDEO_ADMIN = "/api/video/admin"
export const WEB_URL = (import.meta.env.VITE_WEB_URL as string | undefined) ?? "http://localhost:5300"

export const watchUrl = (publicId: string, tMs?: number) =>
  `${WEB_URL}/watch/${publicId}${tMs ? `?t=${tMs}` : ""}`

export function viewerZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  } catch {
    return "UTC"
  }
}

export const when = (v: string | null | undefined, withTime = false) => formatDate(v, viewerZone(), withTime)

export function relative(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—"
  const diff = new Date(iso).getTime() - now
  const abs = Math.abs(diff)
  const units: [number, string][] = [
    [86_400_000, "day"],
    [3_600_000, "hour"],
    [60_000, "minute"],
  ]
  for (const [ms, name] of units) {
    if (abs >= ms) {
      const n = Math.round(abs / ms)
      const label = `${n} ${name}${n === 1 ? "" : "s"}`
      return diff >= 0 ? `in ${label}` : `${label} ago`
    }
  }
  return diff >= 0 ? "in a moment" : "just now"
}

export function detail(err: any, fallback: string): string {
  const d = err?.response?.data?.detail
  if (typeof d === "string") return d
  if (d && typeof d === "object" && typeof d.message === "string") return d.message
  if (Array.isArray(d) && d[0]?.msg) return String(d[0].msg)
  return fallback
}

export function useCanAct(key: string): boolean {
  const role = useAuthStore().user?.role
  const hasFull = useHasPermission(key, "full")
  return role === "global_admin" || role === "owner" || hasFull
}

export const humanise = (s: string) => {
  const t = s.replace(/_/g, " ")
  return t.charAt(0).toUpperCase() + t.slice(1)
}

export function Status({ map, status }: { map: Record<string, Tone>; status: string | null | undefined }) {
  if (!status) return <Badge color="slate">None</Badge>
  const t = map[status] ?? { label: humanise(status), color: "slate" as BadgeColor }
  return <Badge color={t.color}>{t.label}</Badge>
}

export function Note({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={`flex gap-2.5 rounded-lg border border-brand/20 bg-brand-50 px-3.5 py-2.5 text-sm text-slate-700 ${className ?? ""}`}>
      <Info size={16} className="mt-0.5 shrink-0 text-brand" />
      <div className="min-w-0 space-y-1">{children}</div>
    </div>
  )
}

export function Row({ label, value, wide }: { label: string; value: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "col-span-2" : undefined}>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-line break-words text-sm text-slate-800">{value || "—"}</dd>
    </div>
  )
}

export const VIDEO_STATUS: Record<string, Tone> = {
  uploading: { label: "Uploading", color: "slate" },
  processing: { label: "Processing", color: "blue" },
  scanning: { label: "Scanning", color: "blue" },
  published: { label: "Published", color: "green" },
  in_review: { label: "Held for review", color: "amber" },
  blocked: { label: "Blocked", color: "red" },
  removed: { label: "Removed", color: "red" },
  restricted: { label: "Restricted", color: "amber" },
  failed: { label: "Failed", color: "red" },
  draft: { label: "Draft", color: "slate" },
}

export const TAKEDOWN_STATUS: Record<string, Tone> = {
  received: { label: "Received", color: "amber" },
  acknowledged: { label: "Acknowledged", color: "blue" },
  actioned: { label: "Actioned", color: "red" },
  rejected: { label: "Rejected", color: "slate" },
  restored: { label: "Restored", color: "green" },
}

export const REPORT_STATUS: Record<string, Tone> = {
  open: { label: "Open", color: "amber" },
  actioned: { label: "Action taken", color: "green" },
  dismissed: { label: "Dismissed", color: "slate" },
}

export const ACTION_TONE: Record<string, Tone> = {
  approve: { label: "Approved", color: "green" },
  remove: { label: "Removed", color: "red" },
  restrict: { label: "Restricted", color: "amber" },
  restore: { label: "Restored", color: "green" },
  warn: { label: "Warned", color: "amber" },
  suspend: { label: "Suspended", color: "red" },
  unsuspend: { label: "Unsuspended", color: "green" },
}

export const REASON_LABEL: Record<string, string> = {
  spam: "Spam",
  sexual: "Sexual content",
  violence: "Violence",
  hate: "Hate",
  harassment: "Harassment",
  self_harm: "Self-harm",
  child_safety: "Child safety",
  copyright: "Copyright",
  misinformation: "Misinformation",
  scam: "Scam",
  impersonation: "Impersonation",
  other: "Other",
}

export const reasonLabel = (r: string) => REASON_LABEL[r] ?? humanise(r)

export function fmtDuration(ms: number | null | undefined): string {
  if (!ms) return "—"
  const s = Math.round(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, "0")
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`
}

export const num = (n: number | null | undefined) => (n ?? 0).toLocaleString("en-IN")
