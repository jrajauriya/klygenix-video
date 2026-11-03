import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom"
import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { Captions, Clapperboard, Flag, Heart, MessageCircle, Pause, Share2, Volume2, VolumeX } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { cn } from "@klygenixvideo/ui"
import { HlsPlayer } from "@klygenixvideo/player"
import { apiUrl, errText, getJson, loginPath, useSignedIn } from "../lib/api"
import { compactNumber } from "../lib/format"
import { useProgressReporter } from "../lib/progress"
import { useTitle } from "../lib/title"
import { REELS_PAGE, reelsKey, reelsPage } from "../lib/reelsFeed"
import type { VideoCard, VideoDetail } from "../lib/types"
import { AiBadge, ChannelAvatar, Empty, Skel } from "../components/bits"
import { Comments } from "../components/Comments"
import { FollowButton } from "../components/FollowButton"
import { ReportDialog, type ReportTarget } from "../components/ReportDialog"
import { Sheet } from "../components/Sheet"
import { AccessBadge } from "../components/VideoCards"
import { PreviewBadge } from "./watch/lockBits"


const LockedOverlay = lazy(() => import("./watch/Paywall").then((m) => ({ default: m.LockedOverlay })))

const reelSource = () => ({ src: "reels" })

const HEIGHT = "h-[calc(100dvh-7rem)] md:h-[calc(100dvh-3.5rem)]"

function SideAction({ label, onClick, children, active }: { label: string; onClick: () => void; children: ReactNode; active?: boolean }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} aria-pressed={active} className="group flex flex-col items-center gap-1 text-white">
      <span className={cn("flex h-11 w-11 items-center justify-center rounded-full backdrop-blur transition", active ? "bg-brand text-white" : "bg-black/45 group-hover:bg-black/60 md:bg-white/10 md:group-hover:bg-white/20")}>
        {children}
      </span>
    </button>
  )
}

