import { useEffect, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { api } from "@klygenixvideo/auth"
import { getJson } from "./api"
import type { LiveMessage, LiveStreamCard } from "./types"

export function useLiveNow() {
  return useQuery({
    queryKey: ["live", "now"],
    queryFn: () => getJson<LiveStreamCard[]>("/api/video/live", { limit: 20 }),
    refetchInterval: 60_000,
  })
}

export function useChannelLive(handle: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ["live", "channel", handle],
    enabled: Boolean(handle) && enabled,
    queryFn: () => getJson<LiveStreamCard[]>(`/api/video/channels/${handle}/live`),
    refetchInterval: 60_000,
  })
}

export function useNow(intervalMs = 1000, on = true): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!on) return
    setNow(Date.now())
    const t = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(t)
  }, [intervalMs, on])
  return now
}

export function countdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const d = Math.floor(total / 86400)
  const h = Math.floor((total % 86400) / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, "0")
  if (d) return `${d}d ${pad(h)}:${pad(m)}:${pad(s)}`
  if (h) return `${h}:${pad(m)}:${pad(s)}`
  return `${pad(m)}:${pad(s)}`
}

export function pinnedLeft(m: LiveMessage, now: number): number {
  return m.pinned_until ? Date.parse(m.pinned_until) - now : 0
}

function wsUrl(publicId: string): string {
  const root = String(api.defaults.baseURL ?? "") || window.location.origin
  const url = new URL(`/api/video/ws/live/${encodeURIComponent(publicId)}`, root)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  return url.toString()
}

const KEEP = 200

function merge(base: LiveMessage[], extra: LiveMessage[], removed: Set<number>): LiveMessage[] {
  const byId = new Map<number, LiveMessage>()
  for (const m of [...base, ...extra]) if (!removed.has(m.id)) byId.set(m.id, { ...byId.get(m.id), ...m })
  return [...byId.values()].sort((a, b) => a.id - b.id).slice(-KEEP)
}

export interface LiveRoom {
  messages: LiveMessage[]
  pinned: LiveMessage[]
  viewers: number | null
  slowMode: number | null
  timedOutUntil: number
  connected: boolean
  add: (m: LiveMessage) => void
}

export function useLiveRoom(publicId: string, opts: {
  connect: boolean
  canRead: boolean
  myUserId: number | null | undefined
  seedPinned: LiveMessage[] | undefined
  onStatus: (status: string) => void
}): LiveRoom {
  const [messages, setMessages] = useState<LiveMessage[]>([])
  const [pinned, setPinned] = useState<LiveMessage[]>([])
  const [viewers, setViewers] = useState<number | null>(null)
  const [slowMode, setSlowMode] = useState<number | null>(null)
  const [timedOutUntil, setTimedOutUntil] = useState(0)
  const [connected, setConnected] = useState(false)
  const removed = useRef(new Set<number>())
  const me = useRef(opts.myUserId)
  me.current = opts.myUserId
  const onStatus = useRef(opts.onStatus)
  onStatus.current = opts.onStatus

  useEffect(() => {
    removed.current = new Set()
    setMessages([])
    setPinned([])
    setViewers(null)
    setSlowMode(null)
    setTimedOutUntil(0)
  }, [publicId])

  const history = useQuery({
    queryKey: ["live", publicId, "chat"],
    enabled: opts.canRead,
    staleTime: Infinity,
    queryFn: () => getJson<LiveMessage[]>(`/api/video/live/${publicId}/chat`, { limit: 100 }),
  })

  useEffect(() => {
    if (history.data) setMessages((prev) => merge(history.data, prev, removed.current))
  }, [history.data])

  useEffect(() => {
    if (opts.seedPinned) setPinned((prev) => merge(opts.seedPinned ?? [], prev, removed.current))
  }, [opts.seedPinned])

  const add = (m: LiveMessage) => {
    setMessages((prev) => merge(prev, [m], removed.current))
    if (m.kind !== "chat" && m.pinned_until && Date.parse(m.pinned_until) > Date.now()) {
      setPinned((prev) => merge(prev, [m], removed.current))
    }
  }
  const addRef = useRef(add)
  addRef.current = add

  useEffect(() => {
    if (!opts.connect || !publicId || typeof WebSocket === "undefined") return
    let socket: WebSocket | null = null
    let ping: number | undefined
    let retry: number | undefined
    let attempt = 0
    let stopped = false
    const connect = () => {
      if (stopped) return
      socket = new WebSocket(wsUrl(publicId))
      socket.onopen = () => {
        attempt = 0
        setConnected(true)
        ping = window.setInterval(() => { if (socket?.readyState === WebSocket.OPEN) socket.send("ping") }, 25_000)
      }
      socket.onmessage = (ev) => {
        let msg: Record<string, unknown>
        try {
          msg = JSON.parse(String(ev.data))
        } catch {
          return
        }
        const type = msg.type
        if ((type === "hello" || type === "viewers") && typeof msg.viewers === "number") setViewers(msg.viewers)
        if (type === "hello" && typeof msg.status === "string") onStatus.current(msg.status)
        else if ((type === "chat" || type === "superchat" || type === "gift") && msg.item) addRef.current(msg.item as LiveMessage)
        else if (type === "chat_removed" && typeof msg.id === "number") {
          const id = msg.id
          removed.current.add(id)
          setMessages((prev) => prev.filter((m) => m.id !== id))
          setPinned((prev) => prev.filter((m) => m.id !== id))
        } else if (type === "slow_mode" && typeof msg.seconds === "number") setSlowMode(msg.seconds)
        else if (type === "timeout" && msg.user_id === me.current && typeof msg.seconds === "number") {
          setTimedOutUntil(Date.now() + msg.seconds * 1000)
        } else if (type === "ended") onStatus.current("ended")
      }
      socket.onclose = (ev) => {
        window.clearInterval(ping)
        setConnected(false)
        if (stopped || ev.code === 4404) return
        attempt += 1
        retry = window.setTimeout(connect, Math.min(15_000, 1000 * 2 ** Math.min(attempt, 4)))
      }
    }
    connect()
    return () => {
      stopped = true
      window.clearInterval(ping)
      window.clearTimeout(retry)
      socket?.close()
      setConnected(false)
    }
  }, [publicId, opts.connect])

  return { messages, pinned, viewers, slowMode, timedOutUntil, connected, add }
}
