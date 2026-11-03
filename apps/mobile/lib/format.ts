import { formatMoney } from "@klygenixvideo/client/src/native"

import type { Access } from "./types"

export function clock(ms: number | null | undefined): string {
  const total = Math.max(0, Math.floor((ms ?? 0) / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const sec = String(total % 60).padStart(2, "0")
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`
}

export function compact(n: number | null | undefined): string {
  const v = n ?? 0
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`
  if (v >= 1_000) return `${(v / 1_000).toFixed(1).replace(/\.0$/, "")}K`
  return String(v)
}

export function humanise(s: string): string {
  const t = s.replace(/_/g, " ")
  return t.charAt(0).toUpperCase() + t.slice(1)
}

export function price(minor: number | null | undefined, currency = "INR"): string {
  return formatMoney(minor, currency).replace(/\.00$/, "")
}

export function accessLabel(access: Access | undefined, minor?: number | null): string | null {
  if (access === "members") return "Members"
  if (access === "paid") return minor ? price(minor) : "Paid"
  return null
}

export function day(iso: string | null | undefined): string {
  if (!iso) return ""
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
}
