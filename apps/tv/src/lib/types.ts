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
  following: boolean
}

export type Playback =
  | { type: "hls"; url: string; expires_at?: number }
  | { type: "youtube" | "bilibili"; video_id: string; url: string; source_url: string; credit: string }

export interface VideoCard {
  id: string
  title: string
  kind: "long" | "reel"
  source: string
  duration_ms: number
  duration: string
  thumbnail: string | null
  views: number
  published_at: string | null
  ai_generated: boolean
  channel: ChannelCard | null
  access?: "free" | "members" | "paid"
  paid_partnership?: PaidPartnership | null
  new?: boolean
}

export interface PaidPartnership {
  brand: string
  label: string
}

export interface Subscriptions {
  new_count: number
  since: string | null
  channels: number
  items: VideoCard[]
}

export interface Chapter {
  start_ms: number
  title: string
}

export interface VideoDetail extends VideoCard {
  description: string
  playback: Playback | null
  captions: { available: string[]; translatable: string[] }
  insight: { summary: string; chapters: Chapter[] } | null
  embed: { platform: string; url: string } | null
  locked: { access: "members" | "paid"; preview_seconds: number } | null
  paid_partnership: PaidPartnership | null
  resume_ms: number
  danmaku_count: number
}

export interface HistoryItem extends VideoCard {
  position_ms: number
  completed: boolean
}

export interface SearchResult extends VideoCard {
  moment: { start_ms: number; label: string; snippet: string } | null
}

export interface LiveStreamCard {
  id: string
  title: string
  status: "scheduled" | "live" | "ended" | string
  scheduled_at: string | null
  started_at: string | null
  viewers: number
  channel: ChannelCard | null
}

export interface LiveMessage {
  id: number
  kind: "chat" | "superchat" | "gift"
  body: string
  author: string
  paid_minor: number | null
  tier: string | null
}

export interface LiveDetail extends LiveStreamCard {
  description: string
  locked: { access: "members" } | null
  playback: { type: "hls"; url: string; expires_at?: number } | null
  replay: { id: string; status: string } | null
}

export interface AdBreaks {
  eligible: boolean
  pre: boolean
  mid: number[]
}

export interface Ad {
  token: string
  brand: string
  label: string
  skip_after_seconds: number
  click_url: string
  duration_ms: number
  playback: { url: string }
}

export interface Me {
  user: { id: number; email: string; name: string }
  profile: { display_name: string } | null
  plans: { viewer: { name: string; free: boolean } }
}

export interface DeviceStart {
  device_code: string
  user_code: string
  verification_uri: string
  verification_uri_complete: string
  expires_in: number
  interval: number
}
