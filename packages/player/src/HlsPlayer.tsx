import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react"
import type HlsType from "hls.js"
import type { CaptionTrack, Chapter, DubTrack } from "./types"
import { ChapterBar } from "./ChapterBar"
import { activeChapter, cx, formatClock } from "./format"
import {
  BackIcon, CaptionsIcon, CheckIcon, ChevronIcon, ExpandIcon, ForwardIcon, MuteIcon, PauseIcon, PlayIcon,
  SettingsIcon, ShrinkIcon, SpinnerIcon, VolumeIcon,
} from "./icons"

export const DANMAKU_TOGGLE_EVENT = "kv:danmaku-toggle"

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]

export interface HlsPlayerProps {
  src: string
  poster?: string
  startMs?: number
  autoPlay?: boolean
  muted?: boolean
  loop?: boolean
  controls?: boolean
  captions?: CaptionTrack[]
  captionLang?: string | null
  chapters?: Chapter[]
  dubs?: DubTrack[]
  hotkeys?: boolean
  fit?: "contain" | "cover"
  onTime?: (ms: number) => void
  onEnded?: () => void
  onPlay?: () => void
  onPause?: () => void
  onDanmakuToggle?: () => void
  onCaptionChange?: (lang: string | null) => void
  onMutedChange?: (muted: boolean) => void
  className?: string
  videoRef?: RefObject<HTMLVideoElement | null>
  children?: ReactNode
}

interface Level {
  index: number
  height: number
  bitrate: number
}

type Menu = null | "root" | "quality" | "speed" | "captions" | "audio"

const DRIFT = 0.3

function editable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable
}

function useLatest<T>(value: T) {
  const ref = useRef(value)
  ref.current = value
  return ref
}

