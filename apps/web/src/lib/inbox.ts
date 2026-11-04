import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"
import { api } from "@klygenixvideo/auth"
import { STUDIO_URL, getJson, useSignedIn } from "./api"

export type NoteKind = "new_video" | "reply" | "published" | "render_ready" | "live" | "membership" | "deal"

export interface Note {
  id: number
  kind: NoteKind | string
  title: string
  body: string
  url: string | null
  image: string | null
  read: boolean
  created_at: string
}

export interface Inbox {
  unread: number
  items: Note[]
}

const STUDIO_KINDS = new Set(["render_ready", "deal"])

export function useInboxCount() {
  const signedIn = useSignedIn()
  return useQuery({
    queryKey: ["inbox-count"],
    enabled: signedIn,
    queryFn: () => getJson<{ unread: number }>("/api/video/me/inbox/count"),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    staleTime: 20_000,
  })
}

export function useSubscriptionsCount() {
  const signedIn = useSignedIn()
  return useQuery({
    queryKey: ["subs-count"],
    enabled: signedIn,
    queryFn: () => getJson<{ new_count: number }>("/api/video/feed/subscriptions", { limit: 1, mark_seen: false }),
    refetchOnWindowFocus: true,
    staleTime: 300_000,
  })
}

export function useOpenNote() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  return async (note: Note, after?: () => void) => {
    if (!note.read) {
      qc.setQueryData<{ unread: number }>(["inbox-count"], (c) => (c ? { unread: Math.max(0, c.unread - 1) } : c))
      await api.post("/api/video/me/inbox/read", { ids: [note.id] }).catch(() => undefined)
      void qc.invalidateQueries({ queryKey: ["inbox"] })
      void qc.invalidateQueries({ queryKey: ["inbox-count"] })
    }
    after?.()
    const url = note.url ?? ""
    if (/^https?:\/\//i.test(url)) window.location.assign(url)
    else if (url.startsWith("/") && !url.startsWith("//")) {
      if (STUDIO_KINDS.has(note.kind)) window.location.assign(`${STUDIO_URL}${url}`)
      else navigate(url)
    }
  }
}

export async function markAllRead(qc: ReturnType<typeof useQueryClient>) {
  await api.post("/api/video/me/inbox/read", {})
  qc.setQueryData(["inbox-count"], { unread: 0 })
  await qc.invalidateQueries({ queryKey: ["inbox"] })
}
