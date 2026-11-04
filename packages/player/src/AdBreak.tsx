import { useCallback, useEffect, useRef, useState } from "react"
import { HlsPlayer } from "./HlsPlayer"
import { cx, formatClock } from "./format"
import { ChevronIcon, MuteIcon, PauseIcon, PlayIcon, VolumeIcon } from "./icons"
import type { HttpClient } from "./types"

export type AdEvent = "start" | "q1" | "mid" | "q3" | "complete" | "skip" | "click"

export type AdOutcome = "complete" | "skip" | "error"

export interface AdCreative {
  token: string
  campaign: string
  brand: string
  label: string
  slot: string
  skip_after_seconds: number | null
  click_url: string
  duration_ms: number
  playback: { type: string; url: string } | null
}

export interface AdBreakProps {
  ad: AdCreative
  http: Pick<HttpClient, "post">
  onDone: (outcome: AdOutcome) => void
  muted?: boolean
  startTimeoutMs?: number
  className?: string
}

const QUARTILES: [number, AdEvent][] = [[0.25, "q1"], [0.5, "mid"], [0.75, "q3"]]

function safeUrl(raw: string): string | null {
  try {
    const u = new URL(raw)
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null
  } catch {
    return null
  }
}

export function AdBreak({ ad, http, onDone, muted: startMuted = false, startTimeoutMs = 8000, className }: AdBreakProps) {
  const video = useRef<HTMLVideoElement | null>(null)
  const sent = useRef(new Set<AdEvent>())
  const finished = useRef(false)
  const done = useRef(onDone)
  done.current = onDone
  const [started, setStarted] = useState(false)
  const [paused, setPaused] = useState(false)
  const [muted, setMuted] = useState(startMuted)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(ad.duration_ms > 0 ? ad.duration_ms : 0)
  const [said, setSaid] = useState("")
  const src = ad.playback?.type === "hls" ? ad.playback.url : null
  const link = safeUrl(ad.click_url)
  const skipAfter = typeof ad.skip_after_seconds === "number" && ad.skip_after_seconds >= 0 ? ad.skip_after_seconds : null
  const remaining = Math.max(0, duration - current)
  const skipIn = skipAfter === null ? null : Math.max(0, Math.ceil(skipAfter - current / 1000))
  const canSkip = skipIn === 0 && started

  const send = useCallback((event: AdEvent) => {
    if (sent.current.has(event)) return
    sent.current.add(event)
    http.post("/api/video/ads/events", { token: ad.token, event }).catch(() => undefined)
  }, [http, ad.token])

  const finish = useCallback((outcome: AdOutcome) => {
    if (finished.current) return
    finished.current = true
    video.current?.pause()
    done.current(outcome)
  }, [])

  useEffect(() => {
    if (!src) {
      finish("error")
      return
    }
    const timer = window.setTimeout(() => {
      if (!sent.current.has("start")) finish("error")
    }, startTimeoutMs)
    return () => window.clearTimeout(timer)
  }, [src, startTimeoutMs, finish])

  useEffect(() => {
    if (!started) return
    const cap = (duration > 0 ? duration : 60_000) + 15_000
    const timer = window.setTimeout(() => finish("error"), cap)
    return () => window.clearTimeout(timer)
  }, [started, duration, finish])

  const leftSec = Math.ceil(remaining / 1000)
  useEffect(() => {
    if (!started) return
    const left = leftSec
    if (canSkip && !sent.current.has("skip")) setSaid((s) => (s.startsWith("You can skip") ? s : "You can skip the ad now."))
    else if (left > 0 && left % 5 === 0) setSaid(`Ad ends in ${left} seconds.`)
  }, [started, leftSec, canSkip])

  function onTime(ms: number) {
    setCurrent(ms)
    const v = video.current
    const total = v && Number.isFinite(v.duration) && v.duration > 0 ? v.duration * 1000 : duration
    if (v && Number.isFinite(v.duration) && v.duration > 0 && Math.abs(v.duration * 1000 - duration) > 250) setDuration(v.duration * 1000)
    if (!total || !sent.current.has("start")) return
    for (const [at, event] of QUARTILES) if (ms >= total * at) send(event)
  }

  function onPlay() {
    setPaused(false)
    if (!started) {
      setStarted(true)
      setSaid(`Ad from ${ad.brand}.${skipAfter !== null ? ` You can skip it in ${skipAfter} seconds.` : ""}`)
    }
    send("start")
  }

  function togglePlay() {
    const v = video.current
    if (!v) return
    if (v.paused) v.play().catch(() => undefined)
    else v.pause()
  }

  function toggleMute() {
    const v = video.current
    if (!v) return
    v.muted = !v.muted
    if (!v.muted && v.volume === 0) v.volume = 0.5
  }

  function skip() {
    send("skip")
    finish("skip")
  }

  function visit() {
    send("click")
    video.current?.pause()
  }

  const fill = duration > 0 ? Math.min(100, (current / duration) * 100) : 0

  return (
    <section aria-label={`${ad.label || "Ad"} from ${ad.brand}`} className={cx("absolute inset-0 z-20 overflow-hidden bg-black text-white", className)}>
      {src && (
        <HlsPlayer
          src={src}
          autoPlay
          muted={startMuted}
          controls={false}
          hotkeys={false}
          videoRef={video}
          onTime={onTime}
          onPlay={onPlay}
          onPause={() => setPaused(true)}
          onEnded={() => {
            send("complete")
            finish("complete")
          }}
          onError={() => finish("error")}
          onMutedChange={setMuted}
          className="h-full w-full"
        />
      )}
      <p className="sr-only" aria-live="polite" aria-atomic="true">{said}</p>

      <div className="absolute left-2 top-2 flex max-w-[70%] items-center gap-2 rounded-md bg-black/80 px-2 py-1 text-xs font-semibold sm:left-3 sm:top-3 sm:text-sm">
        <span className="rounded bg-[#FACC15] px-1.5 py-px text-[11px] font-bold text-black">{ad.label || "Ad"}</span>
        <span className="truncate">{ad.brand}</span>
        {started && duration > 0 && <span className="tabular-nums text-white/85" aria-hidden="true">· {formatClock(remaining)}</span>}
      </div>

      <div className="absolute bottom-3 left-2 flex items-center gap-1.5 sm:bottom-4 sm:left-3">
        <button
          type="button"
          onClick={togglePlay}
          aria-label={paused ? "Play ad" : "Pause ad"}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-black/80 hover:bg-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#E879F9]"
        >
          {paused ? <PlayIcon /> : <PauseIcon />}
        </button>
        <button
          type="button"
          onClick={toggleMute}
          aria-label={muted ? "Unmute ad" : "Mute ad"}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-black/80 hover:bg-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#E879F9]"
        >
          {muted ? <MuteIcon /> : <VolumeIcon />}
        </button>
        {link && (
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer sponsored"
            onClick={visit}
            className="inline-flex h-9 items-center gap-1 rounded-full bg-black/80 px-3 text-xs font-semibold hover:bg-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#E879F9] sm:text-sm"
          >
            Visit advertiser<span className="sr-only"> (opens in a new tab)</span>
          </a>
        )}
      </div>

      <div className="absolute bottom-3 right-0 sm:bottom-4">
        {canSkip ? (
          <button
            type="button"
            onClick={skip}
            className="inline-flex h-10 items-center gap-1.5 rounded-l-md border border-r-0 border-white/60 bg-black/85 px-4 text-sm font-semibold hover:bg-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#E879F9]"
          >
            Skip ad <ChevronIcon />
          </button>
        ) : skipIn !== null && started ? (
          <span className="inline-flex h-10 items-center rounded-l-md bg-black/80 px-4 text-sm tabular-nums text-white/90">
            Skip in {skipIn}
          </span>
        ) : null}
      </div>

      <div className="absolute inset-x-0 bottom-0 h-1 bg-white/20" aria-hidden="true">
        <div className="h-full bg-[#FACC15]" style={{ width: `${fill}%` }} />
      </div>
    </section>
  )
}
