export type TargetType = "video" | "comment" | "danmaku" | "channel"

export interface VideoTarget {
  missing?: boolean
  title?: string
  public_id?: string
  status?: string
  channel?: string | null
  thumbnail?: string | null
  kind?: string
  description?: string
}

export interface TextTarget {
  missing?: boolean
  text?: string
  status?: string
  video?: string | null
  video_title?: string | null
}

export interface ChannelTarget {
  missing?: boolean
  handle?: string
  name?: string
  suspended?: boolean
  strikes?: number
}

export type TargetSummary = VideoTarget & TextTarget & ChannelTarget

export interface QueueItem {
  target_type: TargetType
  target_id: number
  why: "held" | "reported"
  reports: number
  labels: string[]
  since: string | null
  target: TargetSummary
}

export interface ReportRow {
  id: number
  reason: string
  details: string | null
  status: string
  created_at: string
}

export interface ActionRow {
  id: number
  target_type: TargetType
  target_id: number
  action: string
  reason: string
  actor_user_id: number | null
  created_at: string
}

export interface AppealRow {
  id: number
  text: string
  status: string
  created_at: string
  action: null | {
    id: number
    action: string
    reason: string
    target_type: TargetType
    target_id: number
    target: TargetSummary
  }
}

export interface Takedown {
  id: number
  reference: string
  kind: string
  complainant_name: string
  complainant_email: string
  target_url: string
  video_id: number | null
  details: string
  sworn: boolean
  status: string
  received_at: string
  ack_due_at: string
  resolve_due_at: string
  acknowledged_at: string | null
  resolved_at: string | null
  ack_overdue: boolean
  resolve_overdue: boolean
  decision_note: string | null
}

export interface VideoStats {
  videos: {
    by_status: Record<string, number>
    published_by_kind: Record<string, number>
    minutes: number
    views: number
  }
  channels: number
  comments: number
  danmaku: number
  open_reports: number
  held_videos: number
  open_takedowns: number
  overdue_takedowns: number
  active_subscriptions: Record<string, number>
  revenue_minor: Record<string, number>
}

export interface AdminVideo {
  id: number
  public_id: string
  title: string
  description: string
  kind: "long" | "reel"
  source: string
  status: string
  status_note: string | null
  visibility: string
  published_at: string | null
  duration_ms: number | null
  ai_status: string | null
  ai_generated: boolean
  thumbnail: string | null
  views: number
  likes: number
  comments: number
  danmaku: number
  embed_platform: string | null
  created_at: string
  channel: string | null
}

export interface AiUsage {
  days: number
  providers: Record<string, string>
  jobs: { kind: string; status: string; count: number; units: number; cost_minor: number }[]
  llm: { purpose: string; status: string; count: number; input_tokens: number; output_tokens: number; cost_minor: number }[]
  budget_minor: number
}

export interface Plan {
  key: string
  audience: "viewer" | "creator"
  name: string
  description: string
  price_minor: number
  currency: string
  price_inr_minor: number
  price_usd_minor: number
  limits: Record<string, number | boolean>
  free: boolean
}

export interface MoneySummary {
  currency: string
  sales: number
  gross_minor: number
  commission_minor: number
  tcs_minor: number
  tds_minor: number
  refunded_minor: number
  held_minor: number
  reserve_minor: number
  pending_minor: number
  owed_back_minor: number
  released_minor: number
  failed: number
  accounts: Record<string, number>
}

export interface CreatorBalances {
  held_minor: number
  reserve_minor: number
  pending_minor: number
  owed_back_minor: number
  released_minor: number
  next_release_at: string | null
  currency: string
}

export interface CreatorAccount {
  status: string
  business_type: string | null
  legal_name: string
  email: string
  pan: string | null
  gstin: string | null
  ifsc: string | null
  account_last4: string | null
  requirements: { field: string; reason: string }[]
  gateway_account_id: string | null
  submitted_at: string | null
  activated_at: string | null
}

export interface CreatorMoney {
  tenant_id: number
  channel: string | null
  channel_name: string | null
  account: CreatorAccount
  balances: CreatorBalances
  ledger_owed_minor: number
}

export interface MoneyTransfer {
  id: number
  tenant_id: number
  kind: string
  amount_minor: number
  reversed_minor: number
  open_minor: number
  status: string
  hold_until: string | null
  released_at: string | null
  note: string | null
  error: string | null
  split_id: number | null
}

export interface AdminPayment {
  id: number
  checkout_id: number
  purpose: string
  plan_key: string | null
  amount_minor: number
  currency: string
  refunded_minor: number
  refundable_minor: number
  rail: string
  buyer: string | null
  channel: string | null
  created_at: string
}

export interface AdminRefund {
  id: number
  payment_id: number
  amount_minor: number
  status: string
  reason: string
  credit_note_id: number | null
  created_at: string
}
