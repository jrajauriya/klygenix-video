import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { DanmakuLayer, HlsPlayer, useDanmaku, type CaptionTrack } from "@klygenixvideo/player"
import { api, apiUrl, errStatus, errText, getJson, sameOrigin, useSignedIn } from "../lib/api"
import { focusEl, focusFirst, useBack } from "../lib/focus"
import { clock } from "../lib/format"
import { slot, useT } from "../lib/i18n"
import { useProgressReporter } from "../lib/progress"
import type { Ad, AdBreaks, Chapter, VideoDetail } from "../lib/types"
import { AdPlayer } from "../components/AdPlayer"
import { Phone } from "../components/Tiles"

const SOURCES = ["home", "reels", "search", "channel", "follow", "related"]

function BackButton({ auto }: { auto?: boolean }) {
  const navigate = useNavigate()
  const t = useT()
  const back = () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
    if (idx > 0) navigate(-1)
    else navigate("/", { replace: true })
  }
  return (
    <button type="button" onClick={back} data-autofocus={auto || undefined} className="rounded-full bg-panel-3 px-8 py-3 text-2xl font-semibold text-white">
      ‹ {t("Back")}
    </button>
  )
}

function Screen({ video, children }: { video?: VideoDetail; children: React.ReactNode }) {
  return (
    <main className="safe-x safe-y relative min-h-screen bg-bg">
      {video?.thumbnail && <img src={video.thumbnail} alt="" className="absolute inset-0 h-full w-full object-cover opacity-20" />}
      <div className="relative max-w-[70rem]">{children}</div>
    </main>
  )
}

export default function Watch() {
  const { id = "" } = useParams()
  const signedIn = useSignedIn()
  const t = useT()
  const q = useQuery({
    queryKey: ["video", id, signedIn],
    queryFn: () => getJson<VideoDetail>(`/api/video/videos/${id}`),
    retry: (count, err) => errStatus(err) !== 404 && count < 1,
  })
  const video = q.data

  if (q.isLoading) {
    return (
      <Screen>
        <h1 className="sr-only">{t("Watch")}</h1>
        <BackButton />
        <p role="status" className="mt-10 text-3xl text-muted">{t("Loading…")}</p>
      </Screen>
    )
  }
  if (q.isError || !video) {
    return (
      <Screen>
        <BackButton auto />
        <h1 className="mt-10 text-5xl font-bold">{errStatus(q.error) === 404 ? t("This video isn't here") : t("This video did not load")}</h1>
        <p className="mt-4 text-2xl text-muted">{errText(q.error, t("Check your connection and try again."))}</p>
      </Screen>
    )
  }
  if (video.locked) {
    return (
      <Screen video={video}>
        <BackButton auto />
        <h1 className="mt-10 text-5xl font-bold">{video.title}</h1>
        <p className="mt-4 text-2xl text-muted">{video.channel?.name}</p>
        <div className="mt-8">
          <Phone what={video.locked.access === "members" ? t("This video is for channel members. To join,") : t("This is a paid video. To buy it,")} />
        </div>
      </Screen>
    )
  }
  if (video.playback?.type !== "hls") {
    const embed = video.playback
    return (
      <Screen video={video}>
        <BackButton auto />
        <h1 className="mt-10 text-5xl font-bold">{video.title}</h1>
        {embed ? (
          <>
            <p className="mt-6 text-2xl">{embed.credit}</p>
            <p className="mt-4 text-2xl text-muted">
              {slot(t("This video plays on {platform}. Watch it at {site}", { platform: embed.type === "youtube" ? "YouTube" : "Bilibili" }), "site", <strong className="text-ink">{embed.source_url}</strong>)}
            </p>
          </>
        ) : (
          <p className="mt-6 text-2xl text-muted">{t("This video isn't ready to play yet.")}</p>
        )}
      </Screen>
    )
  }
  return <Player key={video.id} video={video} url={sameOrigin(video.playback.url) ?? video.playback.url} />
}

