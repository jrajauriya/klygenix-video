import axios from "axios"
import Constants from "expo-constants"
import { Linking } from "react-native"

import { session } from "./session"

export const API_URL =
  (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ?? "http://localhost:9300"

export const WEB_URL =
  (Constants.expoConfig?.extra as { webUrl?: string } | undefined)?.webUrl ?? "http://localhost:5300"

export function openWeb(path: string): void {
  Linking.openURL(`${WEB_URL}${path}`).catch(() => null)
}

export const api = axios.create({ baseURL: API_URL, timeout: 20000 })

api.interceptors.request.use(async (config) => {
  const token = await session.token()
  if (token) config.headers.Authorization = `Bearer ${token}`
  config.headers["X-Klygenix-App"] = "mobile"
  return config
})

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error?.response?.status === 401) await session.clear()
    return Promise.reject(error)
  },
)

export function detail(error: unknown, fallback: string): string {
  const body = (error as { response?: { data?: { detail?: unknown } } })?.response?.data
  const d = body?.detail
  if (typeof d === "string") return d
  if (Array.isArray(d) && d[0] && typeof d[0].msg === "string") return d[0].msg
  return fallback
}

export function statusOf(error: unknown): number | undefined {
  return (error as { response?: { status?: number } })?.response?.status
}
