import * as FileSystem from "expo-file-system/legacy"

import { api } from "./api"
import type { StudioVideo, UploadTicket } from "./types"

export interface Draft {
  uri: string
  filename: string
  size?: number
  title: string
  description: string
  rights: boolean
  ai: boolean
}

export class TusNotSupported extends Error {}

export async function createAndUpload(draft: Draft): Promise<StudioVideo> {
  const { data } = await api.post<{ video: StudioVideo; upload: UploadTicket }>("/api/video/studio/videos", {
    title: draft.title.trim(),
    description: draft.description.trim(),
    visibility: "public",
    rights_declared: draft.rights,
    ai_generated: draft.ai,
    tags: [],
    filename: draft.filename,
    size_bytes: draft.size ?? 0,
  })
  if (data.upload.protocol !== "put") throw new TusNotSupported("tus")
  const result = await FileSystem.uploadAsync(data.upload.url, draft.uri, {
    httpMethod: "PUT",
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: data.upload.headers ?? {},
  })
  if (result.status >= 300) throw new Error(`The upload was refused (${result.status}).`)
  const done = await api.post<StudioVideo>(`/api/video/studio/videos/${data.video.id}/uploaded`)
  return done.data
}

export async function fileSize(uri: string): Promise<number | undefined> {
  try {
    const info = await FileSystem.getInfoAsync(uri)
    return info.exists && "size" in info ? info.size : undefined
  } catch {
    return undefined
  }
}

export const SETTLED = new Set(["published", "in_review", "blocked", "failed"])
