import axios, { type AxiosInstance } from "axios"
import Constants from "expo-constants"
import { Linking } from "react-native"

import { language } from "./lang"
import { session } from "./session"

export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ??
  (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ??
  "http://localhost:9300"

export const WEB_URL =
  process.env.EXPO_PUBLIC_WEB_URL ??
  (Constants.expoConfig?.extra as { webUrl?: string } | undefined)?.webUrl ??
  "http://localhost:5300"

export function openWeb(path: string): void {
  Linking.openURL(`${WEB_URL}${path}`).catch(() => null)
}

export function client(): AxiosInstance {
  const c = axios.create({ baseURL: API_URL, timeout: 20000 })
  c.interceptors.request.use(async (config) => {
    const token = await session.token()
    if (token) config.headers.Authorization = `Bearer ${token}`
    config.headers["X-Klygenix-App"] = "mobile"
    config.headers["Accept-Language"] = language.get()
    return config
  })
  c.interceptors.response.use(
    (response) => response,
    async (error) => {
      if (error?.response?.status === 401) await session.clear()
      return Promise.reject(error)
    },
  )
  return c
}

export const api = client()

export function detail(error: unknown, fallback: string): string {
  const body = (error as { response?: { data?: { detail?: unknown } } })?.response?.data
  const d = body?.detail
  if (typeof d === "string") return d
  if (Array.isArray(d) && d[0] && typeof d[0].msg === "string") return d[0].msg
  return fallback
}

export const WS_URL = API_URL.replace(/^http/, "ws")

export function statusOf(error: unknown): number | undefined {
  return (error as { response?: { status?: number } })?.response?.status
}

export function errorCode(error: unknown): string | undefined {
  const response = (error as { response?: { data?: { code?: unknown }; headers?: Record<string, unknown> } })?.response
  const code = response?.data?.code ?? response?.headers?.["x-error-code"]
  return typeof code === "string" && code ? code : undefined
}