function Reel({
  reel, active, near, muted, following, onMuted, onFollow, onComments, onReport, onStarted,
}: {
  reel: VideoCard
  active: boolean
  near: boolean
  muted: boolean
  following: boolean
  onMuted: (m: boolean) => void
  onFollow: (handle: string, on: boolean) => void
  onComments: () => void
  onReport: () => void
  onStarted: () => void
}) {
  const signedIn = useSignedIn()
  const navigate = useNavigate()
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [paused, setPaused] = useState(false)
  const [progressPct, setProgressPct] = useState(0)
  const [captionsOn, setCaptionsOn] = useState(false)
  const [like, setLike] = useState<{ on: boolean; count: number } | null>(null)
  const lastMs = useRef(0)
  const progress = useProgressReporter(near ? reel.id : undefined, reelSource)
  const liked = like ?? { on: reel.liked ?? false, count: reel.likes }
  const gated = Boolean(reel.access && reel.access !== "free")
  const needDetail = gated && reel.locked !== false
  const detail = useQuery({
    queryKey: ["video", reel.id, signedIn],
    enabled: near && needDetail,
    queryFn: () => getJson<VideoDetail>(`/api/video/videos/${reel.id}`),
  })
  const lock = needDetail ? detail.data?.locked ?? null : null
  const [previewOver, setPreviewOver] = useState(false)
  async function onUnlocked() {
    for (let i = 0; i < 6; i++) {
      const r = await detail.refetch()
      if (!r.data?.locked) break
      await new Promise((res) => setTimeout(res, 1200))
    }
    setPreviewOver(false)
  }
  const playback = needDetail ? detail.data?.playback ?? null : reel.playback ?? null
  const captionLang = lock ? null : reel.captions?.available?.[0] ?? null

  const activeRef = useRef(active)
  activeRef.current = active

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    if (!active) {
      setPreviewOver(false)
      v.pause()
      if (v.currentTime > 0.5) v.currentTime = 0
      return
    }
    const go = () => {
      if (activeRef.current) v.play().then(() => setPaused(false)).catch(() => setPaused(true))
    }
    if (v.readyState >= 2) {
      go()
      return
    }
    v.addEventListener("canplay", go, { once: true })
    return () => v.removeEventListener("canplay", go)
  }, [active, near, playback?.type === "hls" ? playback.url : null])

  const onTime = useCallback((ms: number) => {
    const dur = reel.duration_ms || (videoRef.current?.duration ?? 0) * 1000
    if (dur) setProgressPct(Math.min(100, (ms / dur) * 100))
    if (lastMs.current > dur * 0.85 && ms < 1500 && dur > 0) progress.onEnded()
    lastMs.current = ms
    progress.onTime(ms)
  }, [reel.duration_ms, progress])

  function tap() {
    const v = videoRef.current
    if (!v) return
    if (muted) {
      onMuted(false)
      if (v.paused) v.play().catch(() => undefined)
      return
    }
    if (v.paused) v.play().then(() => setPaused(false)).catch(() => undefined)
    else {
      v.pause()
      setPaused(true)
    }
  }

  async function toggleLike() {
    if (!signedIn) {
      navigate(loginPath(`/reels/${reel.id}`))
      return
    }
    const next = { on: !liked.on, count: Math.max(0, liked.count + (liked.on ? -1 : 1)) }
    setLike(next)
    try {
      if (next.on) await api.post(`/api/video/videos/${reel.id}/like`)
      else await api.delete(`/api/video/videos/${reel.id}/like`)
    } catch (err) {
      setLike(liked)
      toast.error(errText(err, "That did not work. Try again."))
    }
  }

  async function share() {
    const url = `${window.location.origin}/reels/${reel.id}`
    try {
      await navigator.clipboard.writeText(url)
      toast.success("Link copied")
    } catch {
      toast.message(url)
    }
  }

  const captions = captionLang
    ? [{ lang: captionLang, label: captionLang.toUpperCase(), src: apiUrl(`/api/video/videos/${reel.id}/captions/${captionLang}.vtt`) }]
    : undefined
  const src = playback?.type === "hls" ? playback.url : null
  const paywallUp = Boolean(lock && detail.data && (previewOver || !src))

  function replay() {
    setPreviewOver(false)
    const v = videoRef.current
    if (v) {
      v.currentTime = 0
      v.play().catch(() => undefined)
    }
  }

  return (
    <section data-reel={reel.id} className={cn("relative flex w-full snap-start snap-always items-center justify-center", HEIGHT)} aria-label={reel.title}>
      <div className="relative h-full w-full overflow-hidden bg-black md:aspect-[9/16] md:h-[calc(100%-2rem)] md:w-auto md:rounded-2xl">
        {near && src ? (
          <HlsPlayer
            key={`${reel.id}-${lock ? "preview" : "full"}`}
            src={src}
            poster={reel.thumbnail ?? undefined}
            controls={false}
            hotkeys={false}
            loop={!lock}
            muted={muted}
            fit="cover"
            captions={captions}
            captionLang={captionsOn ? captionLang : null}
            videoRef={videoRef}
            onTime={onTime}
            onPlay={() => {
              progress.onPlay()
              if (active) onStarted()
            }}
            onPause={progress.onPause}
            onEnded={() => { if (lock) setPreviewOver(true) }}
            className="absolute inset-0 h-full w-full"
          />
        ) : reel.thumbnail ? (
          <img src={reel.thumbnail} alt="" fetchPriority={active ? "high" : "low"} className="absolute inset-0 h-full w-full object-cover" />
        ) : null}

        <button type="button" onClick={tap} aria-label={muted ? "Unmute" : paused ? "Play" : "Pause"} className="absolute inset-0 z-10 cursor-pointer" />

        {active && muted && (
          <button type="button" onClick={tap} className="absolute left-1/2 top-4 z-20 inline-flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/65 px-3.5 py-1.5 text-xs font-semibold text-white backdrop-blur">
            <VolumeX size={14} /> Tap to unmute
          </button>
        )}
        {paused && active && !muted && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/50 text-white"><Pause size={28} /></span>
          </div>
        )}

        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-4 pb-4 pt-16 pr-20 md:pr-4">
          {reel.channel && (
            <div className="pointer-events-auto mb-2 flex items-center gap-2">
              <Link to={`/@${reel.channel.handle}`} className="flex min-w-0 items-center gap-2">
                <ChannelAvatar channel={reel.channel} size={32} />
                <span className="truncate text-sm font-semibold text-white">{reel.channel.name}</span>
              </Link>
              <FollowButton handle={reel.channel.handle} following={following} onChange={(on) => onFollow(reel.channel!.handle, on)} size="sm" />
            </div>
          )}
          <p className="line-clamp-2 text-sm font-medium text-white">{reel.title}</p>
          {reel.ai_generated && <AiBadge className="mt-2" />}
        </div>
        <div className="absolute inset-x-0 bottom-0 z-30 h-0.5 bg-white/20">
          <div className="h-full bg-brand-soft" style={{ width: `${progressPct}%` }} />
        </div>

        <div className="absolute bottom-24 right-2 z-20 flex flex-col items-center gap-4 md:hidden">
          {actions()}
        </div>
        {gated && !lock && !paywallUp && <AccessBadge video={reel} className="pointer-events-none absolute right-3 top-3 z-20" />}
        {lock && !paywallUp && <PreviewBadge lock={lock} className="pointer-events-none absolute left-3 top-3 z-20" />}
        {lock && paywallUp && detail.data && (
          <Suspense fallback={null}>
            <LockedOverlay video={detail.data} lock={lock} onUnlocked={onUnlocked} onReplay={src ? replay : undefined} className="z-40" />
          </Suspense>
        )}
      </div>
      <div className="ml-4 hidden flex-col items-center gap-5 self-end pb-8 md:flex">
        {actions()}
      </div>
    </section>
  )

  function actions() {
    return (
      <>
        <div className="flex flex-col items-center gap-1">
          <SideAction label={liked.on ? "Unlike" : "Like"} onClick={toggleLike} active={liked.on}>
            <Heart size={21} fill={liked.on ? "currentColor" : "none"} />
          </SideAction>
          <span className="text-xs font-semibold text-white">{compactNumber(liked.count)}</span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <SideAction label="Comments" onClick={onComments}><MessageCircle size={21} /></SideAction>
          <span className="text-xs font-semibold text-white">{reel.comments === undefined ? "" : compactNumber(reel.comments)}</span>
        </div>
        <SideAction label="Share" onClick={share}><Share2 size={20} /></SideAction>
        {captionLang && (
          <SideAction label={captionsOn ? "Hide captions" : "Show captions"} onClick={() => setCaptionsOn(!captionsOn)} active={captionsOn}>
            <Captions size={20} />
          </SideAction>
        )}
        <SideAction label={muted ? "Unmute" : "Mute"} onClick={() => onMuted(!muted)}>{muted ? <VolumeX size={20} /> : <Volume2 size={20} />}</SideAction>
        <SideAction label="Report" onClick={onReport}><Flag size={19} /></SideAction>
      </>
    )
  }
}

