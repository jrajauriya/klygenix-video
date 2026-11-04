import { useQuery } from "@tanstack/react-query"
import { api, useAuthStore } from "@klygenixvideo/auth"
import type { Me } from "./types"

export const PUBLIC_DOMAIN = import.meta.env.VITE_PUBLIC_DOMAIN || "play.klygenix.com"
export const TV_VERSION = __TV_VERSION__

export function configureApi(): void {
  api.defaults.baseURL = import.meta.env.VITE_API_URL || ""
  api.defaults.headers["X-Klygenix-App"] = "tv"
}

export function apiUrl(path: string): string {
  return `${String(api.defaults.baseURL ?? "").replace(/\/$/, "")}${path}`
}

export function sameOrigin(url: string | null | undefined): string | undefined {
  if (!url) return undefined
  if (import.meta.env.VITE_API_URL) return url
  return url.replace(/^https?:\/\/(localhost|127\.0\.0\.1):9300(?=\/)/, "")
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

export async function getJson<T>(path: string, params?: Record<string, unknown>): Promise<T> {
  const { data } = await api.get<T>(path, { params })
  return data
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
    queryFn: () => getJson<Me>("/api/video/me"),
  })
}

export { api }
