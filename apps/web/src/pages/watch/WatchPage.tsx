import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { ExternalLink, Flag, Heart, PartyPopper, Share2, ShieldCheck } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { cn } from "@klygenixvideo/ui"
import {
  BilibiliEmbed, DanmakuLayer, DanmakuRail, HlsPlayer, YouTubeEmbed, useDanmaku,
  type CaptionTrack, type EmbedController,
} from "@klygenixvideo/player"
import { STUDIO_URL, apiUrl, errStatus, errText, getJson, loginPath, useSignedIn } from "../../lib/api"
import { clock, compactNumber, langName, longDate, timeAgo, views } from "../../lib/format"
import { useDanmakuPrefs, useMediaQuery } from "../../lib/prefs"
import { useProgressReporter } from "../../lib/progress"
import { useTitle } from "../../lib/title"
import type { VideoCard, VideoDetail } from "../../lib/types"
import { AiBadge, Btn, ChannelAvatar, ChannelName, Skel } from "../../components/bits"
import { Comments } from "../../components/Comments"
import { FollowButton } from "../../components/FollowButton"
import { PlaylistPanel, playlistWatchUrl, useAutoplay, usePlaylist } from "../../components/Playlists"
import { ReportDialog, type ReportTarget } from "../../components/ReportDialog"
import { VideoRowCard } from "../../components/VideoCards"
import NotFound from "../NotFound"
import { AiPanel } from "./AiPanel"
import { DanmakuBar } from "./DanmakuBar"
import { GuestStrip, PartyPanel, partyLink, useParty, usePartySync, type PartyState } from "./Party"

