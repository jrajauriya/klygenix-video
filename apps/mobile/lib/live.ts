import { useEffect, useRef, useState } from "react"

import { WS_URL, api, openWeb } from "./api"
import type { LiveCard, LiveDetail, LiveEvent, LiveMessage } from "./types"

export async function liveNow(): Promise<LiveCard[]> {
  return (await api.get<LiveCard[]>("/api/video/live", { params: { limit: 20 } })).data
}

export async function liveDetail(publicId: string): Promise<LiveDetail> {
  return (await api.get<LiveDetail>(`/api/video/live/${publicId}`)).data
}

export async function liveChat(publicId: string): Promise<LiveMessage[]> {
  return (await api.get<LiveMessage[]>(`/api/video/live/${publicId}/chat`, { params: { limit: 100 } })).data
}

export async function sendLiveChat(publicId: string, body: string): Promise<LiveMessage> {
  return (await api.post<LiveMessage>(`/api/video/live/${publicId}/chat`, { body })).data
}

export function openSuperChat(publicId: string): void {
  openWeb(`/live/${publicId}`)
}

export function stillPinned(m: LiveMessage, now = Date.now()): boolean {
  return Boolean(m.pinned_until) && new Date(m.pinned_until as string).getTime() > now
}

export function useLiveRoom(publicId: string | undefined, enabled: boolean, onEvent: (event: LiveEvent) => void) {
  const [connected, setConnected] = useState(false)
  const handler = useRef(onEvent)

  useEffect(() => {
    handler.current = onEvent
  })

  useEffect(() => {
    if (!publicId || !enabled) return
    let socket: WebSocket | null = null
    let ping: ReturnType<typeof setInterval> | undefined
    let retry: ReturnType<typeof setTimeout> | undefined
    let attempt = 0
    let closed = false

    const connect = () => {
      socket = new WebSocket(`${WS_URL}/api/video/ws/live/${publicId}`)
      socket.onopen = () => {
        attempt = 0
        setConnected(true)
        ping = setInterval(() => socket?.readyState === WebSocket.OPEN && socket.send("ping"), 25_000)
      }
      socket.onmessage = (e) => {
        try {
          handler.current(JSON.parse(String(e.data)) as LiveEvent)
        } catch {
          return
        }
      }
      socket.onclose = (e) => {
        setConnected(false)
        if (ping) clearInterval(ping)
        if (closed || e.code === 4404) return
        attempt += 1
        retry = setTimeout(connect, Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5)))
      }
      socket.onerror = () => socket?.close()
    }

    connect()
    return () => {
      closed = true
      if (ping) clearInterval(ping)
      if (retry) clearTimeout(retry)
      socket?.close()
    }
  }, [publicId, enabled])

  return connected
}
