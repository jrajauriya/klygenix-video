export type DanmakuMode = "scroll" | "top" | "bottom"

export interface DanmakuItem {
  id: number | string
  t_ms: number
  text: string
  mode: DanmakuMode | string
  color: string
  mine?: boolean
  boost_tier?: number | null
  pin_ms?: number | null
  paid_minor?: number | null
}

export interface CaptionTrack {
  lang: string
  label: string
  src: string
}

export interface DubTrack {
  language: string
  name: string
  label: string
  url: string
}

export interface Chapter {
  start_ms: number
  title: string
}

export interface TranscriptSegment {
  start_ms: number
  end_ms: number
  label?: string
  text: string
}

export interface EmbedController {
  seek: (ms: number) => void
  play: () => void
  pause: () => void
  currentMs: () => number
}

export interface HttpClient {
  get: <T = unknown>(url: string, config?: { params?: Record<string, unknown> }) => Promise<{ data: T }>
  post: <T = unknown>(url: string, body?: unknown) => Promise<{ data: T }>
  defaults?: { baseURL?: string }
}
