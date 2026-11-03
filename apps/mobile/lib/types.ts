export interface ChannelCard {
  id?: number
  handle: string
  name: string
  avatar: string | null
  followers: number
  verified: boolean
}

export type Playback =
  | { type: "hls"; url: string; expires_at?: number }
  | { type: "youtube" | "bilibili"; url: string; source_url: string; credit: string; overlay_allowed: false }

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
  comments?: number
  liked?: boolean
  following?: boolean
  captions?: { available: string[] }
  published_at: string | null
  ai_generated: boolean
  embed_platform: string | null
  channel: ChannelCard
  playback?: Playback
}

export interface Chapter {
  start_ms: number
  title: string
}

export interface VideoDetail extends VideoCard {
  description: string
  tags: string[]
  playback: Playback
  insight: { summary: string; key_points: string[]; chapters: Chapter[]; tags: string[] } | null
  liked: boolean
  following: boolean
  resume_ms: number
  is_owner: boolean
  ai_status: string | null
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
