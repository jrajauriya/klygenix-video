export interface ChannelCard {
  id: number
  handle: string
  name: string
  avatar: string | null
  banner: string | null
  followers: number
  verified: boolean
}

export interface ChannelDetail extends ChannelCard {
  about: string
  created_at: string | null
  following: boolean
}

export type Playback =
  | { type: "hls"; url: string; expires_at?: number }
  | { type: "youtube" | "bilibili"; video_id: string; url: string; source_url: string; credit: string; overlay_allowed: false }

export interface VideoCard {
  id: string
  title: string
  kind: "long" | "reel"
  source: string
  duration_ms: number
  duration: string
  thumbnail: string | null
  views: number
  likes: number
  published_at: string | null
  language?: string
  ai_generated: boolean
  embed_platform: string | null
  channel: ChannelCard | null
  playback?: Playback | null
  comments?: number
  captions?: { available: string[]; translatable?: string[] }
  liked?: boolean
  following?: boolean
  access?: VideoAccess
  price_minor?: number | null
  locked?: boolean | VideoLock | null
  paid_partnership?: PaidPartnership | null
}

export interface PaidPartnership {
  brand: string
  label: string
}

export type VideoAccess = "free" | "members" | "paid"

export interface LockTier {
  id: number
  name: string
  rank: number
  price_minor: number
  badge: string
}

export interface VideoLock {
  access: "members" | "paid"
  preview_seconds: number
  signed_in: boolean
  members_rank?: number
  tiers?: LockTier[]
  price_minor?: number | null
  currency?: string
  series?: { id: number; title: string; price_minor: number }[]
}

export interface Insight {
  language?: string
  summary: string
  key_points: string[]
  chapters: { start_ms: number; title: string }[]
  tags: string[]
  model?: string
}

export interface VideoDetail extends VideoCard {
  description: string
  tags: string[]
  status: string
  visibility: string
  comments: number
  danmaku_count: number
  playback: Playback | null
  ai_status: string
  captions: { available: string[]; translatable: string[] }
  insight: Insight | null
  embed: { platform: string; url: string; owner_verified: boolean } | null
  liked: boolean
  following: boolean
  resume_ms: number
  is_owner: boolean
  locked: VideoLock | null
  products?: { disclosure: string; items: ProductLink[] } | null
  dubs?: { language: string; name: string; label: string; url: string }[]
}

export interface HistoryItem extends VideoCard {
  position_ms: number
  completed: boolean
  watched_at: string | null
}

export interface SearchResult extends VideoCard {
  moment: { start_ms: number; label: string; snippet: string } | null
  score: number
}

export interface CommentRow {
  id: number
  body: string
  author: string
  parent_id: number | null
  status: string
  created_at: string | null
  replies: number
  mine: boolean
  is_creator: boolean
  paid_minor?: number | null
  author_channel: { handle: string; name: string; avatar: string | null } | null
}

export interface Segment {
  start_ms: number
  end_ms: number
  label: string
  text: string
}

export interface Citation {
  start_ms: number
  label: string
  text: string
}

export interface Quota {
  metric?: string
  label?: string
  used: number
  limit: number | null
  period?: string
}

export interface AskMessage {
  id: number
  question: string
  answer: string
  citations: Citation[]
  status: "answered" | "declined" | string
  created_at: string | null
}

export interface Plan {
  key: string
  audience: "viewer" | "creator"
  name: string
  description: string
  price_minor: number
  currency: string
  limits: Record<string, number | boolean>
  free: boolean
}

export interface Me {
  user: { id: number; email: string; name: string; role: string }
  profile: { display_name: string; country: string; language: string } | null
  channel: ChannelCard | null
  plans: { viewer: Plan; creator: Plan }
  subscriptions: { plan_key: string; audience: string; status: string; current_period_end: string | null; cancel_at_period_end: boolean }[]
  usage: Quota[]
}

