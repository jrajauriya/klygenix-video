import { api } from "./api"
import type { NotifyKind, NotifyPrefs, PushRecord } from "./types"

export const NOTIFY_KINDS: NotifyKind[] = ["live", "published", "render_ready", "membership"]

export async function notifyPrefs(): Promise<NotifyPrefs> {
  return (await api.get<NotifyPrefs>("/api/video/me/notifications")).data
}

export async function saveNotifyPrefs(patch: Partial<NotifyPrefs>): Promise<NotifyPrefs> {
  return (await api.put<NotifyPrefs>("/api/video/me/notifications", patch)).data
}

export async function notifyHistory(): Promise<PushRecord[]> {
  return (await api.get<PushRecord[]>("/api/video/me/notifications/history")).data
}

export function appPath(url: unknown): string | null {
  return typeof url === "string" && /^\/(live|watch|channel)\/[\w@.-]+$/.test(url) ? url : null
}
