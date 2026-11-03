import { api } from "./api"

export interface ProgressBody {
  position_ms: number
  watched_ms?: number
  started?: boolean
  completed?: boolean
}

export function sendProgress(publicId: string, body: ProgressBody): void {
  api
    .post(`/api/video/videos/${publicId}/progress`, {
      ...body,
      position_ms: Math.max(0, Math.round(body.position_ms)),
      watched_ms: Math.min(600_000, Math.max(0, Math.round(body.watched_ms ?? 0))),
    })
    .catch(() => null)
}
