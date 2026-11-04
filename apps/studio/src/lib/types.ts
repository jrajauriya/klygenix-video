export type VideoStatus = "uploading" | "processing" | "scanning" | "in_review" | "published" | "blocked" | "failed"
export type Visibility = "public" | "unlisted" | "private" | "scheduled"

export interface Channel {
  id: number
  handle: string
  name: string
  avatar: string | null
  banner: string | null
  followers: number
  verified: boolean
  about: string
  language: string
  country: string
  video_count: number
  strike_count: number
  is_suspended: boolean
  created_at: string
}

export interface StudioVideo {
  id: number
  public_id: string
  title: string
  description: string
  kind: "long" | "reel"
  source: "upload" | "embed" | "clip"
  status: VideoStatus
  status_note: string | null
  visibility: Visibility
  publish_at: string | null
  published_at: string | null
  duration_ms: number
  width: number | null
  height: number | null
  language: string
  tags: string[]
  ai_status: string | null
  ai_generated: boolean
  rights_declared: boolean
  thumbnail: string | null
  views: number
  likes: number
  comments: number
  danmaku: number
  watch_ms: number
  embed_platform: string | null
  embed_url: string | null
  created_at: string
  suggestion_count: number
  access?: VideoAccess
  price_minor?: number | null
  members_rank?: number | null
  preview_seconds?: number | null
  dubbing_allowed?: boolean
  made_for_kids?: boolean
  safety_labels?: string[] | null
}

export type VideoAccess = "free" | "members" | "paid"

export interface Insight {
  summary: string
  key_points: string[]
  chapters: { start_ms: number; title: string }[]
  tags: string[]
  title_ideas: string[]
  hashtags: string[]
  model: string
}

export type Playback =
  | { type: "hls"; url: string; expires_at?: number }
  | { type: "youtube" | "bilibili"; url: string; source_url?: string; credit?: string; overlay_allowed?: boolean }

export interface ThumbnailIdea {
  at_ms: number
  key: string
  reason: string
  url: string
  chosen: boolean
  ai?: boolean
}

export interface StudioVideoDetail extends StudioVideo {
  thumbnail_custom?: boolean
  thumbnail_ai?: boolean
  thumbnail_ideas?: ThumbnailIdea[]
  insight: Insight | null
  playback: Playback | null
  captions: { available: string[]; translatable: string[]; sources: { language: string; source: string }[] }
}

export interface DayRow {
  day: string
  views: number
  watch_ms: number
  completions: number
  likes: number
}

export interface SourceRow {
  source: string
  views: number
}

export interface ExternalRow {
  host: string
  views: number
}

export interface Revenue {
  currency: string
  gross_minor: number
  net_minor: number
  by_purpose: { purpose: string; sales: number; gross_minor: number; net_minor: number }[]
  by_day: { day: string; gross_minor: number }[]
}

export interface ChannelAnalytics {
  sources?: SourceRow[]
  external?: ExternalRow[]
  revenue?: Revenue
  from: string
  to: string
  totals: { videos: number; published: number; views: number; watch_ms: number; likes: number; comments: number; danmaku: number; completions: number; followers: number }
  period: { views: number; watch_ms: number; completions: number; likes: number; followers_gained: number }
  days: DayRow[]
  top: { id: number; public_id: string; title: string; kind: "long" | "reel"; views: number; watch_ms: number }[]
}

export interface VideoAnalytics {
  retention?: { at_pct: number; audience: number }[]
  sources?: SourceRow[]
  external?: ExternalRow[]
  id: number
  public_id: string
  from: string
  to: string
  totals: { views: number; watch_ms: number; completions: number; likes: number; comments: number; danmaku: number; completion_rate: number; avg_view_ms: number }
  days: DayRow[]
}

export interface InboxItem {
  id: number
  kind: "comment" | "danmaku"
  video_id: number
  video_public_id: string
  video_title: string
  status: "visible" | "hidden" | string
  report_count: number
  created_at: string
  body: string
  author: string
  parent_id?: number | null
  t_ms?: number
  mode?: string
  color?: string
  paid_minor?: number | null
  boost_tier?: number | null
}

export interface UploadTicket {
  protocol: "put" | "tus"
  url: string
  method: string
  headers: Record<string, string>
  provider_video_id: string
  expires_at: string | number | null
}

