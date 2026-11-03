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
