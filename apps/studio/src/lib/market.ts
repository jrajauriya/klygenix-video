import { useQuery } from "@tanstack/react-query"
import { api } from "@klygenixvideo/auth"
import { STUDIO } from "./hooks"
import type { StudioVideo } from "./types"

export interface Brand {
  name: string
  contact_email: string
  website: string | null
  gstin: string | null
  state_code: string | null
  about: string
  status: string
  created_at?: string
}

export type CampaignStatus = "draft" | "review" | "active" | "paused" | "rejected" | "ended"

export interface ReportDay {
  day: string
  impressions: number
  completes: number
  skips: number
  clicks: number
  spend_minor: number
}

export interface Campaign {
  id: string
  name: string
  status: CampaignStatus
  click_url: string
  cpm_minor: number
  budget_minor: number
  spent_minor: number
  remaining_minor: number
  refunded_minor: number
  daily_cap_minor: number | null
  start_at: string | null
  end_at: string | null
  targeting: { countries?: string[]; languages?: string[]; devices?: string[] } | null
  skip_after_seconds: number
  review_note: string | null
  created_at: string
  creative: { id: string; title: string; status: string; duration_ms: number | null } | null
  report?: {
    days: ReportDay[]
    totals: Omit<ReportDay, "day"> & { ctr_bps: number; completion_bps: number }
  }
}

export type Deliverable = "dedicated" | "integration" | "reel" | "post"

export interface Brief {
  id: string
  title: string
  description: string
  deliverable: Deliverable
  budget_min_minor: number
  budget_max_minor: number
  languages: string[]
  min_followers: number
  deadline: string | null
  status: string
  created_at: string
  brand: { name: string; website: string | null } | null
  my_application?: { id: number; status: string; quote_minor: number }
  applicants?: number
}

export interface ChannelCard {
  id: number
  handle: string
  name: string
  avatar: string | null
  followers: number
  verified: boolean
}

export interface Application {
  id: number
  pitch: string
  quote_minor: number
  status: string
  created_at: string
  channel: ChannelCard | null
}

export type DealStatus = "proposed" | "funded" | "delivered" | "approved" | "disputed" | "refunded" | "cancelled"

export interface Deal {
  id: string
  title: string
  deliverables: string
  price_minor: number
  status: DealStatus
  channel: ChannelCard | null
  brand: { name: string } | null
  video: { id: string; title: string } | null
  funded_at: string | null
  delivered_at: string | null
  approve_by: string | null
  approved_at: string | null
  auto_approved: boolean
  dispute_reason: string | null
  resolution_note: string | null
  created_at: string
  role?: "brand" | "creator"
}

export interface PayableCheckout {
  id: number
  amount_minor: number
  taxable_minor?: number
  tax_minor?: number
  rail: string
  status?: string
  client: Record<string, any> | null
}

export const CAMPAIGN_STATUS: Record<CampaignStatus, { label: string; hex: string }> = {
  draft: { label: "Draft", hex: "#475569" },
  review: { label: "In review", hex: "#92400e" },
  active: { label: "Running", hex: "#166534" },
  paused: { label: "Paused", hex: "#1d4ed8" },
  rejected: { label: "Rejected", hex: "#b91c1c" },
  ended: { label: "Ended", hex: "#475569" },
}

export const DEAL_STATUS: Record<DealStatus, { label: string; hex: string }> = {
  proposed: { label: "Waiting for funds", hex: "#92400e" },
  funded: { label: "Funded", hex: "#1d4ed8" },
  delivered: { label: "Delivered", hex: "#6d28d9" },
  approved: { label: "Approved", hex: "#166534" },
  disputed: { label: "Disputed", hex: "#b91c1c" },
  refunded: { label: "Refunded", hex: "#475569" },
  cancelled: { label: "Cancelled", hex: "#475569" },
}

export const APPLICATION_STATUS: Record<string, { label: string; hex: string }> = {
  applied: { label: "Applied", hex: "#1d4ed8" },
  accepted: { label: "Accepted", hex: "#166534" },
  declined: { label: "Declined", hex: "#475569" },
}

export const DELIVERABLES: { value: Deliverable; label: string; hint: string }[] = [
  { value: "dedicated", label: "Dedicated video", hint: "A whole video about the brand" },
  { value: "integration", label: "Integration", hint: "A segment inside a regular video" },
  { value: "reel", label: "Reel", hint: "A short vertical video" },
  { value: "post", label: "Community post", hint: "A post on the channel's community tab" },
]

export const deliverableLabel = (d: string) => DELIVERABLES.find((x) => x.value === d)?.label ?? d

export const DEVICES = [
  { value: "desktop", label: "Desktop" },
  { value: "mobile", label: "Mobile" },
  { value: "tv", label: "TV" },
]

export const CPM_MIN = 5000
export const TOPUP_MIN = 100000
export const TOPUP_MAX = 100000000
export const DEAL_MIN = 100000

export const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/

export const bps = (n: number | null | undefined) => `${((n ?? 0) / 100).toFixed(2).replace(/\.00$/, "")}%`

export const newKey = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

export function useBrand() {
  return useQuery({
    queryKey: ["studio-brand"],
    queryFn: async () => (await api.get<{ brand: Brand | null }>(`${STUDIO}/brand`)).data.brand,
  })
}

export function useDeals() {
  return useQuery({
    queryKey: ["studio-deals"],
    queryFn: async () => (await api.get<Deal[]>(`${STUDIO}/sponsorships/deals`)).data,
  })
}

export function usePublishedVideos(enabled = true) {
  return useQuery({
    queryKey: ["studio-videos", "published-picker"],
    queryFn: async () => (await api.get<StudioVideo[]>(`${STUDIO}/videos`, { params: { status: "published", limit: 100 } })).data,
    enabled,
    retry: false,
  })
}
