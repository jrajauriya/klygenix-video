import { useCallback, useEffect, useRef } from "react"
import { api } from "@klygenixvideo/auth"

export function useProgressReporter(videoId: string | undefined, src: string, intervalMs = 15_000) {
  const started = useRef(false)
  const completed = useRef(false)
  const watched = useRef(0)
  const lastTick = useRef<number | null>(null)
  const position = useRef(0)
  const playing = useRef(false)

  const send = useCallback((extra: { started?: boolean; completed?: boolean } = {}) => {
    if (!videoId) return
    const watched_ms = Math.min(600_000, Math.round(watched.current))
    watched.current = 0
    if (!extra.started && !extra.completed && watched_ms === 0) return
    api.post(`/api/video/videos/${videoId}/progress`, {
      position_ms: Math.max(0, Math.round(position.current)),
      watched_ms,
      started: Boolean(extra.started),
      completed: Boolean(extra.completed),
      ...(extra.started ? { src } : {}),
    }).catch(() => undefined)
  }, [videoId, src])

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (playing.current) send()
    }, intervalMs)
    return () => {
      window.clearInterval(timer)
      send()
    }
  }, [send, intervalMs])

  const onPlay = useCallback(() => {
    playing.current = true
    lastTick.current = performance.now()
    if (!started.current) {
      started.current = true
      send({ started: true })
    }
  }, [send])

  const onPause = useCallback(() => {
    if (playing.current && lastTick.current !== null) watched.current += performance.now() - lastTick.current
    playing.current = false
    lastTick.current = null
  }, [])

  const onTime = useCallback((ms: number) => {
    position.current = ms
    if (playing.current && lastTick.current !== null) {
      const now = performance.now()
      const delta = now - lastTick.current
      if (delta < 2000) watched.current += delta
      lastTick.current = now
    }
  }, [])

  const onEnded = useCallback(() => {
    onPause()
    if (completed.current) return
    completed.current = true
    send({ completed: true })
  }, [onPause, send])

  return { onPlay, onPause, onTime, onEnded }
}