export function HlsPlayer({
  src, poster, startMs, autoPlay = false, muted: mutedProp = false, loop = false, controls = true, captions,
  captionLang: captionProp, chapters, dubs, hotkeys = true, fit = "contain", onTime, onEnded, onPlay, onPause,
  onDanmakuToggle, onCaptionChange, onMutedChange, className, videoRef, children,
}: HlsPlayerProps) {
  const video = useRef<HTMLVideoElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const hls = useRef<HlsType | null>(null)
  const pendingStart = useRef<number | null>(startMs ?? null)
  const hideTimer = useRef<number | undefined>(undefined)
  const lastEmit = useRef(-1)
  const lastCaption = useRef<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [started, setStarted] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(mutedProp)
  const [rate, setRate] = useState(1)
  const [levels, setLevels] = useState<Level[]>([])
  const [level, setLevel] = useState(-1)
  const [actualLevel, setActualLevel] = useState(-1)
  const [captionLang, setCaptionLang] = useState<string | null>(captionProp ?? null)
  const [fullscreen, setFullscreen] = useState(false)
  const [active, setActive] = useState(true)
  const [menu, setMenu] = useState<Menu>(null)
  const [failed, setFailed] = useState(false)
  const [dubLang, setDubLang] = useState<string | null>(null)
  const audio = useRef<HTMLAudioElement>(null)
  const dub = dubs?.find((d) => d.language === dubLang) ?? null
  const dubRef = useLatest(dub)
  const [dubSrc, setDubSrc] = useState<string | null>(null)
  const cb = useLatest({ onTime, onEnded, onPlay, onPause, onDanmakuToggle, onCaptionChange, onMutedChange })

  useEffect(() => {
    if (videoRef) videoRef.current = video.current
  })

  useEffect(() => {
    if (captionProp !== undefined) setCaptionLang(captionProp)
  }, [captionProp])

  useEffect(() => {
    const v = video.current
    if (v) v.muted = mutedProp
    setMuted(mutedProp)
  }, [mutedProp])

  useEffect(() => {
    if (startMs === undefined) return
    const v = video.current
    if (v && v.readyState >= 1) v.currentTime = startMs / 1000
    else pendingStart.current = startMs
  }, [startMs])

  useEffect(() => {
    const v = video.current
    if (!v) return
    let cancelled = false
    setFailed(false)
    setLevels([])
    setLevel(-1)
    setStarted(false)
    const isHls = /\.m3u8(\?|$)/i.test(src)
    const native = v.canPlayType("application/vnd.apple.mpegurl") !== ""
    const safari = /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent)
    const kick = () => {
      if (!autoPlay || cancelled) return
      v.play().catch(() => {
        if (cancelled || v.muted) return
        v.muted = true
        v.play().catch(() => undefined)
      })
    }
    if (!isHls || (native && safari)) {
      v.src = src
      kick()
    } else {
      import("hls.js").then(({ default: Hls }) => {
        if (cancelled) return
        if (!Hls.isSupported()) {
          v.src = src
          kick()
          return
        }
        const h = new Hls({ capLevelToPlayerSize: true, enableWorker: true, startLevel: 0, startFragPrefetch: true })
        hls.current = h
        h.on(Hls.Events.MANIFEST_PARSED, (_e, data) => {
          setLevels(data.levels.map((l, index) => ({ index, height: l.height, bitrate: l.bitrate })))
          kick()
        })
        h.on(Hls.Events.LEVEL_SWITCHED, (_e, data) => setActualLevel(data.level))
        h.on(Hls.Events.ERROR, (_e, data) => {
          if (!data.fatal) return
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) h.startLoad()
          else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) h.recoverMediaError()
          else {
            h.destroy()
            hls.current = null
            setFailed(true)
          }
        })
        h.loadSource(src)
        h.attachMedia(v)
      }).catch(() => setFailed(true))
    }
    return () => {
      cancelled = true
      hls.current?.destroy()
      hls.current = null
      v.removeAttribute("src")
      v.load()
    }
  }, [src, autoPlay])

  useEffect(() => {
    const v = video.current
    if (!v) return
    const list = v.textTracks
    for (let i = 0; i < list.length; i++) {
      const t = list[i]
      const on = Boolean(captionLang && t.language === captionLang)
      t.mode = on ? "showing" : "disabled"
      t.oncuechange = on && controls
        ? () => {
            const cues = t.activeCues
            if (!cues) return
            for (let j = 0; j < cues.length; j++) {
              const cue = cues[j] as VTTCue
              if (cue.line === "auto") cue.line = -3
            }
          }
        : null
    }
  }, [captionLang, captions, controls])

  const emit = useCallback((ms: number, force = false) => {
    if (!force && Math.abs(ms - lastEmit.current) < 90) return
    lastEmit.current = ms
    setCurrent(ms)
    cb.current.onTime?.(ms)
  }, [cb])

  useEffect(() => {
    if (!playing) return
    let frame = 0
    const loopFrame = () => {
      const v = video.current
      if (v) emit(v.currentTime * 1000)
      frame = requestAnimationFrame(loopFrame)
    }
    frame = requestAnimationFrame(loopFrame)
    return () => cancelAnimationFrame(frame)
  }, [playing, emit])

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === box.current)
    document.addEventListener("fullscreenchange", onChange)
    return () => document.removeEventListener("fullscreenchange", onChange)
  }, [])

  useEffect(() => {
    if (dubLang && !dubs?.some((d) => d.language === dubLang)) setDubLang(null)
  }, [dubs, dubLang])

  useEffect(() => {
    setDubSrc(null)
    if (!dub) return
    let alive = true
    let made: string | null = null
    fetch(dub.url)
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((b) => {
        if (!alive) return
        made = URL.createObjectURL(b)
        setDubSrc(made)
      })
      .catch(() => {
        if (alive) setDubSrc(dub.url)
      })
    return () => {
      alive = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [dub?.url])

  useEffect(() => {
    const v = video.current
    const a = audio.current
    if (!v || !dub || !dubSrc || !a) return
    a.volume = v.volume
    a.muted = v.muted
    v.muted = true
    setVolume(a.volume)
    setMuted(a.muted)
    const align = () => {
      if (Math.abs(a.currentTime - v.currentTime) > DRIFT) a.currentTime = v.currentTime
    }
    const play = () => {
      align()
      a.playbackRate = v.playbackRate
      a.play().catch(() => undefined)
    }
    const pause = () => a.pause()
    const rate = () => { a.playbackRate = v.playbackRate }
    const seeked = () => { a.currentTime = v.currentTime }
    v.addEventListener("playing", play)
    v.addEventListener("pause", pause)
    v.addEventListener("waiting", pause)
    v.addEventListener("seeking", seeked)
    v.addEventListener("ratechange", rate)
    v.addEventListener("ended", pause)
    const timer = window.setInterval(() => {
      if (!v.paused && !v.seeking) {
        align()
        if (a.paused && v.readyState >= 3) a.play().catch(() => undefined)
      }
    }, 500)
    a.currentTime = v.currentTime
    if (!v.paused) play()
    return () => {
      window.clearInterval(timer)
      v.removeEventListener("playing", play)
      v.removeEventListener("pause", pause)
      v.removeEventListener("waiting", pause)
      v.removeEventListener("seeking", seeked)
      v.removeEventListener("ratechange", rate)
      v.removeEventListener("ended", pause)
      a.pause()
      v.volume = a.volume
      v.muted = a.muted
      setVolume(v.volume)
      setMuted(v.muted)
    }
  }, [dubSrc])

  const toggle = useCallback(() => {
    const v = video.current
    if (!v) return
    if (v.paused || v.ended) v.play().catch(() => undefined)
    else v.pause()
  }, [])

  const seek = useCallback((ms: number) => {
    const v = video.current
    if (!v) return
    const max = Number.isFinite(v.duration) ? v.duration * 1000 : ms
    const next = Math.max(0, Math.min(ms, max))
    v.currentTime = next / 1000
    emit(next, true)
  }, [emit])

  const nudge = useCallback((delta: number) => {
    const v = video.current
    if (v) seek(v.currentTime * 1000 + delta)
  }, [seek])

  const sink = useCallback((): HTMLMediaElement | null => (dubRef.current && audio.current ? audio.current : video.current), [dubRef])

  const toggleMute = useCallback(() => {
    const v = sink()
    if (!v) return
    v.muted = !v.muted
    if (!v.muted && v.volume === 0) v.volume = 0.5
  }, [sink])

  const toggleFullscreen = useCallback(() => {
    const el = box.current
    const v = video.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null
    if (!el) return
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => undefined)
    } else if (el.requestFullscreen) {
      el.requestFullscreen().catch(() => v?.webkitEnterFullscreen?.())
    } else {
      v?.webkitEnterFullscreen?.()
    }
  }, [])

  const chooseCaption = useCallback((lang: string | null) => {
    if (lang) lastCaption.current = lang
    setCaptionLang(lang)
    cb.current.onCaptionChange?.(lang)
  }, [cb])

  const toggleCaptions = useCallback(() => {
    if (!captions?.length) return
    if (captionLang) chooseCaption(null)
    else chooseCaption(lastCaption.current ?? captions[0].lang)
  }, [captions, captionLang, chooseCaption])

  const toggleDanmaku = useCallback(() => {
    cb.current.onDanmakuToggle?.()
    box.current?.dispatchEvent(new CustomEvent(DANMAKU_TOGGLE_EVENT, { bubbles: true }))
  }, [cb])

  const wake = useCallback(() => {
    setActive(true)
    window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => setActive(false), 2600)
  }, [])

  useEffect(() => () => window.clearTimeout(hideTimer.current), [])

  useEffect(() => {
    if (!hotkeys || !controls) return
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || editable(e.target)) return
      const onButton = (e.target as HTMLElement | null)?.tagName === "BUTTON"
      const key = e.key.toLowerCase()
      if ((key === " " && !onButton) || key === "k") toggle()
      else if (key === "j") nudge(-10_000)
      else if (key === "l") nudge(10_000)
      else if (key === "arrowleft" && !onButton) nudge(-5_000)
      else if (key === "arrowright" && !onButton) nudge(5_000)
      else if (key === "f") toggleFullscreen()
      else if (key === "m") toggleMute()
      else if (key === "c") toggleCaptions()
      else if (key === "d") toggleDanmaku()
      else return
      e.preventDefault()
      wake()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [hotkeys, controls, toggle, nudge, toggleFullscreen, toggleMute, toggleCaptions, toggleDanmaku, wake])

  function chooseLevel(index: number) {
    setLevel(index)
    if (hls.current) hls.current.currentLevel = index
  }

  function chooseRate(next: number) {
    const v = video.current
    if (v) v.playbackRate = next
  }

  function onSurfaceUp(e: React.PointerEvent) {
    if (!controls) return
    if (e.pointerType === "touch" && !active) {
      wake()
      return
    }
    setMenu(null)
    toggle()
    wake()
  }

  const showChrome = controls && (!playing || active || menu !== null)
  const chapter = activeChapter(chapters, current)
  const qualityLabel = level === -1
    ? `Auto${actualLevel >= 0 && levels[actualLevel] ? ` (${levels[actualLevel].height}p)` : ""}`
    : `${levels[level]?.height ?? ""}p`
  const captionLabel = captions?.find((c) => c.lang === captionLang)?.label ?? "Off"

  return (
    <div
      ref={box}
      className={cx("kvp-root relative overflow-hidden bg-black text-white", fullscreen && "kvp-full", className)}
      onPointerMove={controls ? wake : undefined}
      onMouseLeave={() => playing && setActive(false)}
    >
      <style>{`.kvp-root video::cue{background:rgba(0,0,0,.65);color:#fff;font-size:clamp(14px,2.4vw,22px);line-height:1.35}.kvp-full video::cue{font-size:clamp(18px,2.6vw,32px)}`}</style>
      <video
        ref={video}
        className={cx("absolute inset-0 h-full w-full", fit === "cover" ? "object-cover" : "object-contain")}
        poster={poster}
        loop={loop}
        muted={mutedProp}
        playsInline
        crossOrigin="anonymous"
        preload="metadata"
        onPlay={() => {
          setPlaying(true)
          setStarted(true)
          cb.current.onPlay?.()
          wake()
        }}
        onPause={() => {
          setPlaying(false)
          setActive(true)
          cb.current.onPause?.()
          const v = video.current
          if (v) emit(v.currentTime * 1000, true)
        }}
        onEnded={() => cb.current.onEnded?.()}
        onWaiting={() => setWaiting(true)}
        onPlaying={() => setWaiting(false)}
        onCanPlay={() => setWaiting(false)}
        onLoadedMetadata={(e) => {
          const v = e.currentTarget
          setDuration(Number.isFinite(v.duration) ? v.duration * 1000 : 0)
          const at = pendingStart.current
          pendingStart.current = null
          if (at && at > 0 && (!Number.isFinite(v.duration) || at < v.duration * 1000 - 1500)) {
            v.currentTime = at / 1000
            emit(at, true)
          }
        }}
        onDurationChange={(e) => {
          const d = e.currentTarget.duration
          setDuration(Number.isFinite(d) ? d * 1000 : 0)
        }}
        onTimeUpdate={(e) => emit(e.currentTarget.currentTime * 1000, !playing)}
        onSeeked={(e) => emit(e.currentTarget.currentTime * 1000, true)}
        onProgress={(e) => {
          const v = e.currentTarget
          const ranges = v.buffered
          for (let i = 0; i < ranges.length; i++) {
            if (ranges.start(i) <= v.currentTime && ranges.end(i) >= v.currentTime) {
              setBuffered(ranges.end(i) * 1000)
              return
            }
          }
        }}
        onVolumeChange={(e) => {
          if (dubRef.current && audio.current) return
          setVolume(e.currentTarget.volume)
          setMuted(e.currentTarget.muted)
          cb.current.onMutedChange?.(e.currentTarget.muted)
        }}
        onRateChange={(e) => setRate(e.currentTarget.playbackRate)}
        onError={() => {
          if (!hls.current) setFailed(true)
        }}
      >
        {captions?.map((c) => (
          <track key={`${c.lang}:${c.src}`} kind="subtitles" srcLang={c.lang} label={c.label} src={c.src} />
        ))}
      </video>
      {dub && dubSrc && (
        <audio
          key={dubSrc}
          ref={audio}
          src={dubSrc}
          preload="auto"
          onVolumeChange={(e) => {
            setVolume(e.currentTarget.volume)
            setMuted(e.currentTarget.muted)
            cb.current.onMutedChange?.(e.currentTarget.muted)
          }}
        />
      )}

      {children && <div className="pointer-events-none absolute inset-0">{children}</div>}

      {dub && (
        <span className="pointer-events-none absolute left-2 top-2 z-10 rounded-md bg-black/75 px-2 py-1 text-xs font-semibold text-white">
          {dub.label} · {dub.name}
        </span>
      )}

      {controls && <div className="absolute inset-0" onPointerUp={onSurfaceUp} onDoubleClick={toggleFullscreen} />}

      {waiting && !failed && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-white/90">
          <SpinnerIcon />
        </div>
      )}

      {failed && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70 p-6 text-center text-sm text-white/80">
          This video could not be played. Check your connection and try again.
        </div>
      )}

      {controls && !started && !playing && !failed && (
        <button
          type="button"
          aria-label="Play"
          onClick={toggle}
          className="absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-[#A21CAF]/90 text-white shadow-lg ring-4 ring-white/10 transition hover:bg-[#C026D3]"
        >
          <span className="scale-150"><PlayIcon /></span>
        </button>
      )}

      {controls && (
        <div
          className={cx(
            "absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-2 pb-1.5 pt-10 transition-opacity duration-200 sm:px-3",
            showChrome ? "opacity-100" : "pointer-events-none opacity-0",
          )}
        >
          <ChapterBar durationMs={duration} currentMs={current} bufferedMs={buffered} chapters={chapters} onSeek={seek} />
          <div className="flex items-center gap-0.5 sm:gap-1">
            <CtlButton label={playing ? "Pause (k)" : "Play (k)"} onClick={toggle}>{playing ? <PauseIcon /> : <PlayIcon />}</CtlButton>
            <CtlButton label="Back 10 seconds (j)" onClick={() => nudge(-10_000)}><BackIcon /></CtlButton>
            <CtlButton label="Forward 10 seconds (l)" onClick={() => nudge(10_000)}><ForwardIcon /></CtlButton>
            <div className="group/vol flex items-center">
              <CtlButton label={muted ? "Unmute (m)" : "Mute (m)"} onClick={toggleMute}>{muted || volume === 0 ? <MuteIcon /> : <VolumeIcon />}</CtlButton>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : volume}
                aria-label="Volume"
                onChange={(e) => {
                  const v = sink()
                  if (!v) return
                  v.volume = Number(e.target.value)
                  v.muted = v.volume === 0
                }}
                className="hidden h-1 w-0 cursor-pointer accent-[#E879F9] opacity-0 transition-[width,opacity] duration-200 group-hover/vol:w-20 group-hover/vol:opacity-100 focus:w-20 focus:opacity-100 sm:block"
              />
            </div>
            <span className="ml-1 whitespace-nowrap text-xs tabular-nums text-white/90 sm:text-[13px]">
              {formatClock(current)} <span className="text-white/50">/ {formatClock(duration)}</span>
            </span>
            {chapter && (
              <span className="ml-2 hidden min-w-0 truncate text-xs text-white/70 md:inline">· {chapter.title}</span>
            )}
            <div className="flex-1" />
            {rate !== 1 && <span className="mr-1 rounded bg-white/15 px-1.5 text-[11px] font-semibold">{rate}x</span>}
            {!!captions?.length && (
              <CtlButton label="Subtitles (c)" onClick={toggleCaptions} pressed={!!captionLang}>
                <span className={cx("relative", captionLang && "text-[#F0ABFC]")}>
                  <CaptionsIcon />
                  {captionLang && <span className="absolute -bottom-1 left-1 right-1 h-0.5 rounded bg-[#E879F9]" />}
                </span>
              </CtlButton>
            )}
            <div className="relative">
              <CtlButton label="Settings" onClick={() => setMenu(menu ? null : "root")} pressed={menu !== null}><SettingsIcon /></CtlButton>
              {menu && (
                <div
                  role="menu"
                  className="absolute bottom-11 right-0 z-20 max-h-[min(70vh,320px)] w-56 overflow-y-auto rounded-xl border border-white/10 bg-[#14141d]/95 p-1.5 text-sm shadow-2xl backdrop-blur"
                  onPointerUp={(e) => e.stopPropagation()}
                >
                  {menu === "root" && (
                    <>
                      {levels.length > 0 && <MenuRow label="Quality" value={qualityLabel} onClick={() => setMenu("quality")} />}
                      <MenuRow label="Speed" value={rate === 1 ? "Normal" : `${rate}x`} onClick={() => setMenu("speed")} />
                      {!!captions?.length && <MenuRow label="Subtitles" value={captionLabel} onClick={() => setMenu("captions")} />}
                      {!!dubs?.length && <MenuRow label="Audio" value={dub ? `${dub.name} (${dub.label})` : "Original"} onClick={() => setMenu("audio")} />}
                    </>
                  )}
                  {menu === "quality" && (
                    <>
                      <MenuBack label="Quality" onClick={() => setMenu("root")} />
                      <MenuOption label="Auto" on={level === -1} onClick={() => { chooseLevel(-1); setMenu(null) }} />
                      {[...levels].sort((a, b) => b.height - a.height).map((l) => (
                        <MenuOption key={l.index} label={`${l.height}p`} on={level === l.index} onClick={() => { chooseLevel(l.index); setMenu(null) }} />
                      ))}
                    </>
                  )}
                  {menu === "speed" && (
                    <>
                      <MenuBack label="Speed" onClick={() => setMenu("root")} />
                      {SPEEDS.map((s) => (
                        <MenuOption key={s} label={s === 1 ? "Normal" : `${s}x`} on={rate === s} onClick={() => { chooseRate(s); setMenu(null) }} />
                      ))}
                    </>
                  )}
                  {menu === "audio" && (
                    <>
                      <MenuBack label="Audio" onClick={() => setMenu("root")} />
                      <MenuOption label="Original" on={!dub} onClick={() => { setDubLang(null); setMenu(null) }} />
                      {dubs?.map((d) => (
                        <MenuOption key={d.language} label={`${d.name} (${d.label})`} on={dubLang === d.language} onClick={() => { setDubLang(d.language); setMenu(null) }} />
                      ))}
                    </>
                  )}
                  {menu === "captions" && (
                    <>
                      <MenuBack label="Subtitles" onClick={() => setMenu("root")} />
                      <MenuOption label="Off" on={!captionLang} onClick={() => { chooseCaption(null); setMenu(null) }} />
                      {captions?.map((c) => (
                        <MenuOption key={c.lang} label={c.label} on={captionLang === c.lang} onClick={() => { chooseCaption(c.lang); setMenu(null) }} />
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
            <CtlButton label={fullscreen ? "Exit full screen (f)" : "Full screen (f)"} onClick={toggleFullscreen}>
              {fullscreen ? <ShrinkIcon /> : <ExpandIcon />}
            </CtlButton>
          </div>
        </div>
      )}
    </div>
  )
}

function CtlButton({ label, onClick, children, pressed }: { label: string; onClick: () => void; children: ReactNode; pressed?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
      onPointerUp={(e) => e.stopPropagation()}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/90 transition hover:bg-white/15 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#E879F9]"
    >
      {children}
    </button>
  )
}

function MenuRow({ label, value, onClick }: { label: string; value: string; onClick: () => void }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-white/10">
      <span className="flex-1 text-white/90">{label}</span>
      <span className="truncate text-xs text-white/55">{value}</span>
      <ChevronIcon />
    </button>
  )
}

function MenuBack({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="mb-1 flex w-full items-center gap-2 border-b border-white/10 px-3 py-2 text-left font-semibold text-white">
      <span className="rotate-180"><ChevronIcon /></span>
      {label}
    </button>
  )
}

function MenuOption({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button type="button" role="menuitemradio" aria-checked={on} onClick={onClick} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-white/10">
      <span className={cx("w-4", on ? "text-[#F0ABFC]" : "opacity-0")}><CheckIcon /></span>
      <span className="flex-1 truncate text-white/90">{label}</span>
    </button>
  )
}