function Description({ video }: { video: VideoDetail }) {
  const [open, setOpen] = useState(false)
  const long = (video.description ?? "").length > 220 || (video.description ?? "").split("\n").length > 3
  return (
    <div className="rounded-2xl bg-panel p-3 text-sm sm:p-4">
      <p className="font-semibold text-ink">
        {views(video.views)} <span className="text-muted">·</span> {timeAgo(video.published_at)}
        <span className="ml-2 font-normal text-faint">{longDate(video.published_at)}</span>
      </p>
      {video.description ? (
        <p className={cn("mt-2 whitespace-pre-wrap break-words leading-relaxed text-ink/85", !open && long && "line-clamp-3")}>{video.description}</p>
      ) : (
        <p className="mt-2 text-muted">No description.</p>
      )}
      {video.tags?.length > 0 && (open || !long) && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {video.tags.map((t) => (
            <Link key={t} to={`/search?q=${encodeURIComponent(t)}`} className="rounded-full bg-white/[0.07] px-2.5 py-0.5 text-xs text-brand-soft hover:bg-white/15">#{t}</Link>
          ))}
        </div>
      )}
      {long && (
        <button type="button" onClick={() => setOpen(!open)} className="mt-2 text-sm font-semibold text-ink hover:underline">
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  )
}

function UpNext({ currentId }: { currentId: string }) {
  const signedIn = useSignedIn()
  const q = useQuery({
    queryKey: ["related", currentId, signedIn],
    queryFn: () => getJson<VideoCard[]>(`/api/video/videos/${currentId}/related`, { limit: 20 }),
  })
  const list = (q.data ?? []).filter((v) => v.id !== currentId)
  return (
    <section aria-label="Up next">
      <h2 className="mb-3 text-base font-bold">Up next</h2>
      {q.isLoading ? (
        <div className="space-y-3">{Array.from({ length: 4 }, (_, i) => <Skel key={i} className="h-24 w-full" />)}</div>
      ) : list.length === 0 ? (
        <p className="text-sm text-muted">Nothing else to watch yet.</p>
      ) : (
        <div className="space-y-3">{list.map((v) => <VideoRowCard key={v.id} video={v} compact />)}</div>
      )}
    </section>
  )
}

function WatchSkeleton() {
  return (
    <div className="mx-auto max-w-[1700px] px-0 sm:px-6 sm:py-6">
      <Skel className="aspect-video w-full rounded-none sm:rounded-2xl" />
      <div className="space-y-3 px-3 py-4 sm:px-0">
        <Skel className="h-6 w-2/3" />
        <Skel className="h-10 w-1/2" />
        <Skel className="h-24 w-full" />
      </div>
    </div>
  )
}

export default function WatchPage() {
  const { id = "" } = useParams()
  const [params, setParams] = useSearchParams()
  const signedIn = useSignedIn()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const desktop = useMediaQuery("(min-width: 1024px)")
  const tParam = params.get("t")
  const listParam = params.get("list")
  const listId = listParam && /^\d+$/.test(listParam) ? Number(listParam) : null
  const playlist = usePlaylist(listId).data
  const [autoplay, setAutoplay] = useAutoplay()
  const partyCode = (params.get("party") ?? "").trim().toUpperCase() || null
  const q = useQuery({
    queryKey: ["video", id, signedIn],
    queryFn: () => getJson<VideoDetail>(`/api/video/videos/${id}`),
    retry: (count, err) => errStatus(err) !== 404 && count < 1,
  })
  const video = q.data
  useTitle(video?.title)

  const [currentMs, setCurrentMs] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [prefs, setPrefs] = useDanmakuPrefs()
  const [report, setReport] = useState<ReportTarget | null>(null)
  const [liked, setLiked] = useState<{ id: string; on: boolean; count: number } | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const embedRef = useRef<EmbedController | null>(null)
  const playerBox = useRef<HTMLDivElement>(null)
  const progress = useProgressReporter(video?.id)
  const applyParty = useRef<(s: PartyState) => void>(() => undefined)
  const party = useParty(partyCode, signedIn && video?.playback?.type === "hls", (s) => applyParty.current(s))
  const partySync = usePartySync(party, videoRef, `${video?.id ?? ""}-${video?.playback?.type ?? ""}`)
  applyParty.current = partySync.apply
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    if (party?.info && party.info.video_id !== id) navigate(`/watch/${party.info.video_id}?party=${party.info.code}`, { replace: true })
  }, [party?.info, id, navigate])
  const nextInList = useMemo(() => {
    if (!playlist || !video) return null
    const at = playlist.videos.findIndex((v) => v.id === video.id)
    return at >= 0 ? playlist.videos[at + 1] ?? null : null
  }, [playlist, video?.id])

  const onEnded = useCallback(() => {
    progress.onEnded()
    if (playlist?.kind === "series") window.setTimeout(() => qc.invalidateQueries({ queryKey: ["playlist-progress", playlist.id] }), 800)
    if (playlist && nextInList && autoplay && !partyCode) {
      toast.message(`Up next: ${nextInList.title}`)
      navigate(playlistWatchUrl(nextInList.id, playlist.id))
    }
  }, [progress, playlist, nextInList, autoplay, partyCode, navigate, qc])

  const playback = video?.playback ?? null
  const hosted = playback?.type === "hls"
  const bilibili = playback?.type === "bilibili"
  const danmaku = useDanmaku(video ? video.id : null, currentMs, { api, enabled: Boolean(video), all: bilibili })

  const startMs = useMemo(() => {
    if (tParam !== null && /^\d+$/.test(tParam)) return Number(tParam)
    if (video?.resume_ms && video.resume_ms > 5000) return video.resume_ms
    return undefined
  }, [tParam, video?.id])

  const captions = useMemo<CaptionTrack[]>(() => {
    if (!video) return []
    const own = video.captions?.available ?? []
    const auto = (video.captions?.translatable ?? []).filter((l) => !own.includes(l))
    const src = (l: string) => apiUrl(`/api/video/videos/${video.id}/captions/${l}.vtt`)
    return [
      ...own.map((l) => ({ lang: l, label: langName(l), src: src(l) })),
      ...auto.map((l) => ({ lang: l, label: `${langName(l)} (auto-translated)`, src: src(l) })),
    ]
  }, [video?.id, video?.captions])

  const onTime = useCallback((ms: number) => {
    setCurrentMs(ms)
    progress.onTime(ms)
  }, [progress])

  const seek = useCallback((ms: number) => {
    if (hosted && videoRef.current) {
      videoRef.current.currentTime = ms / 1000
      videoRef.current.play().catch(() => undefined)
    } else if (embedRef.current) {
      embedRef.current.seek(ms)
      embedRef.current.play()
    }
    setCurrentMs(ms)
    const box = playerBox.current
    if (box) {
      const rect = box.getBoundingClientRect()
      if (rect.bottom < 60 || rect.top > window.innerHeight) box.scrollIntoView({ behavior: "smooth", block: "start" })
    }
  }, [hosted])

  if (q.isLoading) return <WatchSkeleton />
  if (q.isError || !video) {
    if (errStatus(q.error) === 404 || !video) return <NotFound what="video" />
    return <div className="p-10 text-center text-sm text-muted">{errText(q.error, "This video did not load.")}</div>
  }

  const like = liked && liked.id === video.id ? liked : { id: video.id, on: video.liked, count: video.likes }

  async function toggleLike() {
    if (!signedIn) {
      navigate(loginPath())
      return
    }
    const next = { id: video!.id, on: !like.on, count: Math.max(0, like.count + (like.on ? -1 : 1)) }
    setLiked(next)
    try {
      if (next.on) await api.post(`/api/video/videos/${video!.id}/like`)
      else await api.delete(`/api/video/videos/${video!.id}/like`)
    } catch (err) {
      setLiked(like)
      toast.error(errText(err, "That did not work. Try again."))
    }
  }

  async function share() {
    const at = currentMs > 5000 ? Math.round(currentMs) : 0
    const url = `${window.location.origin}/watch/${video!.id}${at ? `?t=${at}` : ""}`
    if (navigator.share && window.matchMedia("(pointer: coarse)").matches) {
      navigator.share({ title: video!.title, url }).catch(() => undefined)
      return
    }
    try {
      await navigator.clipboard.writeText(url)
      toast.success(at ? `Link copied. It starts at ${clock(at)}.` : "Link copied")
    } catch {
      toast.message(url)
    }
  }

  async function watchTogether() {
    setStarting(true)
    try {
      const { data } = await api.post<{ code: string }>("/api/video/parties", { video_id: video!.id })
      const v = videoRef.current
      if (v) await api.post(`/api/video/parties/${data.code}/state`, { playing: !v.paused, position_ms: Math.round(v.currentTime * 1000) })
      const next = new URLSearchParams(params)
      next.set("party", data.code)
      setParams(next, { replace: true })
      try {
        await navigator.clipboard.writeText(partyLink(video!.id, data.code))
        toast.success(`Party ${data.code} started. The link is copied.`)
      } catch {
        toast.success(`Party ${data.code} started`)
      }
    } catch (err) {
      toast.error(errText(err, "The watch party could not start."))
    } finally {
      setStarting(false)
    }
  }

  function leaveParty() {
    const next = new URLSearchParams(params)
    next.delete("party")
    setParams(next, { replace: true })
  }

  function requireSignIn(action: () => void) {
    if (!signedIn) navigate(loginPath())
    else action()
  }

  const embedPlayback = playback && playback.type !== "hls" ? playback : null
  const rail = embedPlayback && (
    <div className="flex h-56 flex-col overflow-hidden rounded-2xl border border-line bg-panel lg:h-[340px]">
      <div className="flex items-center justify-between border-b border-line px-3 py-2 text-xs font-semibold text-muted">
        <span>Danmaku</span>
        {bilibili ? <span className="font-normal text-faint">Not synced to playback</span> : danmaku.watchers > 0 && <span className="font-normal">{danmaku.watchers} watching</span>}
      </div>
      <DanmakuRail className="flex-1" items={danmaku.items} currentMs={bilibili ? null : currentMs} blocked={prefs.blocked} onSeek={bilibili ? undefined : seek} />
    </div>
  )
  const partyPanel = partyCode && (
    <PartyPanel party={party} videoId={video.id} signedIn={signedIn} hosted={hosted} onLeave={leaveParty} />
  )
  const listPanel = playlist && playlist.videos.length > 0 && (
    <PlaylistPanel playlist={playlist} currentId={video.id} autoplay={autoplay} onAutoplay={setAutoplay} />
  )
  const aiPanel = <AiPanel video={video} currentMs={currentMs} onSeek={seek} className="h-[480px] lg:h-[520px]" />

  return (
    <div className="mx-auto max-w-[1700px] sm:px-6 sm:py-6">
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-6">
        <div className="min-w-0">
          <div ref={playerBox} className="sticky top-14 z-30 bg-black sm:static sm:rounded-t-2xl">
            {hosted && playback?.type === "hls" ? (
              <HlsPlayer
                key={video.id}
                src={playback.url}
                poster={video.thumbnail ?? undefined}
                startMs={partyCode ? undefined : startMs}
                autoPlay={!partyCode}
                captions={captions}
                chapters={video.insight?.chapters}
                videoRef={videoRef}
                onTime={onTime}
                onPlay={() => { setPlaying(true); progress.onPlay() }}
                onPause={() => { setPlaying(false); progress.onPause() }}
                onEnded={onEnded}
                onDanmakuToggle={() => setPrefs({ enabled: !prefs.enabled })}
                className="aspect-video w-full sm:rounded-t-2xl"
              >
                <DanmakuLayer
                  items={danmaku.items}
                  currentMs={currentMs}
                  playing={playing}
                  enabled={prefs.enabled}
                  density={prefs.density}
                  opacity={prefs.opacity}
                  blocked={prefs.blocked}
                />
              </HlsPlayer>
            ) : playback?.type === "youtube" ? (
              <YouTubeEmbed
                key={video.id}
                videoId={playback.video_id}
                startMs={startMs}
                controllerRef={embedRef}
                onTime={onTime}
                onPlayingChange={(p) => { setPlaying(p); if (p) progress.onPlay(); else progress.onPause() }}
                onEnded={onEnded}
                title={video.title}
                className="aspect-video w-full sm:rounded-t-2xl"
              />
            ) : playback?.type === "bilibili" ? (
              <BilibiliEmbed key={video.id} src={playback.url} title={video.title} className="aspect-video w-full sm:rounded-t-2xl" />
            ) : (
              <div className="flex aspect-video w-full items-center justify-center bg-panel-2 text-sm text-muted sm:rounded-t-2xl">This video is not ready to play yet.</div>
            )}
          </div>
          <GuestStrip party={party} blocked={partySync.blocked} onJoin={partySync.join} />
          <DanmakuBar
            prefs={prefs}
            onPrefs={setPrefs}
            watchers={danmaku.watchers}
            onPost={(text, mode, color) => danmaku.post(text, mode, color)}
            disabledReason={bilibili ? "Bilibili does not share its playback time, so new danmaku can't be placed on this video." : undefined}
          />

          {embedPlayback && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 pt-3 text-xs text-muted sm:px-0">
              <span>Playing from {embedPlayback.credit}.</span>
              <a href={embedPlayback.source_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-brand-soft hover:underline">
                Watch on {embedPlayback.credit} <ExternalLink size={12} />
              </a>
              {video.embed?.owner_verified && (
                <span className="inline-flex items-center gap-1 text-faint"><ShieldCheck size={13} /> Shared by the channel that owns it</span>
              )}
            </div>
          )}

          <div className="space-y-4 px-3 pt-4 sm:px-0">
            {!desktop && rail}
            <div>
              <h1 className="text-lg font-bold leading-snug sm:text-xl">{video.title}</h1>
              {video.ai_generated && <AiBadge className="mt-2" />}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {video.channel && (
                <div className="flex min-w-0 items-center gap-3">
                  <Link to={`/@${video.channel.handle}`} aria-label={video.channel.name}><ChannelAvatar channel={video.channel} size={40} /></Link>
                  <div className="min-w-0">
                    <ChannelName channel={video.channel} className="font-semibold text-ink" />
                    <p className="text-xs text-muted">{compactNumber(video.channel.followers)} {video.channel.followers === 1 ? "follower" : "followers"}</p>
                  </div>
                  {video.is_owner ? (
                    <a href={STUDIO_URL} className="ml-1 inline-flex h-9 items-center rounded-full bg-white/10 px-4 text-sm font-semibold hover:bg-white/15">Edit in Studio</a>
                  ) : (
                    <FollowButton
                      handle={video.channel.handle}
                      following={video.following}
                      onChange={() => qc.invalidateQueries({ queryKey: ["video", id] })}
                      className="ml-1"
                    />
                  )}
                </div>
              )}
              <div className="flex w-full items-center gap-2 overflow-x-auto scrollbar-none sm:w-auto sm:flex-1 sm:justify-end">
                <Btn tone={like.on ? "brand" : "soft"} onClick={toggleLike} aria-pressed={like.on} aria-label={`${like.on ? "Unlike" : "Like"}, ${compactNumber(like.count)}`}>
                  <Heart size={16} fill={like.on ? "currentColor" : "none"} aria-hidden="true" />
                  {compactNumber(like.count)}
                </Btn>
                <Btn tone="soft" onClick={share}><Share2 size={16} aria-hidden="true" /> Share</Btn>
                {signedIn && hosted && !partyCode && (
                  <Btn tone="soft" onClick={watchTogether} disabled={starting}>
                    <PartyPopper size={16} aria-hidden="true" /> {starting ? "Starting…" : "Watch together"}
                  </Btn>
                )}
                <Btn tone="soft" onClick={() => requireSignIn(() => setReport({ type: "video", id: video.id, label: "video" }))} aria-label="Report video">
                  <Flag size={16} aria-hidden="true" /> <span className="hidden sm:inline">Report</span>
                </Btn>
              </div>
            </div>

            {!desktop && partyPanel}
            {!desktop && listPanel}
            {!desktop && aiPanel}
            <Description video={video} />
            <div className="pt-2">
              <Comments videoId={video.id} count={video.comments} onReport={(t) => requireSignIn(() => setReport(t))} />
            </div>
            {!desktop && <div className="pt-4"><UpNext currentId={video.id} /></div>}
          </div>
        </div>

        {desktop && (
          <aside className="min-w-0 space-y-5">
            {partyPanel}
            {listPanel}
            {rail}
            {aiPanel}
            <UpNext currentId={video.id} />
          </aside>
        )}
      </div>
      <ReportDialog target={report} onClose={() => setReport(null)} />
    </div>
  )
}
