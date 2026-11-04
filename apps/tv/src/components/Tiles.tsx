import type { ReactNode } from "react"
import { Link } from "react-router-dom"
import { PUBLIC_DOMAIN } from "../lib/api"
import { compactNumber } from "../lib/format"
import { slot, useT, type T } from "../lib/i18n"
import type { LiveStreamCard, VideoCard } from "../lib/types"

export function viewsText(t: T, n: number | null | undefined): string {
  const v = n ?? 0
  return t(v === 1 ? "{n} view" : "{n} views", { n: compactNumber(v) })
}

export function VideoTile({ video, group, src, auto, progress, fill }: { video: VideoCard; group: string; src: string; auto?: boolean; progress?: number; fill?: boolean }) {
  const t = useT()
  const reel = video.kind === "reel"
  const deal = video.paid_partnership?.brand ? t("Paid partnership with {brand}", { brand: video.paid_partnership.brand }) : null
  return (
    <Link
      to={`/watch/${video.id}?src=${src}`}
      data-focus-id={`${group}:${video.id}`}
      data-autofocus={auto || undefined}
      className={`block shrink-0 rounded-2xl p-2 ${fill ? "w-full" : reel ? "w-[14rem]" : "w-[24rem]"}`}
    >
      <div className={`relative overflow-hidden rounded-xl bg-panel-2 ${reel ? "aspect-[9/16]" : "aspect-video"}`}>
        {video.thumbnail && <img src={video.thumbnail} alt="" loading="lazy" className="h-full w-full object-cover" />}
        {video.new && <span className="absolute left-2 top-2 rounded-md bg-brand px-3 py-0.5 text-lg font-extrabold text-white">{t("New")}</span>}
        <span className="absolute bottom-2 right-2 rounded-md bg-black/85 px-2 py-0.5 text-lg font-semibold text-white">{video.duration}</span>
        {progress !== undefined && progress > 0 && (
          <span className="absolute inset-x-0 bottom-0 h-1.5 bg-white/30">
            <span className="block h-full bg-brand-soft" style={{ width: `${Math.min(100, progress * 100)}%` }} />
          </span>
        )}
      </div>
      <p className="mt-3 line-clamp-2 text-2xl font-semibold leading-tight">{video.title}</p>
      <p className="mt-1 truncate text-lg text-muted">
        {video.channel?.name ?? ""} · {viewsText(t, video.views)}
        {video.access && video.access !== "free" ? ` · ${t(video.access === "members" ? "Members" : "Paid")}` : ""}
      </p>
      {deal && <p className="mt-1 inline-block max-w-full truncate rounded-md bg-panel-3 px-2 py-0.5 text-base font-semibold text-ink">{deal}</p>}
    </Link>
  )
}

export function LiveTile({ stream, group, auto }: { stream: LiveStreamCard; group: string; auto?: boolean }) {
  const t = useT()
  return (
    <Link
      to={`/live/${stream.id}`}
      data-focus-id={`${group}:${stream.id}`}
      data-autofocus={auto || undefined}
      className="block w-[24rem] shrink-0 rounded-2xl p-2"
    >
      <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-brand/60 to-panel-3">
        <span className="absolute left-3 top-3 rounded-md bg-live px-3 py-1 text-lg font-extrabold text-white">
          {stream.status === "live" ? t("LIVE") : t("SOON")}
        </span>
        <span className="px-6 text-center text-3xl font-bold text-white">{stream.channel?.name ?? t("Live")}</span>
      </div>
      <p className="mt-3 line-clamp-2 text-2xl font-semibold leading-tight">{stream.title}</p>
      <p className="mt-1 truncate text-lg text-muted">{stream.status === "live" ? t("{n} watching", { n: stream.viewers }) : t("Scheduled")}</p>
    </Link>
  )
}

export function Row({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`row-${id}`} data-focus-group className="mt-8">
      <h2 id={`row-${id}`} className="safe-x text-3xl font-bold">
        {title}
      </h2>
      <div className="scrollbar-none mt-3 flex gap-6 overflow-x-auto scroll-px-[6rem] px-[5.5rem] py-4">{children}</div>
    </section>
  )
}

export function Grid({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ul aria-label={label} className="grid grid-cols-4 gap-6" data-focus-group>
      {children}
    </ul>
  )
}

export function Phone({ what }: { what: string }) {
  const t = useT()
  return (
    <p className="rounded-2xl bg-panel-2 px-6 py-4 text-2xl leading-snug text-ink">
      {what} {slot(t("Open {site} on your phone."), "site", <strong className="text-brand-soft">{PUBLIC_DOMAIN}</strong>)}
    </p>
  )
}

export function Status({ children }: { children: ReactNode }) {
  return <p className="safe-x py-10 text-3xl text-muted" role="status">{children}</p>
}
