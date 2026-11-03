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
}

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
}

export interface StudioVideoDetail extends StudioVideo {
  thumbnail_custom?: boolean
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

export interface ChannelAnalytics {
  from: string
  to: string
  totals: { videos: number; published: number; views: number; watch_ms: number; likes: number; comments: number; danmaku: number; completions: number; followers: number }
  period: { views: number; watch_ms: number; completions: number; likes: number; followers_gained: number }
  days: DayRow[]
  top: { id: number; public_id: string; title: string; kind: "long" | "reel"; views: number; watch_ms: number }[]
}

export interface VideoAnalytics {
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
  reframe: { mode?: string; center_x?: number } | null
  caption_style: CaptionStyle
  watermark: boolean
  status: ClipStatus
  error: string | null
  output_video_id: number | null
  created_at: string
  updated_at: string
  download_url: string | null
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
}

export interface Danmaku {
  id: number
  t_ms: number
  text: string
  mode: string
  color: string
  mine: boolean
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
