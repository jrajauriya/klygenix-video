import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { DanmakuItem, DanmakuMode, HttpClient } from "./types"

const BUCKET = 60_000

export interface UseDanmakuOptions {
  api: HttpClient
  baseUrl?: string
  enabled?: boolean
  realtime?: boolean
  all?: boolean
}

export interface UseDanmaku {
  items: DanmakuItem[]
  watchers: number
  connected: boolean
  post: (text: string, mode?: DanmakuMode, color?: string) => Promise<DanmakuItem>
  remove: (id: DanmakuItem["id"]) => void
}

function wsUrl(base: string, videoId: string): string {
  const root = base || (typeof window !== "undefined" ? window.location.origin : "")
  const url = new URL(`/api/video/ws/videos/${encodeURIComponent(videoId)}`, root)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  return url.toString()
}

export function useDanmaku(videoId: string | null | undefined, currentMs: number, options: UseDanmakuOptions): UseDanmaku {
  const { api, enabled = true, realtime = true, all = false } = options
  const base = options.baseUrl ?? api.defaults?.baseURL ?? ""
  const [byId, setById] = useState<Map<string, DanmakuItem>>(() => new Map())
  const [watchers, setWatchers] = useState(0)
  const [connected, setConnected] = useState(false)
  const buckets = useRef(new Set<number>())
  const now = useRef(currentMs)
  now.current = currentMs

  useEffect(() => {
    buckets.current = new Set()
    setById(new Map())
    setWatchers(0)
  }, [videoId])

  const merge = useCallback((list: DanmakuItem[]) => {
    if (!list.length) return
    setById((prev) => {
      const next = new Map(prev)
      for (const item of list) {
        const key = String(item.id)
        const had = next.get(key)
        next.set(key, had?.mine ? { ...item, mine: true } : item)
      }
      return next
    })
  }, [])

  const load = useCallback((bucket: number) => {
    if (!videoId || bucket < 0 || buckets.current.has(bucket)) return
    buckets.current.add(bucket)
    const from = bucket * BUCKET
    api
      .get<DanmakuItem[]>(`/api/video/videos/${encodeURIComponent(videoId)}/danmaku`, { params: { from_ms: from, to_ms: from + BUCKET } })
      .then(({ data }) => merge(Array.isArray(data) ? data : []))
      .catch(() => {
        buckets.current.delete(bucket)
      })
  }, [api, videoId, merge])

  useEffect(() => {
    if (!enabled || !videoId) return
    if (all) {
      if (buckets.current.has(-1)) return
      buckets.current.add(-1)
      api
        .get<DanmakuItem[]>(`/api/video/videos/${encodeURIComponent(videoId)}/danmaku`, { params: { from_ms: 0, to_ms: 6 * 3600_000 } })
        .then(({ data }) => merge(Array.isArray(data) ? data : []))
        .catch(() => buckets.current.delete(-1))
      return
    }
    const b = Math.floor(Math.max(0, currentMs) / BUCKET)
    load(b)
    if (currentMs % BUCKET > BUCKET / 2) load(b + 1)
  }, [enabled, videoId, currentMs, load, all, api, merge])

  useEffect(() => {
    if (!enabled || !realtime || !videoId || typeof WebSocket === "undefined") return
    let socket: WebSocket | null = null
    let ping: number | undefined
    let retry: number | undefined
    let attempt = 0
    let stopped = false

    const connect = () => {
      if (stopped) return
      try {
        socket = new WebSocket(wsUrl(base, videoId))
      } catch {
        schedule()
        return
      }
      socket.onopen = () => {
        attempt = 0
        setConnected(true)
        ping = window.setInterval(() => {
          if (socket?.readyState === WebSocket.OPEN) socket.send("ping")
        }, 25_000)
      }
      socket.onmessage = (ev) => {
        let msg: { type?: string; watchers?: number; item?: DanmakuItem; id?: number | string }
        try {
          msg = JSON.parse(String(ev.data))
        } catch {
          return
        }
        if ((msg.type === "hello" || msg.type === "pong") && typeof msg.watchers === "number") setWatchers(msg.watchers)
        else if (msg.type === "danmaku" && msg.item) merge([msg.item])
        else if (msg.type === "danmaku_removed" && msg.id !== undefined) {
          const gone = String(msg.id)
          setById((prev) => {
            if (!prev.has(gone)) return prev
            const next = new Map(prev)
            next.delete(gone)
            return next
          })
        }
      }
      socket.onclose = (ev) => {
        window.clearInterval(ping)
        setConnected(false)
        if (ev.code === 4404 || ev.code === 4403) return
        schedule()
      }
      socket.onerror = () => socket?.close()
    }

    const schedule = () => {
      if (stopped) return
      const delay = Math.min(30_000, 1000 * 2 ** attempt) + Math.round(Math.random() * 500)
      attempt += 1
      retry = window.setTimeout(connect, delay)
    }

    connect()
    return () => {
      stopped = true
      window.clearInterval(ping)
      window.clearTimeout(retry)
      if (socket) {
        socket.onclose = null
        socket.onerror = null
        socket.onmessage = null
        socket.close()
      }
      setConnected(false)
    }
  }, [enabled, realtime, videoId, base, merge])

  const post = useCallback(async (text: string, mode: DanmakuMode = "scroll", color = "#FFFFFF") => {
    if (!videoId) throw new Error("No video")
    const t_ms = Math.max(0, Math.round(now.current))
    const { data } = await api.post<DanmakuItem>(`/api/video/videos/${encodeURIComponent(videoId)}/danmaku`, { t_ms, text, mode, color })
    const item = { ...data, mine: true }
    merge([item])
    return item
  }, [api, videoId, merge])

  const remove = useCallback((id: DanmakuItem["id"]) => {
    setById((prev) => {
      const next = new Map(prev)
      next.delete(String(id))
      return next
    })
  }, [])

  const items = useMemo(() => [...byId.values()].sort((a, b) => a.t_ms - b.t_ms), [byId])

  return { items, watchers, connected, post, remove }
}
