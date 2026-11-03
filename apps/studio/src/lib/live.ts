import { useQuery } from "@tanstack/react-query"
import { api } from "@klygenixvideo/auth"
import { STUDIO } from "./hooks"
import type { MembershipTier } from "./types"

export const LIVE_STUDIO = "/api/video/studio/live"
export const LIVE_PUBLIC = "/api/video/live"

export type LiveStatus = "scheduled" | "live" | "ended" | "failed"

export interface LiveStream {
  id: string
  db_id: number
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
  error: string | null
  replay_video_id: number | null
  provider: string
  ingest: { protocol: string; server: string; browser: boolean }
  playback: { type: string; live: boolean; url: string; expires_at: number } | null
  replay: { id: string; video_id: number; status: string } | null
}

export interface LiveMessage {
  id: number
  kind: string
  body: string
  author: string
  paid_minor: number | null
  tier: string | null
  pinned_until: string | null
  created_at: string | null
  user_id?: number | null
  moderator?: boolean
}

export const LIVE_STATUS: Record<string, { label: string; hex: string }> = {
  scheduled: { label: "Scheduled", hex: "#92400e" },
  live: { label: "Live", hex: "#b91c1c" },
  ended: { label: "Ended", hex: "#475569" },
  failed: { label: "Failed", hex: "#b91c1c" },
}

export function wsUrl(path: string): string {
  const base = (api.defaults.baseURL as string | undefined) || window.location.origin
  const url = new URL(path, base)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  return url.toString()
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export function useTierOptions() {
  const { data } = useQuery({
    queryKey: ["studio-tiers", "live"],
    queryFn: async () => (await api.get<MembershipTier[]>(`${STUDIO}/memberships/tiers`)).data,
    retry: false,
    staleTime: 60_000,
  })
  const levels = data && data.length ? data.map((t) => ({ value: String(t.rank), label: `${t.name} (level ${t.rank}) and above` }))
    : [1, 2, 3, 4, 5].map((r) => ({ value: String(r), label: `Members level ${r} and above` }))
  return [{ value: "", label: "Everyone" }, ...levels]
}
