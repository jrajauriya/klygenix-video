import { useQuery } from "@tanstack/react-query"
import { api, useAuthStore } from "@klygenixvideo/auth"
import type { Me } from "./types"

export const API_BASE = String(api.defaults.baseURL ?? "").replace(/\/$/, "")
export const STUDIO_URL = import.meta.env.VITE_STUDIO_URL || "http://localhost:5301"

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`
}

export function errText(err: unknown, fallback = "Something went wrong. Please try again."): string {
  const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  if (typeof detail === "string" && detail) return detail
  if (Array.isArray(detail) && detail[0]?.msg) return String(detail[0].msg)
  return fallback
}

export function errStatus(err: unknown): number | undefined {
  return (err as { response?: { status?: number } })?.response?.status
}

export function useSignedIn(): boolean {
  const token = useAuthStore((s) => s.token)
  const user = useAuthStore((s) => s.user)
  return Boolean(token && user)
}

export function useMe() {
  const signedIn = useSignedIn()
  return useQuery({
    queryKey: ["me"],
    enabled: signedIn,
    queryFn: async () => (await api.get<Me>("/api/video/me")).data,
  })
}

export async function getJson<T>(path: string, params?: Record<string, unknown>): Promise<T> {
  const { data } = await api.get<T>(path, { params })
  return data
}

export function loginPath(returnUrl?: string): string {
  const back = returnUrl ?? `${window.location.pathname}${window.location.search}`
  return `/login?returnUrl=${encodeURIComponent(back)}`
}
