import { api } from "@klygenixvideo/auth"
import { STUDIO } from "./hooks"
import type { Clip } from "./types"

export const CLIP_MAX_MS = 90_000

export async function createClip(body: {
  source_video_id: number
  suggestion_id?: number | null
  title: string
  start_ms: number
  end_ms: number
}): Promise<Clip> {
  const { data } = await api.post<Clip>(`${STUDIO}/clips`, {
    aspect: "9:16",
    caption_style: "bold",
    center_x: 0.5,
    ...body,
    title: body.title.slice(0, 160),
    end_ms: Math.min(body.end_ms, body.start_ms + CLIP_MAX_MS),
  })
  return data
}

export const MAX_KEYFRAMES = 60

export function cxAt(track: { t_ms: number; cx: number }[], t: number, fallback = 0.5): number {
  if (!track.length) return fallback
  if (t <= track[0].t_ms) return track[0].cx
  const last = track[track.length - 1]
  if (t >= last.t_ms) return last.cx
  for (let i = 1; i < track.length; i++) {
    const a = track[i - 1]
    const b = track[i]
    if (t <= b.t_ms) return a.cx + ((b.cx - a.cx) * (t - a.t_ms)) / Math.max(1, b.t_ms - a.t_ms)
  }
  return last.cx
}

export function sameTrack(a: { t_ms: number; cx: number }[], b: { t_ms: number; cx: number }[]): boolean {
  return a.length === b.length && a.every((k, i) => k.t_ms === b[i].t_ms && Math.abs(k.cx - b[i].cx) < 0.0005)
}
