import type { Tone } from "../../lib/shared"

export const SUPPORT = "/api/video/admin/support"

export interface SupportChannel {
  id: number
  handle: string
  name: string
  strikes: number
  suspended: boolean
}

export interface SupportUser {
  id: number
  email: string
  name: string | null
  tenant_id: number | null
  role: string
  is_active: boolean
  verified: boolean
  home_region: string | null
  created_at: string | null
  last_login: string | null
  two_step: boolean
  channel: SupportChannel | null
}

export interface SupportEvent {
  at: string | null
  kind: string
  title: string
  detail: string
  payment_id?: number | null
  amount_minor?: number | null
  strike_id?: number | null
}

export interface SupportAccount {
  user: SupportUser
  events: SupportEvent[]
}

export interface SupportSession {
  access_token: string
  session_id: number
  expires_at: string
  read_only: boolean
}

export const EVENT_KIND: Record<string, Tone> = {
  signup: { label: "Sign-up", color: "navy" },
  verified: { label: "Verified", color: "green" },
  sign_in: { label: "Sign-in", color: "blue" },
  purchase: { label: "Purchase", color: "brand" },
  refund: { label: "Refund", color: "amber" },
  strike: { label: "Strike", color: "red" },
  report: { label: "Report", color: "amber" },
  takedown: { label: "Takedown", color: "red" },
  mail: { label: "Mail", color: "slate" },
  team: { label: "Team", color: "purple" },
}
