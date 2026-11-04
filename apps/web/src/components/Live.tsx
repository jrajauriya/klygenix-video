import { Link } from "react-router-dom"
import { CalendarClock, Lock, Radio } from "lucide-react"
import { cn } from "@klygenixvideo/ui"
import { compactNumber, hue, longDate } from "../lib/format"
import { useChannelLive, useLiveNow } from "../lib/live"
import type { LiveStreamCard } from "../lib/types"
import { ChannelAvatar } from "./bits"
import { tr, useT } from "../i18n"
import { Shelf } from "./Shelf"

export function LiveBadge({ className, label }: { className?: string; label?: string }) {
  const t = useT("live")
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md bg-[#dc2626] px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white", className)}>
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
      {label ?? t("Live")}
    </span>
  )
}

export function watching(n: number | null | undefined): string {
  return tr("{n} watching", { n: compactNumber(n ?? 0) })
}

export function LiveCard({ stream }: { stream: LiveStreamCard }) {
  const h = hue(stream.channel?.handle ?? stream.id)
  const t = useT("live")
  return (
    <Link to={`/live/${stream.id}`} className="group w-64 shrink-0 snap-start sm:w-72">
      <span
        className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-xl ring-1 ring-white/5 transition group-hover:ring-[#dc2626]/70"
        style={{ background: `radial-gradient(circle at 50% 40%, hsl(${h} 55% 28%), #0b0b12 75%)` }}
      >
        <ChannelAvatar channel={stream.channel} size={64} className="ring-2 ring-[#dc2626] ring-offset-2 ring-offset-black" />
        <LiveBadge className="absolute left-2 top-2" />
        {stream.members_rank ? (
          <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md bg-black/80 px-1.5 py-0.5 text-[11px] font-semibold text-white">
            <Lock size={11} aria-hidden="true" /> {t("Members")}
          </span>
        ) : null}
        <span className="absolute bottom-2 left-2 rounded-md bg-black/80 px-1.5 py-0.5 text-[11px] font-semibold text-white">{watching(stream.viewers)}</span>
      </span>
      <span className="mt-2 line-clamp-2 block text-sm font-semibold leading-snug">{stream.title}</span>
      <span className="mt-0.5 block truncate text-xs text-muted">{stream.channel?.name}</span>
    </Link>
  )
}

export function LiveNowShelf() {
  const live = useLiveNow()
  const t = useT("live")
  const rows = live.data ?? []
  if (!rows.length) return null
  return (
    <Shelf title={t("Live now")} icon={<Radio size={18} className="text-[#f87171]" aria-hidden="true" />}>
      {rows.map((s) => <LiveCard key={s.id} stream={s} />)}
    </Shelf>
  )
}

export function useChannelLiveNow(handle: string | null | undefined, enabled = true) {
  const q = useChannelLive(handle, enabled)
  const rows = q.data ?? []
  return { live: rows.find((s) => s.status === "live") ?? null, upcoming: rows.find((s) => s.status === "scheduled") ?? null }
}

export function ChannelLiveLink({ live, upcoming }: { live: LiveStreamCard | null; upcoming: LiveStreamCard | null }) {
  const t = useT("live")
  if (live) {
    return (
      <Link
        to={`/live/${live.id}`}
        className="inline-flex h-9 items-center gap-2 rounded-full bg-[#dc2626] px-4 text-sm font-bold text-white hover:bg-[#b91c1c]"
      >
        <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
        {t("LIVE now")}
        <span className="font-medium text-white/90">· {watching(live.viewers)}</span>
      </Link>
    )
  }
  if (upcoming) {
    return (
      <Link to={`/live/${upcoming.id}`} className="inline-flex h-9 items-center gap-2 rounded-full bg-white/10 px-4 text-sm font-semibold text-ink hover:bg-white/15">
        <CalendarClock size={15} aria-hidden="true" />
        {t("Upcoming live")}{upcoming.scheduled_at ? ` · ${longDate(upcoming.scheduled_at)}` : ""}
      </Link>
    )
  }
  return null
}