function Player({ video, url }: { video: VideoDetail; url: string }) {
  const [params] = useSearchParams()
  const t = useT()
  const src = params.get("src") ?? ""
  const progress = useProgressReporter(video.id, SOURCES.includes(src) ? src : "direct")
  const startMs = useMemo(() => {
    const t = params.get("t")
    if (t && /^\d+$/.test(t)) return Number(t)
    return video.resume_ms > 5000 ? video.resume_ms : 0
  }, [video.id])

  const breaks = useQuery({
    queryKey: ["ad-breaks", video.id],
    queryFn: () => getJson<AdBreaks>("/api/video/ads/breaks", { video: video.id }),
    retry: 0,
    staleTime: 0,
  })
  const [phase, setPhase] = useState<"checking" | "ad" | "content">("checking")
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  const [ad, setAd] = useState<Ad | null>(null)
  const fired = useRef(new Set<number>())
  const asking = useRef(false)

  useEffect(() => {
    if (breaks.isLoading) return
    const b = breaks.data
    for (const m of b?.mid ?? []) if (m <= startMs) fired.current.add(m)
    if (!b?.eligible || !b.pre) {
      setPhase("content")
      return
    }
    let alive = true
    const fallback = window.setTimeout(() => alive && phaseRef.current === "checking" && setPhase("content"), 5000)
    getJson<{ ad: Ad | null }>("/api/video/ads/decision", { video: video.id, slot: "pre" })
      .then((r) => {
        if (!alive || phaseRef.current !== "checking") return
        if (r.ad) {
          setAd(r.ad)
          setPhase("ad")
        } else setPhase("content")
      })
      .catch(() => alive && setPhase("content"))
    return () => {
      alive = false
      window.clearTimeout(fallback)
    }
  }, [breaks.isLoading])

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [currentMs, setCurrentMs] = useState(startMs)
  const [durationMs, setDurationMs] = useState(video.duration_ms)
  const [playing, setPlaying] = useState(false)
  const [active, setActive] = useState(true)
  const [chaptersOpen, setChaptersOpen] = useState(false)
  const [danmakuOn, setDanmakuOn] = useState(true)
  const hideTimer = useRef(0)

  const captions = useMemo<CaptionTrack[]>(() => {
    const own = video.captions?.available ?? []
    const langs = own.length ? own : (video.captions?.translatable ?? []).slice(0, 1)
    return langs.map((l) => ({ lang: l, label: l.toUpperCase(), src: apiUrl(`/api/video/videos/${video.id}/captions/${l}.vtt`) }))
  }, [video.id])
  const [captionLang, setCaptionLang] = useState<string | null>(null)
  const chapters: Chapter[] = video.insight?.chapters ?? []
  const chapter = [...chapters].reverse().find((c) => c.start_ms <= currentMs)

  const danmaku = useDanmaku(video.id, currentMs, { api, enabled: danmakuOn })

  const wake = useCallback(() => {
    setActive(true)
    window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => setActive(false), 5000)
  }, [])
  useEffect(() => () => window.clearTimeout(hideTimer.current), [])

  useEffect(() => {
    if (phase !== "content") return
    const onKey = (e: KeyboardEvent) => {
      const hidden = !active && playing && !chaptersOpen
      wake()
      if (hidden && e.key.startsWith("Arrow")) {
        e.preventDefault()
        e.stopImmediatePropagation()
      }
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [phase, active, playing, chaptersOpen, wake])

  useBack(() => {
    if (chaptersOpen) {
      setChaptersOpen(false)
      return true
    }
    return false
  })

  const playRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    if (phase === "content") setMounted(true)
  }, [phase])
  useEffect(() => {
    if (chaptersOpen) focusFirst(panelRef.current ?? undefined)
    else if (phase === "content") focusEl(playRef.current)
  }, [phase, chaptersOpen])

  const onTime = useCallback((ms: number) => {
    setCurrentMs(ms)
    progress.onTime(ms)
    const v = videoRef.current
    if (v && Number.isFinite(v.duration) && v.duration > 0) setDurationMs(v.duration * 1000)
    if (phaseRef.current !== "content" || asking.current) return
    const due = (breaks.data?.mid ?? []).find((m) => !fired.current.has(m) && ms >= m && ms < m + 20_000)
    if (due === undefined) return
    fired.current.add(due)
    asking.current = true
    v?.pause()
    getJson<{ ad: Ad | null }>("/api/video/ads/decision", { video: video.id, slot: "mid" })
      .then((r) => {
        if (r.ad) {
          setAd(r.ad)
          setPhase("ad")
        } else videoRef.current?.play().catch(() => undefined)
      })
      .catch(() => videoRef.current?.play().catch(() => undefined))
      .finally(() => {
        asking.current = false
      })
  }, [progress, breaks.data, video.id])

  const adDone = useCallback(() => {
    setAd(null)
    setPhase("content")
    wake()
    window.setTimeout(() => videoRef.current?.play().catch(() => undefined), 0)
  }, [wake])

  const toggle = () => {
    const v = videoRef.current
    if (!v) return
    if (v.paused || v.ended) v.play().catch(() => undefined)
    else v.pause()
  }
  const seek = (ms: number) => {
    const v = videoRef.current
    if (!v) return
    const max = Number.isFinite(v.duration) ? v.duration * 1000 : ms
    v.currentTime = Math.max(0, Math.min(ms, max)) / 1000
    setCurrentMs(v.currentTime * 1000)
  }

  const showChrome = active || !playing || chaptersOpen
  const ctl = "rounded-full bg-black/60 px-7 py-3 text-2xl font-semibold text-white hover:bg-black/80 focus:bg-white focus:text-black"
  const pct = durationMs > 0 ? Math.min(100, (currentMs / durationMs) * 100) : 0
  const navigate = useNavigate()

  return (
    <main className="fixed inset-0 overflow-hidden bg-black text-white">
      <h1 className="sr-only">{video.title}</h1>
      {(mounted || phase === "content") && (
        <HlsPlayer
          src={url}
          poster={sameOrigin(video.thumbnail)}
          startMs={startMs || undefined}
          autoPlay
          controls={false}
          hotkeys={false}
          captions={captions}
          captionLang={captionLang}
          chapters={chapters}
          videoRef={videoRef}
          className="tv-player absolute inset-0 h-full w-full"
          onTime={onTime}
          onPlay={() => {
            setPlaying(true)
            progress.onPlay()
            wake()
          }}
          onPause={() => {
            setPlaying(false)
            progress.onPause()
            setActive(true)
          }}
          onEnded={progress.onEnded}
        >
          <DanmakuLayer items={danmaku.items} currentMs={currentMs} playing={playing} enabled={danmakuOn} />
        </HlsPlayer>
      )}
      {!mounted && phase !== "content" && <p role="status" className="absolute inset-0 flex items-center justify-center text-3xl text-white/80">{t("Starting…")}</p>}

      {video.paid_partnership && (
        <p className="absolute right-[6rem] top-[3.375rem] rounded-lg bg-black/80 px-4 py-2 text-xl font-semibold">{t("Paid partnership with {brand}", { brand: video.paid_partnership.brand })}</p>
      )}

      <div className={`transition-opacity duration-300 ${showChrome && phase === "content" ? "opacity-100" : "pointer-events-none opacity-0"}`}>
        <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/85 to-transparent px-[6rem] pb-16 pt-[3.375rem]">
          <p className={`max-w-[70%] text-4xl font-bold leading-tight ${video.paid_partnership ? "mt-14" : ""}`}>{video.title}</p>
          <p className="mt-2 text-2xl text-white/80">
            {video.channel?.name}
            {video.ai_generated ? ` · ${t("AI-generated")}` : ""}
          </p>
        </div>
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-[6rem] pb-[3.375rem] pt-24">
          <div className="flex items-baseline justify-between text-2xl">
            <span>{chapter ? chapter.title : ""}</span>
            <span className="tabular-nums">
              {clock(currentMs)} / {clock(durationMs)}
            </span>
          </div>
          <div
            className="relative mt-3 h-2.5 rounded-full bg-white/25"
            role="progressbar"
            aria-label={t("Playback position")}
            aria-valuemin={0}
            aria-valuemax={Math.round(durationMs / 1000)}
            aria-valuenow={Math.round(currentMs / 1000)}
            aria-valuetext={t("{at} of {total}", { at: clock(currentMs), total: clock(durationMs) })}
          >
            <div className="h-full rounded-full bg-brand-soft" style={{ width: `${pct}%` }} />
            {durationMs > 0 && chapters.map((c) => (
              <span key={c.start_ms} className="absolute top-0 h-full w-1 bg-black" style={{ left: `${(c.start_ms / durationMs) * 100}%` }} />
            ))}
          </div>
          <div className="mt-6 flex flex-wrap gap-4" data-focus-group>
            <button type="button" className={ctl} onClick={() => {
              const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
              if (idx > 0) navigate(-1)
              else navigate("/", { replace: true })
            }}>‹ {t("Back")}</button>
            <button ref={playRef} type="button" data-autofocus className={`${ctl} min-w-[9rem]`} onClick={toggle}>
              {playing ? t("Pause") : t("Play")}
            </button>
            <button type="button" className={ctl} onClick={() => seek(currentMs - 10_000)}>{t("Back 10 s")}</button>
            <button type="button" className={ctl} onClick={() => seek(currentMs + 10_000)}>{t("Forward 10 s")}</button>
            {captions.length > 0 && (
              <button type="button" className={ctl} aria-pressed={captionLang !== null} onClick={() => setCaptionLang(captionLang ? null : captions[0].lang)}>
                {captionLang ? t("Captions on") : t("Captions off")}
              </button>
            )}
            <button type="button" className={ctl} aria-pressed={danmakuOn} onClick={() => setDanmakuOn(!danmakuOn)}>
              {danmakuOn ? t("Danmaku on") : t("Danmaku off")}
            </button>
            {chapters.length > 0 && (
              <button type="button" className={ctl} onClick={() => setChaptersOpen(true)}>{t("Chapters")}</button>
            )}
            {video.channel && (
              <Link to={`/channel/${video.channel.handle}`} className={ctl}>{video.channel.name}</Link>
            )}
          </div>
        </div>
      </div>

      {chaptersOpen && (
        <div ref={panelRef} data-focus-scope role="dialog" aria-modal="true" aria-labelledby="chapters-title" className="absolute inset-y-0 right-0 w-[36rem] overflow-y-auto bg-panel/95 px-10 py-[3.375rem]">
          <h2 id="chapters-title" className="text-3xl font-bold">{t("Chapters")}</h2>
          <ul className="mt-6 flex flex-col gap-3" data-focus-group>
            {chapters.map((c) => (
              <li key={c.start_ms}>
                <button
                  type="button"
                  data-autofocus={c === chapter || undefined}
                  className={`flex w-full items-baseline justify-between gap-4 rounded-xl px-5 py-4 text-left text-2xl ${c === chapter ? "bg-brand text-white" : "bg-panel-3"}`}
                  onClick={() => {
                    seek(c.start_ms)
                    videoRef.current?.play().catch(() => undefined)
                    setChaptersOpen(false)
                  }}
                >
                  <span>{c.title}</span>
                  <span className="tabular-nums text-white/80">{clock(c.start_ms)}</span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="mt-6 rounded-full bg-panel-3 px-8 py-3 text-2xl font-semibold" onClick={() => setChaptersOpen(false)}>{t("Close")}</button>
        </div>
      )}

      {phase === "ad" && ad && <AdPlayer key={ad.token} ad={ad} onDone={adDone} />}
    </main>
  )
}