export interface Suggestion {
  id: number
  start_ms: number
  end_ms: number
  duration_ms: number
  score: number
  title: string
  reason: string
  hook: string
}

export type ClipStatus = "draft" | "queued" | "rendering" | "rendered" | "failed" | "published" | "processing"
export type Aspect = "9:16" | "1:1" | "16:9"
export type CaptionStyle = "none" | "clean" | "bold" | "karaoke"

export interface Clip {
  id: number
  source_video_id: number
  suggestion_id: number | null
  title: string
  start_ms: number
  end_ms: number
  duration_ms: number
  aspect: Aspect
  reframe: Reframe | null
  caption_style: CaptionStyle
  watermark: boolean
  status: ClipStatus
  error: string | null
  output_video_id: number | null
  created_at: string
  updated_at: string
  download_url: string | null
  music?: ClipMusic | Record<string, never>
}

export interface Keyframe {
  t_ms: number
  cx: number
}

export interface Reframe {
  mode?: "center" | "manual" | "track" | string
  center_x?: number
  track?: Keyframe[]
  status?: "tracking" | "ready" | "failed" | string
  found?: number
  samples?: number
  detector?: string
  error?: string
}

export interface ClipMusic {
  track_id: number
  title?: string
  volume: number
  duck: boolean
}

export interface MusicTrack {
  id: number
  title: string
  artist: string
  mood: string
  duration_ms: number
  licence: string
  licence_url?: string
}

export interface PublishTarget {
  id?: number
  platform: "youtube" | "instagram"
  status: "scheduled" | "queued" | "publishing" | "published" | "failed" | "cancelled" | string
  caption?: string
  scheduled_at?: string | null
  external_id: string | null
  external_url: string | null
  error: string | null
}

export interface TranscriptSegment {
  idx: number
  start_ms: number
  end_ms: number
  text: string
}

export interface TranscriptOut {
  transcript: { id: number; language: string; source: string; provider: string; version: number; edited: boolean } | null
  segments: TranscriptSegment[]
}

export interface Comment {
  id: number
  body: string
  author: string
  parent_id: number | null
  status: string
  created_at: string
  replies: number
  mine: boolean
  paid_minor?: number | null
}

