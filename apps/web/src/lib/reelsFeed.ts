import { api } from "@klygenixvideo/auth"
import type { VideoCard } from "./types"

export const REELS_PAGE = 10

export const reelsKey = (signedIn: boolean) => ["feed", "reels", "infinite", signedIn] as const

export async function reelsPage({ pageParam }: { pageParam: number }) {
  const res = await api.get<VideoCard[]>("/api/video/feed/reels", { params: { limit: REELS_PAGE, offset: pageParam } })
  return { rows: res.data, offset: pageParam, total: Number(res.headers["x-total-count"] ?? 0) }
}
