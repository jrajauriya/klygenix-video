import type { ReactNode } from "react"
import { Link } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { AlertTriangle } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { StatusPill } from "@klygenixvideo/ui"
import { formatMoney, toMinor } from "@klygenixvideo/client"
import { STUDIO } from "../../lib/hooks"
import type { Earnings, MembershipTier } from "../../lib/types"

export const inr = (minor: number | null | undefined) => formatMoney(minor, "INR")

export const PRICE_MIN = 1000
export const PRICE_MAX = 5_000_000

export function parseRupees(text: string): number | null {
  const clean = text.replace(/[₹,\s]/g, "")
  if (!clean || !/^\d+(\.\d{1,2})?$/.test(clean)) return null
  return toMinor(clean, "INR")
}

export function priceProblem(minor: number | null): string | null {
  if (minor === null) return "Enter a price in rupees, like 49 or 99.50."
  if (minor < PRICE_MIN || minor > PRICE_MAX) return `The price must be between ${inr(PRICE_MIN)} and ${inr(PRICE_MAX)}.`
  return null
}

export function useEarnings(enabled = true) {
  return useQuery({
    queryKey: ["studio-earnings"],
    queryFn: async () => (await api.get<Earnings>(`${STUDIO}/earnings`)).data,
    enabled,
  })
}

export function useTiers(enabled = true) {
  return useQuery({
    queryKey: ["studio-tiers"],
    queryFn: async () => (await api.get<MembershipTier[]>(`${STUDIO}/memberships/tiers`)).data,
    enabled,
  })
}

export const PURPOSES: { key: string; label: string; hint: string }[] = [
  { key: "tip", label: "Tips", hint: "Paid comments and super chats" },
  { key: "boost", label: "Danmaku boosts", hint: "Pinned, coloured bullet comments" },
  { key: "membership", label: "Memberships", hint: "Monthly channel members" },
  { key: "video", label: "Paid videos", hint: "One-off video purchases" },
  { key: "series", label: "Series", hint: "Whole-series purchases" },
]

export const purposeLabel = (key: string) => PURPOSES.find((p) => p.key === key)?.label ?? key.replace(/_/g, " ")

const ACCOUNT_STATUS: Record<string, { label: string; hex: string }> = {
  draft: { label: "Not submitted", hex: "#475569" },
  submitted: { label: "Submitted", hex: "#1d4ed8" },
  under_review: { label: "Being checked", hex: "#1d4ed8" },
  needs_clarification: { label: "Needs changes", hex: "#92400e" },
  activated: { label: "Active", hex: "#166534" },
  rejected: { label: "Rejected", hex: "#b91c1c" },
  suspended: { label: "Suspended", hex: "#b91c1c" },
}

export function AccountStatusPill({ status }: { status: string | null | undefined }) {
  const s = status ? ACCOUNT_STATUS[status] ?? { label: status.replace(/_/g, " "), hex: "#475569" } : { label: "Not set up", hex: "#475569" }
  return <StatusPill label={s.label} hex={s.hex} />
}

const TRANSFER_STATUS: Record<string, { label: string; hex: string }> = {
  pending: { label: "On the way", hex: "#1d4ed8" },
  held: { label: "Held", hex: "#92400e" },
  released: { label: "Released", hex: "#166534" },
  reversed: { label: "Reversed", hex: "#475569" },
  recovered: { label: "Recovered", hex: "#475569" },
  failed: { label: "Failed", hex: "#b91c1c" },
}

export function TransferStatusPill({ status }: { status: string }) {
  const s = TRANSFER_STATUS[status] ?? { label: status.replace(/_/g, " "), hex: "#475569" }
  return <StatusPill label={s.label} hex={s.hex} />
}

export const TRANSFER_KIND: Record<string, string> = {
  sale: "Sale",
  reserve: "Reserve",
  recovery: "Recovery",
}

export const TRANSFER_FILTERS = [
  { value: "", label: "Any status" },
  ...Object.entries(TRANSFER_STATUS).map(([value, s]) => ({ value, label: s.label })),
]

export function PayoutsOff({ children, action = true }: { children?: ReactNode; action?: boolean }) {
  return (
    <div role="status" className="mb-4 flex gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900">
      <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-700" aria-hidden="true" />
      <div className="min-w-0">
        <p>
          {children ?? "Tips, danmaku boosts, memberships, paid videos and paid series are off until your payouts are active."}
          {action && (
            <>
              {" "}
              <Link to="/earnings?tab=payouts" className="font-semibold underline">Set up payouts</Link>
            </>
          )}
        </p>
      </div>
    </div>
  )
}