export interface Danmaku {
  id: number
  t_ms: number
  text: string
  mode: string
  color: string
  mine: boolean
  boost_tier?: number | null
  paid_minor?: number | null
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

export interface Usage {
  metric: string
  label: string
  used: number
  limit: number | null
  period: string
}

export interface Me {
  user: { id: number; email: string; name: string; role: string }
  profile: { display_name: string; country: string; language: string } | null
  channel: { id: number; handle: string; name: string; avatar: string | null; followers: number; verified: boolean } | null
  plans: { viewer: Plan; creator: Plan }
  subscriptions: {
    plan_key: string
    audience: string
    status: string
    current_period_end: string | null
    cancel_at_period_end: boolean
  }[]
  usage: Usage[]
}

export interface Checkout {
  id: number
  plan_key: string
  amount_minor: number
  taxable_minor: number
  tax_minor: number
  currency: string
  rail: "sandbox" | "razorpay" | "lemonsqueezy" | string
  status: string
  client: Record<string, any> | null
}

export interface Invoice {
  id: number
  number: string
  date: string
  total_minor: number
  currency: string
  kind: string
  has_pdf: boolean
}

export interface Connected {
  id: number
  platform: string
  external_channel_id: string
  title: string
  status: string
  last_synced_at: string | null
  videos: number
  sandbox: boolean
}

export interface RemoteVideo {
  external_id: string
  title: string
  duration_ms: number
  published_at: string | null
  imported: boolean
  public_id: string | null
}

export interface ImportItem {
  external_id: string
  title: string | null
  status: "pending" | "done" | "failed" | "skipped"
  error: string | null
  video_id: number | null
  public_id: string | null
}

export interface ImportJob {
  id: number
  connected_id: number
  status: "queued" | "running" | "done" | "failed" | string
  total: number
  done: number
  failed: number
  created_at: string
  finished_at: string | null
  items?: ImportItem[]
}

export interface ModerationAction {
  id: number
  target_type: string
  target_id: string | number
  action: string
  reason: string
  created_at: string
  appeal: { status: string; note: string | null } | null
}

export interface Strike {
  id: number
  reason: string
  expires_at: string | null
  lifted: boolean
}

export type PlaylistKind = "playlist" | "series"
export type PlaylistVisibility = "public" | "unlisted" | "private"

export interface Playlist {
  id: number
  title: string
  description: string
  kind: PlaylistKind
  visibility: PlaylistVisibility
  video_count: number
  cover: string | null
  created_at: string
  price_minor?: number | null
}

export interface PlaylistCard {
  id: string
  title: string
  kind: "long" | "reel"
  duration: string
  thumbnail: string | null
  views: number
}

export interface PlaylistDetail extends Playlist {
  videos: PlaylistCard[]
}

export interface PayoutAddress {
  street1?: string
  street2?: string
  city?: string
  state?: string
  postal_code?: string
}

export interface PayoutAccount {
  status: string
  business_type: string | null
  legal_name: string
  contact_name: string
  email: string
  phone: string
  pan: string | null
  gstin: string | null
  address: PayoutAddress
  beneficiary_name: string | null
  ifsc: string | null
  account_last4: string | null
  requirements: { field: string; reason: string }[]
  gateway_account_id: string | null
  submitted_at: string | null
  activated_at: string | null
  editable: boolean
}

export interface Balances {
  held_minor: number
  reserve_minor: number
  pending_minor: number
  owed_back_minor: number
  released_minor: number
  next_release_at: string | null
  currency: string
}

export interface MoneyTotals {
  gross_minor: number
  commission_minor: number
  commission_tax_minor: number
  tcs_minor: number
  tds_minor: number
  net_minor: number
  refunded_minor: number
}

export interface Earnings {
  account: PayoutAccount | null
  problems: string[]
  can_take_money: boolean
  problem: string | null
  balances: Balances
  commission_bps: number
  refund_window_days: number
  reserve_bps: number
  month: string
  month_totals: MoneyTotals
  month_by_purpose: Record<string, number>
}

export interface Transfer {
  id: number
  kind: "sale" | "reserve" | "recovery"
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

export interface Sale extends MoneyTotals {
  id: number
  purpose: string
  reference: string
  paid_at: string
  taxable_minor: number
  seller_tax_minor: number
  commission_bps: number
  reserve_minor: number
  commission_invoice_id: number | null
}

export interface Statement {
  month: string
  currency: string
  sales: Sale[]
  totals: MoneyTotals
  by_purpose: Record<string, number>
  released_minor: number
  released: number
}

export interface CommissionInvoice {
  id: number
  number: string
  date: string
  taxable_minor: number
  tax_minor: number
  total_minor: number
  month: string | null
}

export interface MembershipTier {
  id: number
  name: string
  rank: number
  price_minor: number
  currency?: string
  perks: string
  badge: string
  is_active: boolean
}

export interface ProductLink {
  id: number
  title: string
  url: string
  price_text: string
  position: number
  clicks: number
  host: string
}

export interface PostItem {
  id: number
  kind: "text" | "poll" | "image"
  body: string
  image: string | null
  members_rank: number | null
  status: string
  created_at: string
  poll: { total: number; options: { id: number; label: string; votes: number }[] } | null
}

export interface Moderator {
  id: number
  user_id: number
  name: string
  email: string
  added_at: string
}

export interface Dub {
  language: string
  name: string
  status: "queued" | "ready" | "failed" | string
  voice: string | null
  model: string | null
  error: string | null
  label: string
}

export interface ChapterRow {
  start_ms: number
  title: string
}

export interface ChaptersOut {
  chapters: ChapterRow[]
  version: number
  history: { version: number; by: "ai" | "creator"; count: number; chapters: ChapterRow[]; created_at: string }[]
}

export interface RepurposePack {
  id: number
  language: string
  blog_post: string
  x_post: string
  linkedin_post: string
  instagram_caption: string
  newsletter: string
  citations: { start_ms: number; label: string; text: string }[]
  model: string
  created_at: string
}

export interface RepurposePackRow {
  id: number
  language: string
  model: string
  created_at: string
  preview: string
}

export interface CalendarItem {
  type: "video" | "clip"
  id: number
  public_id?: string
  clip_id?: number
  kind?: "long" | "reel"
  title: string
  at: string | null
  target: "play" | "youtube" | "instagram" | string
  status: string
  error?: string | null
}

export interface InboxNote {
  id: number
  kind: string
  title: string
  body: string
  url: string | null
  image: string | null
  read: boolean
  created_at: string
}
