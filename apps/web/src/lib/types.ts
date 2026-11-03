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
}

export interface PlaylistDetail extends PlaylistSummary {
  channel: ChannelCard
  videos: VideoCard[]
}

export interface SeriesProgress {
  playlist_id: number
  total: number
  completed: number
  percent: number
  next: string | null
  videos: { id: string; completed: boolean; position_ms: number }[]
}
