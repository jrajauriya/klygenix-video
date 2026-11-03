import { useQuery } from "@tanstack/react-query"
import { api, useAuthStore } from "@klygenixvideo/auth"
import type { Channel, ChannelAnalytics, Me, Plan } from "./types"

export const STUDIO = "/api/video/studio"

export const MULTIPART = { headers: { "Content-Type": "multipart/form-data" } }

export function useChannel() {
  const token = useAuthStore((s) => s.token)
  return useQuery<Channel | null>({
    queryKey: ["studio-channel"],
    queryFn: async () => (await api.get(`${STUDIO}/channel`)).data.channel ?? null,
    enabled: Boolean(token),
    staleTime: 60_000,
  })
}

export function useMe(refetchInterval?: number | false) {
  return useQuery<Me>({
    queryKey: ["video-me"],
    queryFn: async () => (await api.get("/api/video/me")).data,
    refetchInterval,
  })
}

export function usePlans() {
  return useQuery<Plan[]>({
    queryKey: ["video-plans"],
    queryFn: async () => (await api.get("/api/video/plans")).data,
    staleTime: 5 * 60_000,
  })
}

export type RangeDays = 7 | 28 | 90

export const RANGES: RangeDays[] = [7, 28, 90]

function istToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())
}

export function rangeDates(days: number): { from: string; to: string } {
  const to = istToday()
  const start = new Date(`${to}T00:00:00Z`)
  start.setUTCDate(start.getUTCDate() - (days - 1))
  return { from: start.toISOString().slice(0, 10), to }
}

export function parseRange(value: string | null): RangeDays {
  const n = Number(value)
  return RANGES.includes(n as RangeDays) ? (n as RangeDays) : 28
}

export function useChannelAnalytics(days: number) {
  const { from, to } = rangeDates(days)
  return useQuery({
    queryKey: ["studio-analytics", from, to],
    queryFn: async () => (await api.get<ChannelAnalytics>(`${STUDIO}/analytics`, { params: { from, to } })).data,
  })
}