export interface Checkout {
  id: number
  plan_key: string
  amount_minor: number
  taxable_minor: number
  tax_minor: number
  currency: string
  rail: string
  status: string
  client: Record<string, unknown> | null
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

export interface ModerationAction {
  id: number
  target_type: string
  target_id: number
  action: string
  reason: string
  created_at: string | null
  appeal: { status: string; note: string | null } | null
}

export interface Moderation {
  actions: ModerationAction[]
  strikes: { id: number; reason: string; expires_at: string | null; lifted: boolean }[]
}

export interface PlaylistSummary {
  id: number
  title: string
  description: string
  kind: "playlist" | "series"
  visibility: "public" | "unlisted" | "private"
  video_count: number
  cover: string | null
  created_at: string | null
  price_minor?: number | null
}

export interface PlaylistDetail extends PlaylistSummary {
  channel: ChannelCard
  videos: VideoCard[]
  owned?: boolean
}

export interface SeriesProgress {
  playlist_id: number
  total: number
  completed: number
  percent: number
  next: string | null
  videos: { id: string; completed: boolean; position_ms: number }[]
}

export interface BoostTier {
  tier: number
  price_minor: number
  pin_ms: number
  color: string
  label: string
}

export interface MemberTier {
  id: number
  name: string
  rank: number
  price_minor: number
  currency: string
  perks: string
  badge: string
  is_active: boolean
}

export interface ChannelSupport {
  channel: string
  can_take_money: boolean
  tip_min_minor: number
  tip_max_minor: number
  currency: string
  boost_tiers: BoostTier[]
  tiers: MemberTier[]
  my_rank: number
  is_owner: boolean
  commission_bps?: number
  superchat_tiers?: SuperchatTier[]
  gifts?: LiveGift[]
}

export interface SuperchatTier {
  tier: number
  price_minor: number
  pin_seconds: number
  color: string
  label: string
}

export interface LiveGift {
  gift: string
  price_minor: number
  label: string
}

export type SupportPurpose = "tip" | "boost" | "membership" | "video" | "series" | "superchat" | "gift"

export type LiveStatus = "scheduled" | "live" | "ended" | "failed"

export interface LiveStreamCard {
  id: string
  title: string
  description: string
  status: LiveStatus
  scheduled_at: string | null
  started_at: string | null
  ended_at: string | null
  members_rank: number | null
  slow_mode_seconds: number
  viewers: number
  peak_viewers: number
  replay_enabled: boolean
  channel: ChannelCard | null
}

export interface LiveMessage {
  id: number
  kind: "chat" | "superchat" | "gift"
  body: string
  author: string
  paid_minor: number | null
  tier: string | null
  pinned_until: string | null
  created_at: string | null
  moderator?: boolean
  mine?: boolean
}

export interface LiveDetail extends LiveStreamCard {
  locked: { access: "members"; members_rank: number | null } | null
  playback: { type: "hls"; live: boolean; url: string; expires_at?: number } | null
  is_owner: boolean
  replay: { id: string; status: string } | null
  pinned: LiveMessage[]
}

export interface SupportCheckout {
  id: number
  amount_minor: number
  taxable_minor: number
  tax_minor: number
  currency: string
  rail: string
  status: string
  client: Record<string, unknown> | null
  quote: Record<string, unknown> | null
  purpose: SupportPurpose
  target: Record<string, unknown> | null
}

export interface Membership {
  tier: MemberTier | null
  channel: string | null
  channel_name: string | null
  status: string
  current_period_end: string | null
  cancel_at_period_end: boolean
}

export interface Purchase {
  kind: "video" | "series"
  id: string | number | null
  title: string
  bought_at: string | null
}

export interface StudySet<T> {
  kind: string
  language: string
  model: string
  items: T[]
}

export interface StudyNote {
  t_ms: number
  label: string
  heading?: string
  text: string
}

export interface Flashcard {
  front: string
  back: string
  t_ms: number
  label: string
}

export interface QuizItem {
  question: string
  options: string[]
  t_ms: number
  label: string
}

export interface QuizResult {
  id: number
  score: number
  total: number
  results: { index: number; given: number | null; correct: number; right: boolean; t_ms: number; label: string }[]
}

export interface QuizAttempt {
  id: number
  score: number
  total: number
  created_at: string | null
}

export interface PersonalNote {
  id: number
  t_ms: number
  label: string
  body: string
  created_at: string | null
}

export interface ScopedCitation {
  video_id: string
  title: string
  start_ms: number
  label: string
  text: string
}

export interface ScopedAnswer {
  id: number
  scope: string
  question: string
  answer: string
  citations: ScopedCitation[]
  status: "answered" | "declined" | string
  videos: number
  quota?: Quota
}

export interface PollOption {
  id: number
  label: string
  votes: number
}

export interface CommunityPost {
  id: number
  kind: "text" | "poll" | "image"
  body: string
  image: string | null
  members_rank: number | null
  locked: boolean
  created_at: string | null
  poll: { total: number; my_vote: number | null; options: PollOption[] } | null
}

export interface Translation {
  lang: string
  machine_translation: boolean
  items: { id: number; text: string; model: string }[]
}

export type CommentSummary =
  | { available: true; summary: string; topics: string[]; quotes: string[]; count: number; model?: string }
  | { available: false; count: number; needed: number }

export interface ProductLink {
  id: number
  title: string
  price_text: string
  position: number
  host: string
}

export interface AdBreaks {
  eligible: boolean
  reason: string | null
  pre: boolean
  mid: number[]
}

export interface MyTakedown {
  reference: string
  kind: string
  status: string
  received_at: string | null
  complainant_name: string
  details: string
  target_url: string | null
  video: { id: string; title: string; status: string } | null
  counter_notice: Record<string, unknown> | null
  countered_at: string | null
  restore_due_at: string | null
  can_counter: boolean
  decision_note: string | null
}

export interface SignupState {
  open: boolean
  mode: "open" | "invite" | "closed"
  creator: "open" | "invite" | "closed"
}
