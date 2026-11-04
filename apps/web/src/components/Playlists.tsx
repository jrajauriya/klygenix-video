import { useEffect, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { CheckCircle2, ListVideo, Play } from "lucide-react"
import { cn } from "@klygenixvideo/ui"
import { errStatus, getJson, useSignedIn } from "../lib/api"
import { rupees } from "../lib/format"
import type { PlaylistDetail, PlaylistSummary, SeriesProgress } from "../lib/types"
import { Thumb } from "./VideoCards"
import { useT } from "../i18n"

export const playlistWatchUrl = (videoId: string, playlistId: number) => `/watch/${videoId}?list=${playlistId}`

export function usePlaylist(id: number | null) {
  const signedIn = useSignedIn()
  return useQuery({
    queryKey: ["playlist", id, signedIn],
    enabled: id !== null,
    queryFn: () => getJson<PlaylistDetail>(`/api/video/playlists/${id}`),
    retry: (n, err) => errStatus(err) !== 404 && n < 1,
  })
}

export function useSeriesProgress(playlist: PlaylistDetail | undefined) {
  const signedIn = useSignedIn()
  return useQuery({
    queryKey: ["playlist-progress", playlist?.id],
    enabled: signedIn && playlist?.kind === "series",
    queryFn: () => getJson<SeriesProgress>(`/api/video/me/playlists/${playlist!.id}/progress`),
  })
}

const AUTOPLAY_KEY = "kv_web_autoplay"

export function useAutoplay() {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(AUTOPLAY_KEY) !== "0"
    } catch {
      return true
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(AUTOPLAY_KEY, on ? "1" : "0")
    } catch {
      return
    }
  }, [on])
  return [on, setOn] as const
}

export function SeriesBadge({ className }: { className?: string }) {
  const t = useT("watchx")
  return <span className={cn("rounded-md bg-brand px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white", className)}>{t("Series")}</span>
}

export function PlaylistTile({ playlist }: { playlist: PlaylistSummary }) {
  const t = useT("watchx")
  return (
    <article className="group min-w-0">
      <Link to={`/playlist/${playlist.id}`} className="block" aria-label={playlist.title}>
        <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-panel-2">
          {playlist.cover ? (
            <img src={playlist.cover} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-brand/30 to-panel-3 text-white/60"><ListVideo size={28} aria-hidden="true" /></div>
          )}
          <div className="absolute inset-y-0 right-0 flex w-2/5 flex-col items-center justify-center gap-1 bg-black/70 text-white">
            <ListVideo size={20} aria-hidden="true" />
            <span className="text-sm font-semibold tabular-nums">{playlist.video_count}</span>
            <span className="text-[11px] text-white/75">{playlist.video_count === 1 ? t("video") : t("videos")}</span>
          </div>
          {playlist.kind === "series" && <SeriesBadge className="absolute left-1.5 top-1.5" />}
        </div>
      </Link>
      <Link to={`/playlist/${playlist.id}`} className="mt-3 line-clamp-2 text-[15px] font-semibold leading-snug text-ink hover:text-white">{playlist.title}</Link>
      <p className="mt-1 text-[13px] text-muted">{playlist.kind === "series" ? t("Series") : t("Playlist")}{playlist.kind === "series" && playlist.price_minor ? ` · ${rupees(playlist.price_minor)}` : ""} · {t(playlist.video_count === 1 ? "{n} video" : "{n} videos", { n: playlist.video_count })}</p>
    </article>
  )
}

export function PlaylistPanel({
  playlist, currentId, autoplay, onAutoplay, className,
}: {
  playlist: PlaylistDetail
  currentId: string
  autoplay: boolean
  onAutoplay: (on: boolean) => void
  className?: string
}) {
  const t = useT("watchx")
  const progress = useSeriesProgress(playlist)
  const done = new Set((progress.data?.videos ?? []).filter((v) => v.completed).map((v) => v.id))
  const at = playlist.videos.findIndex((v) => v.id === currentId)
  const list = useRef<HTMLOListElement>(null)

  useEffect(() => {
    const box = list.current
    const row = box?.querySelector<HTMLElement>('[aria-current="true"]')
    if (box && row) box.scrollTop = row.offsetTop - box.offsetTop - 8
  }, [currentId, playlist.id])

  return (
    <section aria-label={t("Playlist: {title}", { title: playlist.title })} className={cn("flex max-h-[460px] flex-col overflow-hidden rounded-2xl border border-line bg-panel", className)}>
      <div className="border-b border-line px-3 py-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <Link to={`/playlist/${playlist.id}`} className="flex items-center gap-1.5 font-semibold text-ink hover:underline">
              <span className="truncate">{playlist.title}</span>
              {playlist.kind === "series" && <SeriesBadge className="shrink-0" />}
            </Link>
            <p className="text-xs text-muted">
              {playlist.channel?.name} · {at >= 0 ? `${at + 1} / ${playlist.videos.length}` : t(playlist.videos.length === 1 ? "{n} video" : "{n} videos", { n: playlist.videos.length })}
              {progress.data && <> · {t("{n} watched", { n: progress.data.completed })}</>}
            </p>
          </div>
          <label className="flex shrink-0 cursor-pointer items-center gap-2 text-xs text-muted">
            {t("Autoplay")}
            <button
              type="button"
              role="switch"
              aria-checked={autoplay}
              aria-label={t("Autoplay the next video")}
              onClick={() => onAutoplay(!autoplay)}
              className={cn("relative inline-flex h-5 w-9 items-center rounded-full transition-colors", autoplay ? "bg-brand" : "bg-white/20")}
            >
              <span className={cn("inline-block h-4 w-4 rounded-full bg-white transition-transform", autoplay ? "translate-x-4" : "translate-x-0.5")} />
            </button>
          </label>
        </div>
      </div>
      <ol ref={list} className="relative flex-1 overflow-y-auto py-1">
        {playlist.videos.map((v, i) => {
          const current = v.id === currentId
          return (
            <li key={v.id}>
              <Link
                to={playlistWatchUrl(v.id, playlist.id)}
                aria-current={current ? "true" : undefined}
                className={cn("flex items-center gap-2 px-2 py-1.5 hover:bg-white/[0.06]", current && "bg-white/10")}
              >
                <span className="flex w-5 shrink-0 justify-center text-xs tabular-nums text-muted">
                  {current ? <Play size={12} fill="currentColor" className="text-brand-soft" aria-hidden="true" /> : i + 1}
                </span>
                <Thumb video={v} className="aspect-video w-28 shrink-0" rounded="rounded-md" />
                <div className="min-w-0 flex-1">
                  <p className={cn("line-clamp-2 text-sm leading-snug", current ? "font-semibold text-ink" : "text-ink/90")}>{v.title}</p>
                  {done.has(v.id) && (
                    <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-emerald-400"><CheckCircle2 size={12} aria-hidden="true" /> {t("Watched")}</p>
                  )}
                </div>
              </Link>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
