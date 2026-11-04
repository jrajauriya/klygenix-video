import { useSyncExternalStore } from "react"
import { Directory, File, Paths } from "expo-file-system"

import { api, statusOf } from "./api"
import type { DownloadTicket, LicenseState, VideoCard } from "./types"

export interface Download {
  id: string
  title: string
  channel: string
  kind: "long" | "reel"
  duration_ms: number | null
  quality: string
  file: string
  thumbnail: string | null
  license: string
  license_expires_at: number
  saved_at: number
}

export type StartResult = "ok" | "premium" | "not_allowed" | "failed" | "cancelled"

interface State {
  items: Download[]
  progress: Record<string, number>
  loaded: boolean
}

let state: State = { items: [], progress: {}, loaded: false }
const listeners = new Set<() => void>()
const running = new Map<string, AbortController>()

function dir(): Directory {
  const d = new Directory(Paths.document, "downloads")
  if (!d.exists) d.create({ intermediates: true, idempotent: true })
  return d
}

function indexFile(): File {
  return new File(dir(), "index.json")
}

function set(next: Partial<State>) {
  state = { ...state, ...next }
  listeners.forEach((l) => l())
}

function persist(items: Download[]) {
  try {
    indexFile().write(JSON.stringify(items))
  } catch {
    return
  }
}

function wipe(uri: string | null) {
  if (!uri) return
  try {
    const f = new File(uri)
    if (f.exists) f.delete()
  } catch {
    return
  }
}

function drop(item: Download) {
  wipe(item.file)
  wipe(item.thumbnail)
}

function now(): number {
  return Math.floor(Date.now() / 1000)
}

export async function loadDownloads(): Promise<Download[]> {
  if (state.loaded) return state.items
  let items: Download[] = []
  try {
    const f = indexFile()
    if (f.exists) items = JSON.parse(await f.text()) as Download[]
  } catch {
    items = []
  }
  items = items.filter((d) => {
    try {
      return new File(d.file).exists
    } catch {
      return false
    }
  })
  set({ items, loaded: true })
  return items
}

export function removeDownloads(ids: string[]) {
  if (!ids.length) return
  const gone = state.items.filter((d) => ids.includes(d.id))
  gone.forEach(drop)
  const items = state.items.filter((d) => !ids.includes(d.id))
  persist(items)
  set({ items })
}

export function isExpired(d: Download): boolean {
  return d.license_expires_at <= now()
}

export async function sweepDownloads(signedIn: boolean): Promise<string[]> {
  const items = await loadDownloads()
  const expired = items.filter(isExpired).map((d) => d.id)
  removeDownloads(expired)
  const left = state.items
  if (!signedIn || left.length === 0) return expired
  try {
    const { data } = await api.post<{ licenses: Record<string, LicenseState>; keep: string[] }>("/api/video/me/downloads/check", {
      licenses: left.map((d) => d.license),
    })
    const bad = left.filter((d) => (data.licenses[d.license] ?? "invalid") !== "ok").map((d) => d.id)
    removeDownloads(bad)
    return [...expired, ...bad]
  } catch {
    return expired
  }
}

export function cancelDownload(id: string) {
  running.get(id)?.abort()
}

export async function startDownload(video: VideoCard): Promise<StartResult> {
  if (running.has(video.id)) return "ok"
  let ticket: DownloadTicket
  try {
    ticket = (await api.post<DownloadTicket>(`/api/video/videos/${video.id}/download`)).data
  } catch (err) {
    const code = statusOf(err)
    return code === 402 ? "premium" : code === 403 ? "not_allowed" : "failed"
  }
  await loadDownloads()
  const control = new AbortController()
  running.set(video.id, control)
  set({ progress: { ...state.progress, [video.id]: 0 } })
  const target = new File(dir(), `${video.id}.mp4`)
  try {
    await File.downloadFileAsync(ticket.url, target, {
      idempotent: true,
      signal: control.signal,
      onProgress: ({ bytesWritten, totalBytes }) => {
        if (totalBytes > 0) set({ progress: { ...state.progress, [video.id]: bytesWritten / totalBytes } })
      },
    })
    let thumb: string | null = null
    if (video.thumbnail) {
      try {
        thumb = (await File.downloadFileAsync(video.thumbnail, new File(dir(), `${video.id}.jpg`), { idempotent: true })).uri
      } catch {
        thumb = null
      }
    }
    const item: Download = {
      id: video.id,
      title: ticket.title || video.title,
      channel: video.channel?.name ?? "",
      kind: video.kind,
      duration_ms: ticket.duration_ms ?? video.duration_ms,
      quality: ticket.quality,
      file: target.uri,
      thumbnail: thumb,
      license: ticket.license,
      license_expires_at: ticket.license_expires_at,
      saved_at: now(),
    }
    const items = [item, ...state.items.filter((d) => d.id !== video.id)]
    persist(items)
    set({ items })
    return "ok"
  } catch {
    wipe(target.uri)
    return control.signal.aborted ? "cancelled" : "failed"
  } finally {
    running.delete(video.id)
    const progress = { ...state.progress }
    delete progress[video.id]
    set({ progress })
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useDownloads(): State {
  return useSyncExternalStore(subscribe, () => state)
}
