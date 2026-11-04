export interface ChannelCard {
  id?: number
  handle: string
  name: string
  avatar: string | null
  followers: number
  verified: boolean
}

export type Playback =
  | { type: "hls"; url: string; expires_at?: number; preview_seconds?: number }
  | { type: "youtube" | "bilibili"; url: string; source_url: string; credit: string; overlay_allowed: false }

export type Access = "free" | "members" | "paid"

export interface VideoCard {
  id: string
  access?: Access
  price_minor?: number | null
  title: string
  kind: "long" | "reel"
  source: string
  duration_ms: number
  duration: string
  thumbnail: string | null
  views: number
  likes: number
  comments?: number
  liked?: boolean
  following?: boolean
  captions?: { available: string[] }
  published_at: string | null
  ai_generated: boolean
  embed_platform: string | null
  channel: ChannelCard
  playback?: Playback | null
}

export interface Chapter {
  start_ms: number
  title: string
}

export interface LockTier {
  id: number
  name: string
  rank: number
  price_minor: number
  badge: string | null
}

export interface Lock {
  access: Access
  preview_seconds: number
  signed_in: boolean
  members_rank?: number
  tiers?: LockTier[]
  price_minor?: number | null
  currency?: string
  series?: { id: number; title: string; price_minor: number | null }[]
}

export interface ProductItem {
  id: number
  title: string
  price_text: string
  host: string
}

export interface Dub {
  language: string
  name: string
  label: string
  url: string
}

export interface VideoDetail extends VideoCard {
  description: string
  tags: string[]
  playback: Playback | null
  access: Access
  locked: Lock | null
  products: { disclosure: string; items: ProductItem[] } | null
  dubs: Dub[]
  insight: { summary: string; key_points: string[]; chapters: Chapter[]; tags: string[] } | null
  liked: boolean
  following: boolean
  resume_ms: number
  is_owner: boolean
  ai_status: string | null
  paid_partnership?: { brand: string; label: string } | null
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
}

export interface Citation {
  start_ms: number
  label: string
  text: string
}

export interface AskAnswer {
  answer: string
  citations: Citation[]
  status: "answered" | "declined"
  quota?: { used: number; limit: number }
}

export interface Channel {
  id: number
  handle: string
  name: string
  avatar: string | null
  followers: number
  video_count?: number
  strike_count?: number
  is_suspended?: boolean
}

export interface StudioVideo {
  id: number
  public_id: string
  title: string
  kind: "long" | "reel"
  status: string
  status_note: string | null
  visibility: string
  duration_ms: number | null
  ai_status: string | null
  ai_generated: boolean
  thumbnail: string | null
  views: number
  likes: number
  created_at: string
}

export interface UploadTicket {
  protocol: "put" | "tus"
  url: string
  method: string
  headers: Record<string, string>
}

export interface Suggestion {
  id: number
  start_ms: number
  end_ms: number
  duration_ms: number
  score: number
  title: string
  reason: string | null
  hook: string | null
}

export interface Clip {
  id: number
  source_video_id: number
  title: string
  start_ms: number
  end_ms: number
  status: string
  error: string | null
  output_video_id: number | null
  download_url: string | null
}

export interface Plan {
  key: string
  audience: "viewer" | "creator"
  name: string
  description: string
  price_minor: number
  currency: string
  free: boolean
}

export interface Me {
  user: { id: number; email: string; name: string; role: string }
  profile: { display_name: string; country: string; language: string }
  channel: Channel | null
  plans: { viewer: Plan | null; creator: Plan | null }
  subscriptions: { plan_key: string; status: string; current_period_end?: string | null }[]
  usage: { metric: string; label: string; used: number; limit: number | null; period: string }[]
}

export interface Note {
  id: number
  t_ms: number
  label: string
  body: string
  created_at: string
}

export interface ChannelPage {
  id: number
  handle: string
  name: string
  avatar: string | null
  banner: string | null
  followers: number
  verified: boolean
  about: string | null
  following: boolean
}

export interface Support {
  channel: string
  can_take_money: boolean
  currency: string
  tiers: (LockTier & { perks: string[] | null; is_active: boolean })[]
  my_rank: number
  is_owner: boolean
}

export interface PollOption {
  id: number
  label: string
  votes: number
}

export interface Post {
  id: number
  kind: "text" | "poll" | "image"
  body: string
  image: string | null
  members_rank: number | null
  locked: boolean
  created_at: string
  poll: { total: number; my_vote: number | null; options: PollOption[] } | null
}

export interface Membership {
  tier: (LockTier & { currency: string }) | null
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

export type LiveStatus = "scheduled" | "live" | "ended" | "failed"

export interface LiveCard {
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
  paid_minor: number
  tier: string | null
  pinned_until: string | null
  created_at: string | null
  mine?: boolean
}

export interface LiveDetail extends LiveCard {
  locked: { access: "members"; members_rank: number | null } | null
  playback: { type: "hls"; live: true; url: string; expires_at: number } | null
  is_owner: boolean
  replay: { id: string; status: string } | null
  pinned: LiveMessage[]
}

export type LiveEvent =
  | { type: "hello"; status: LiveStatus; viewers: number }
  | { type: "viewers"; viewers: number }
  | { type: "chat" | "superchat" | "gift"; item: LiveMessage }
  | { type: "chat_removed"; id: number }
  | { type: "timeout"; user_id: number; seconds: number }
  | { type: "slow_mode"; seconds: number }
  | { type: "live" }
  | { type: "ended"; reason?: string }
  | { type: "pong" }

export interface StudyNote {
  t_ms: number
  label: string
  heading?: string
  text: string
}

export interface Flashcard {
  t_ms: number
  label: string
  front: string
  back: string
}

export interface QuizItem {
  t_ms: number
  label: string
  question: string
  options: string[]
}

export interface StudySet<T> {
  kind: "notes" | "flashcards" | "quiz"
  language: string
  model: string | null
  items: T[]
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

export interface HistoryCard extends VideoCard {
  position_ms: number
  completed: boolean
  watched_at: string | null
}

export type NotifyKind = "render_ready" | "published" | "live" | "membership"

export type NotifyPrefs = Record<NotifyKind, boolean>

export interface PushRecord {
  id: number
  kind: string
  title: string
  body: string
  data: { url?: string } | null
  status: "sent" | "skipped" | "failed"
  created_at: string | null
}

export interface StudyRow {
  video: { id: string; title: string; duration_ms: number | null }
  notes: number
  best_score: number | null
  best_total: number | null
  last_activity_at: string | null
}