export default function ReelsPage() {
  useTitle("Reels")
  const { id: routeId } = useParams()
  const [params] = useSearchParams()
  const startId = routeId ?? params.get("start")
  const signedIn = useSignedIn()
  const navigate = useNavigate()
  const feed = useRef<HTMLDivElement>(null)
  const [activeId, setActiveId] = useState<string | null>(startId)
  const [muted, setMuted] = useState(true)
  const [commentsFor, setCommentsFor] = useState<VideoCard | null>(null)
  const [report, setReport] = useState<ReportTarget | null>(null)
  const [follows, setFollows] = useState<Record<string, boolean>>({})
  const scrolledTo = useRef<string | null>(null)

  const q = useInfiniteQuery({
    queryKey: reelsKey(signedIn),
    initialPageParam: 0,
    queryFn: reelsPage,
    getNextPageParam: (last) => (last.rows.length === REELS_PAGE && last.offset + REELS_PAGE < (last.total || Infinity) ? last.offset + REELS_PAGE : undefined),
  })
  const start = useQuery({
    queryKey: ["video", startId, signedIn],
    enabled: Boolean(startId),
    queryFn: () => getJson<VideoDetail>(`/api/video/videos/${startId}`),
  })

  const reels = useMemo(() => {
    const list = q.data?.pages.flatMap((p) => p.rows) ?? []
    const first = start.data && start.data.kind === "reel" && !list.some((r) => r.id === start.data!.id) ? [start.data as VideoCard] : []
    const seen = new Set<string>()
    return [...first, ...list].filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
  }, [q.data, start.data])

  const activeIndex = Math.max(0, reels.findIndex((r) => r.id === activeId))
  const [warmId, setWarmId] = useState<string | null>(null)
  useEffect(() => {
    if (!activeId || warmId === activeId) return
    const t = window.setTimeout(() => setWarmId(activeId), 2500)
    return () => window.clearTimeout(t)
  }, [activeId, warmId])

  useEffect(() => {
    if (!reels.length) return
    if (!activeId || !reels.some((r) => r.id === activeId)) setActiveId(reels[0].id)
  }, [reels, activeId])

  useEffect(() => {
    if (!startId || scrolledTo.current === startId) return
    const el = feed.current?.querySelector<HTMLElement>(`[data-reel="${startId}"]`)
    if (el) {
      el.scrollIntoView({ block: "start" })
      scrolledTo.current = startId
    }
  }, [startId, reels])

  useEffect(() => {
    const root = feed.current
    if (!root) return
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && e.intersectionRatio >= 0.6) {
            const id = (e.target as HTMLElement).dataset.reel
            if (id) setActiveId(id)
          }
        }
      },
      { root, threshold: [0.6] },
    )
    root.querySelectorAll("[data-reel]").forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [reels.length])

  useEffect(() => {
    if (activeIndex >= reels.length - 3 && q.hasNextPage && !q.isFetchingNextPage) q.fetchNextPage()
  }, [activeIndex, reels.length, q])

  useEffect(() => {
    if (!activeId) return
    const path = `/reels/${activeId}`
    if (window.location.pathname !== path) window.history.replaceState(window.history.state, "", path)
  }, [activeId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === "INPUT" || tag === "TEXTAREA" || commentsFor || report) return
      const box = feed.current
      if (!box) return
      if (e.key === "ArrowDown" || e.key === "j") box.scrollBy({ top: box.clientHeight, behavior: "smooth" })
      else if (e.key === "ArrowUp" || e.key === "k") box.scrollBy({ top: -box.clientHeight, behavior: "smooth" })
      else if (e.key === "m") setMuted((m) => !m)
      else return
      e.preventDefault()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [commentsFor, report])

  if (q.isLoading) {
    return (
      <div className={cn("flex items-center justify-center", HEIGHT)}>
        <Skel className="h-full w-full md:aspect-[9/16] md:h-[calc(100%-2rem)] md:w-auto md:rounded-2xl" />
      </div>
    )
  }

  if (!reels.length) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <Empty icon={<Clapperboard size={32} />} title="No reels yet" body="Short vertical videos from creators will show up here." action={<Link to="/" className="text-sm font-semibold text-brand-soft hover:underline">Back to home</Link>} />
      </div>
    )
  }

  return (
    <>
      <div ref={feed} className={cn("snap-feed overflow-y-auto scrollbar-none", HEIGHT)}>
        {reels.map((r, i) => (
          <Reel
            key={r.id}
            reel={r}
            active={i === activeIndex}
            near={i === activeIndex || (warmId === r.id) || (warmId === reels[activeIndex]?.id && i >= activeIndex - 1 && i <= activeIndex + 2)}
            onStarted={() => setWarmId(r.id)}
            muted={muted}
            following={r.channel ? follows[r.channel.handle] ?? r.following ?? false : false}
            onMuted={setMuted}
            onFollow={(handle, on) => setFollows((f) => ({ ...f, [handle]: on }))}
            onComments={() => setCommentsFor(r)}
            onReport={() => (signedIn ? setReport({ type: "video", id: r.id, label: "reel" }) : navigate(loginPath(`/reels/${r.id}`)))}
          />
        ))}
        {q.isFetchingNextPage && <div className="py-6 text-center text-sm text-muted">Loading more…</div>}
      </div>
      <Sheet open={commentsFor !== null} onClose={() => setCommentsFor(null)} title="Comments" wide>
        {commentsFor && (
          <Comments
            videoId={commentsFor.id}
            heading={false}
            onReport={(t) => (signedIn ? setReport(t) : navigate(loginPath(`/reels/${commentsFor.id}`)))}
          />
        )}
      </Sheet>
      <ReportDialog target={report} onClose={() => setReport(null)} />
    </>
  )
}
