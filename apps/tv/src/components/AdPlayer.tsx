import { useEffect, useRef, useState } from "react"
import type HlsType from "hls.js"
import { api, sameOrigin } from "../lib/api"
import { focusEl } from "../lib/focus"
import { clock, host } from "../lib/format"
import type { Ad } from "../lib/types"

const QUARTILES: [number, string][] = [[0.25, "q1"], [0.5, "mid"], [0.75, "q3"]]

export function AdPlayer({ ad, onDone }: { ad: Ad; onDone: () => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const skipRef = useRef<HTMLButtonElement>(null)
  const sent = useRef(new Set<string>())
  const finished = useRef(false)
  const done = useRef(onDone)
  done.current = onDone
  const [pos, setPos] = useState(0)
  const [started, setStarted] = useState(false)
  const [length, setLength] = useState(ad.duration_ms || 0)

  const send = (event: string) => {
    if (sent.current.has(event)) return
    sent.current.add(event)
    api.post("/api/video/ads/events", { token: ad.token, event }).catch(() => undefined)
  }
  const finish = (how: "complete" | "skip" | "error") => {
    if (finished.current) return
    finished.current = true
    if (how !== "error" && sent.current.has("start")) send(how)
    done.current()
  }
  const sendRef = useRef(send)
  sendRef.current = send
  const finishRef = useRef(finish)
  finishRef.current = finish

  useEffect(() => {
    const v = video.current
    if (!v) return
    let hls: HlsType | null = null
    let cancelled = false
    const kick = () => {
      v.play().catch(() => {
        if (cancelled) return
        v.muted = true
        v.play().catch(() => finishRef.current("error"))
      })
    }
    const url = sameOrigin(ad.playback?.url)
    if (!url) {
      finishRef.current("error")
      return
    }
    const native = v.canPlayType("application/vnd.apple.mpegurl") !== "" && /^((?!chrome|android).)*safari/i.test(navigator.userAgent)
    if (!/\.m3u8(\?|$)/i.test(url) || native) {
      v.src = url
      kick()
    } else {
      import("hls.js").then(({ default: Hls }) => {
        if (cancelled) return
        if (!Hls.isSupported()) {
          v.src = url
          kick()
          return
        }
        hls = new Hls({ enableWorker: true, startLevel: 0 })
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (data.fatal) finishRef.current("error")
        })
        hls.on(Hls.Events.MANIFEST_PARSED, kick)
        hls.loadSource(url)
        hls.attachMedia(v)
      }).catch(() => finishRef.current("error"))
    }
    const stall = window.setTimeout(() => {
      if (!sent.current.has("start")) finishRef.current("error")
    }, 10_000)
    return () => {
      cancelled = true
      window.clearTimeout(stall)
      hls?.destroy()
      v.removeAttribute("src")
      v.load()
    }
  }, [ad.playback?.url])

  const skipAfter = Math.max(0, ad.skip_after_seconds ?? 0) * 1000
  const canSkip = started && pos >= skipAfter

  useEffect(() => {
    if (canSkip) focusEl(skipRef.current)
  }, [canSkip])

  return (
    <div data-focus-scope role="region" aria-label={`Advertisement from ${ad.brand}`} className="fixed inset-0 z-50 bg-black text-white">
      <video
        ref={video}
        className="absolute inset-0 h-full w-full object-contain"
        playsInline
        crossOrigin="anonymous"
        onPlaying={() => {
          sendRef.current("start")
          setStarted(true)
        }}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration
          if (Number.isFinite(d) && d > 0) setLength(d * 1000)
        }}
        onTimeUpdate={(e) => {
          const ms = e.currentTarget.currentTime * 1000
          setPos(ms)
          if (length > 0) for (const [at, name] of QUARTILES) if (ms >= length * at) sendRef.current(name)
        }}
        onEnded={() => finishRef.current("complete")}
        onError={() => finishRef.current("error")}
      />
      <div className="absolute left-[6rem] top-[3.375rem] flex items-center gap-4">
        <span className="rounded-lg bg-[#facc15] px-4 py-2 text-2xl font-extrabold text-black">Ad · {ad.brand}</span>
        <span className="rounded-lg bg-black/80 px-4 py-2 text-2xl font-semibold" role="timer" aria-live="off">
          {length > 0 ? `Ends in ${clock(Math.max(0, length - pos))}` : "Playing"}
        </span>
      </div>
      <div className="absolute inset-x-[6rem] bottom-[3.375rem] flex items-end justify-between gap-8">
        <p className="max-w-[60%] rounded-lg bg-black/80 px-5 py-3 text-2xl">
          Learn more at <span className="font-semibold text-[#fde68a]">{host(ad.click_url)}</span>
        </p>
        {canSkip ? (
          <button ref={skipRef} type="button" onClick={() => finishRef.current("skip")} className="rounded-xl bg-white px-10 py-4 text-3xl font-bold text-black">
            Skip ad ›
          </button>
        ) : (
          <p className="rounded-xl bg-black/80 px-8 py-4 text-2xl font-semibold">
            {started ? `Skip ad in ${Math.ceil((skipAfter - pos) / 1000)}` : "Ad starting…"}
          </p>
        )}
      </div>
    </div>
  )
}
