import { useEffect, useRef, type ReactNode } from "react"
import type Hls from "hls.js"
import { cn } from "@klygenixvideo/ui"

export interface Seek {
  ms: number
  n: number
}

interface Props {
  src: string | null | undefined
  poster?: string | null
  startMs?: number
  endMs?: number
  seek?: Seek | null
  autoPlay?: boolean
  muted?: boolean
  controls?: boolean
  className?: string
  aspect?: string
  onTime?: (ms: number) => void
  onDuration?: (ms: number) => void
  children?: ReactNode
}

const isHls = (src: string) => /\.m3u8(\?|$)/i.test(src)

export function VideoPreview({
  src,
  poster,
  startMs,
  endMs,
  seek,
  autoPlay = false,
  muted = false,
  controls = true,
  className,
  aspect = "16 / 9",
  onTime,
  onDuration,
  children,
}: Props) {
  const ref = useRef<HTMLVideoElement>(null)
  const range = useRef<{ start?: number; end?: number }>({})
  const handlers = useRef({ onTime, onDuration })
  handlers.current = { onTime, onDuration }
  range.current = { start: startMs, end: endMs }

  useEffect(() => {
    const el = ref.current
    if (!el || !src) return
    let hls: Hls | null = null
    let live = true
    const from = range.current.start !== undefined ? range.current.start / 1000 : -1
    if (isHls(src)) {
      import("hls.js").then(({ default: HlsJs }) => {
        if (!live) return
        if (HlsJs.isSupported()) {
          hls = new HlsJs({ startPosition: from })
          hls.loadSource(src)
          hls.attachMedia(el)
        } else {
          el.src = src
        }
      })
    } else {
      el.src = src
    }
    return () => {
      live = false
      hls?.destroy()
      el.removeAttribute("src")
      el.load()
    }
  }, [src])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const bounded = () => {
      const { start, end } = range.current
      return start !== undefined && end !== undefined && end > start ? { start: start / 1000, end: end / 1000 } : null
    }
    const loaded = () => {
      handlers.current.onDuration?.(Math.round(el.duration * 1000))
      const r = bounded()
      if (r && (el.currentTime < r.start || el.currentTime > r.end)) el.currentTime = r.start
    }
    const tick = () => {
      handlers.current.onTime?.(Math.round(el.currentTime * 1000))
      const r = bounded()
      if (!r) return
      if (el.currentTime >= r.end || el.currentTime < r.start - 0.3) el.currentTime = r.start
    }
    el.addEventListener("loadedmetadata", loaded)
    el.addEventListener("timeupdate", tick)
    return () => {
      el.removeEventListener("loadedmetadata", loaded)
      el.removeEventListener("timeupdate", tick)
    }
  }, [src])

  useEffect(() => {
    const el = ref.current
    if (!el || startMs === undefined || el.readyState === 0) return
    el.currentTime = startMs / 1000
  }, [startMs])

  useEffect(() => {
    const el = ref.current
    if (!el || !seek || el.readyState === 0) return
    el.currentTime = seek.ms / 1000
    el.play().catch(() => undefined)
  }, [seek])

  return (
    <div className={cn("relative overflow-hidden rounded-lg bg-black", className)} style={{ aspectRatio: aspect }}>
      {src ? (
        <video
          ref={ref}
          poster={poster ?? undefined}
          controls={controls}
          autoPlay={autoPlay}
          muted={muted}
          playsInline
          loop={startMs === undefined}
          className="absolute inset-0 h-full w-full object-contain"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-300">
          {poster ? <img src={poster} alt="" className="h-full w-full object-contain opacity-70" /> : "No preview yet"}
        </div>
      )}
      {children}
    </div>
  )
}
