import { useEffect, useRef, type RefObject } from "react"
import type { EmbedController } from "./types"
import { cx } from "./format"

interface YTPlayer {
  getCurrentTime: () => number
  getPlayerState: () => number
  seekTo: (seconds: number, allowSeekAhead: boolean) => void
  playVideo: () => void
  pauseVideo: () => void
  destroy: () => void
}

interface YTNamespace {
  Player: new (el: HTMLElement, options: Record<string, unknown>) => YTPlayer
}

declare global {
  interface Window {
    YT?: YTNamespace
    onYouTubeIframeAPIReady?: () => void
  }
}

let loading: Promise<YTNamespace> | null = null

function loadApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT)
  if (loading) return loading
  loading = new Promise((resolve, reject) => {
    const prior = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      prior?.()
      if (window.YT) resolve(window.YT)
    }
    const script = document.createElement("script")
    script.src = "https://www.youtube.com/iframe_api"
    script.async = true
    script.onerror = () => {
      loading = null
      reject(new Error("YouTube player could not load"))
    }
    document.head.appendChild(script)
  })
  return loading
}

export interface YouTubeEmbedProps {
  videoId: string
  startMs?: number
  autoPlay?: boolean
  onTime?: (ms: number) => void
  onPlayingChange?: (playing: boolean) => void
  onEnded?: () => void
  controllerRef?: RefObject<EmbedController | null>
  title?: string
  className?: string
}

export function YouTubeEmbed({ videoId, startMs = 0, autoPlay = false, onTime, onPlayingChange, onEnded, controllerRef, title = "YouTube video player", className }: YouTubeEmbedProps) {
  const host = useRef<HTMLDivElement>(null)
  const callbacks = useRef({ onTime, onPlayingChange, onEnded })
  callbacks.current = { onTime, onPlayingChange, onEnded }

  useEffect(() => {
    let player: YTPlayer | null = null
    let timer: number | undefined
    let cancelled = false
    let last = -1
    const mount = document.createElement("div")
    host.current?.appendChild(mount)
    loadApi()
      .then((YT) => {
        if (cancelled) return
        player = new YT.Player(mount, {
          videoId,
          host: "https://www.youtube-nocookie.com",
          width: "100%",
          height: "100%",
          playerVars: { start: Math.floor(startMs / 1000), autoplay: autoPlay ? 1 : 0, rel: 0, playsinline: 1, modestbranding: 1 },
          events: {
            onReady: (e: { target: YTPlayer }) => {
              const iframe = host.current?.querySelector("iframe")
              iframe?.setAttribute("title", title)
              if (controllerRef) {
                controllerRef.current = {
                  seek: (ms) => e.target.seekTo(ms / 1000, true),
                  play: () => e.target.playVideo(),
                  pause: () => e.target.pauseVideo(),
                  currentMs: () => Math.round((e.target.getCurrentTime() || 0) * 1000),
                }
              }
            },
            onStateChange: (e: { data: number }) => {
              callbacks.current.onPlayingChange?.(e.data === 1)
              if (e.data === 0) callbacks.current.onEnded?.()
            },
          },
        })
        timer = window.setInterval(() => {
          if (!player || typeof player.getCurrentTime !== "function") return
          const ms = Math.round((player.getCurrentTime() || 0) * 1000)
          if (ms !== last) {
            last = ms
            callbacks.current.onTime?.(ms)
          }
        }, 250)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      if (controllerRef) controllerRef.current = null
      try {
        player?.destroy()
      } catch {
        return
      }
      mount.remove()
    }
  }, [videoId])

  return (
    <div className={cx("relative overflow-hidden bg-black", className)}>
      <div ref={host} className="absolute inset-0 [&>div]:h-full [&>div]:w-full [&_iframe]:h-full [&_iframe]:w-full" />
    </div>
  )
}
