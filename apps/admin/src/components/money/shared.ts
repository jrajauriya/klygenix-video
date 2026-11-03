import { formatMoney } from "@klygenixvideo/client"
import type { Tone } from "../../lib/shared"

export const inr = (minor: number | null | undefined) => formatMoney(minor, "INR")

export const MONEY = "/api/video/admin/money"

export function thisMonth(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7)
}

export const ACCOUNT_STATUS: Record<string, Tone> = {
  draft: { label: "Not submitted", color: "slate" },
  submitted: { label: "Submitted", color: "blue" },
  under_review: { label: "Being checked", color: "blue" },
  needs_clarification: { label: "Needs changes", color: "amber" },
  activated: { label: "Active", color: "green" },
  rejected: { label: "Rejected", color: "red" },
  suspended: { label: "Suspended", color: "red" },
}

export const TRANSFER_STATUS: Record<string, Tone> = {
  pending: { label: "Pending", color: "blue" },
  held: { label: "Held", color: "amber" },
  released: { label: "Released", color: "green" },
  reversed: { label: "Reversed", color: "slate" },
  recovered: { label: "Recovered", color: "slate" },
  failed: { label: "Failed", color: "red" },
}

export const PURPOSE_LABEL: Record<string, string> = {
  plan: "Plan",
  tip: "Tip",
  boost: "Danmaku boost",
  membership: "Membership",
  video: "Paid video",
  series: "Series",
}

export const purposeLabel = (p: string) => PURPOSE_LABEL[p] ?? p.replace(/_/g, " ")
