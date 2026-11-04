import { router } from "expo-router"
import { Linking } from "react-native"

import { api, openWeb } from "./api"
import { appPath } from "./notifications"
import type { DigestFrequency, Inbox } from "./types"

export const DIGESTS: DigestFrequency[] = ["off", "daily", "weekly"]

export async function inboxCount(): Promise<number> {
  return (await api.get<{ unread: number }>("/api/video/me/inbox/count")).data.unread
}

export async function inbox(): Promise<Inbox> {
  return (await api.get<Inbox>("/api/video/me/inbox", { params: { limit: 50 } })).data
}

export async function markRead(ids?: number[]): Promise<number> {
  return (await api.post<{ unread: number }>("/api/video/me/inbox/read", ids ? { ids } : {})).data.unread
}

export async function digest(): Promise<DigestFrequency> {
  return (await api.get<{ frequency: DigestFrequency }>("/api/video/me/digest")).data.frequency
}

export async function saveDigest(frequency: DigestFrequency): Promise<DigestFrequency> {
  return (await api.put<{ frequency: DigestFrequency }>("/api/video/me/digest", { frequency })).data.frequency
}

export function inApp(url: string | null | undefined): boolean {
  return Boolean(appPath(url))
}

export function follow(url: string | null | undefined): void {
  const path = appPath(url)
  if (path) {
    router.push(path as never)
    return
  }
  if (!url) return
  if (/^https:\/\//i.test(url)) Linking.openURL(url).catch(() => null)
  else openWeb(url.startsWith("/") ? url : `/${url}`)
}
