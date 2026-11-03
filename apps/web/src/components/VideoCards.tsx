import { useState } from "react"
import { Link } from "react-router-dom"
import { Clapperboard, Crown, Lock, Play } from "lucide-react"
import { cn } from "@klygenixvideo/ui"
import type { VideoCard } from "../lib/types"
import { compactNumber, rupees, timeAgo, views } from "../lib/format"
import { AiBadge, ChannelAvatar, ChannelName } from "./bits"

export function AccessBadge({ video, className }: { video: Pick<VideoCard, "access" | "price_minor">; className?: string }) {
  if (!video.access || video.access === "free") return null
  const members = video.access === "members"
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-bold", members ? "bg-[#FACC15] text-black" : "bg-snow text-black", className)}>
      {members ? <Crown size={11} aria-hidden="true" /> : <Lock size={11} aria-hidden="true" />}
      {members ? "Members" : video.price_minor ? rupees(video.price_minor) : "Paid"}
    </span>
  )
}

export function Thumb({ video, className, progress, rounded = "rounded-xl", priority = false }: { video: VideoCard; className?: string; progress?: number; rounded?: string; priority?: boolean }) {
  const [broken, setBroken] = useState<string | null>(null)
  return (
    <div className={cn("relative overflow-hidden bg-panel-2", rounded, className)}>
      {video.thumbnail && broken !== video.thumbnail ? (
        <img src={video.thumbnail} alt="" loading={priority ? "eager" : "lazy"} fetchPriority={priority ? "high" : "auto"} decoding="async" onError={() => setBroken(video.thumbnail)} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-brand/30 to-panel-3 text-white/60">
          <Clapperboard size={28} aria-hidden="true" />
        </div>
      )}
      {video.duration && (
        <span className="absolute bottom-1.5 right-1.5 rounded-md bg-black/80 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-white">
          {video.duration}
        </span>
      )}
      {video.embed_platform && (
        <span className="absolute left-1.5 top-1.5 rounded-md bg-black/75 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/90">
          {video.embed_platform}
        </span>
      )}
      <AccessBadge video={video} className="absolute right-1.5 top-1.5" />
      {progress !== undefined && progress > 0 && (
        <div className="absolute inset-x-0 bottom-0 h-1 bg-white/25">
          <div className="h-full bg-brand" style={{ width: `${Math.min(100, progress * 100)}%` }} />
        </div>
      )}
    </div>
  )
}

export function VideoGridCard({ video, to, progress, priority }: { video: VideoCard; to?: string; progress?: number; priority?: boolean }) {
  const href = to ?? `/watch/${video.id}`
  return (
    <article className="group min-w-0">
      <Link to={href} className="block" aria-hidden="true" tabIndex={-1}>
        <Thumb video={video} className="aspect-video w-full" progress={progress} priority={priority} />
      </Link>
      <div className="mt-3 flex gap-3">
        {video.channel && (
          <Link to={`/@${video.channel.handle}`} className="shrink-0" aria-label={video.channel.name}>
            <ChannelAvatar channel={video.channel} size={36} />
          </Link>
        )}
        <div className="min-w-0 flex-1">
          <Link to={href} className="line-clamp-2 text-[15px] font-semibold leading-snug text-ink hover:text-white">
            {video.title}
          </Link>
          <div className="mt-1 text-[13px] text-muted">
            <ChannelName channel={video.channel} />
          </div>
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] text-muted">
            <span>{views(video.views)}</span>
            {video.published_at && <span aria-hidden="true">·</span>}
            {video.published_at && <span>{timeAgo(video.published_at)}</span>}
            {video.ai_generated && <AiBadge className="ml-0.5" />}
          </div>
        </div>
      </div>
    </article>
  )
}

export function VideoRowCard({ video, to, snippet, compact = false }: { video: VideoCard; to?: string; snippet?: React.ReactNode; compact?: boolean }) {
  const href = to ?? `/watch/${video.id}`
  return (
    <article className="group flex min-w-0 gap-3">
      <Link to={href} className={cn("shrink-0", compact ? "w-40" : "w-44 sm:w-72")} aria-hidden="true" tabIndex={-1}>
        <Thumb video={video} className="aspect-video w-full" rounded={compact ? "rounded-lg" : "rounded-xl"} />
      </Link>
      <div className="min-w-0 flex-1 py-0.5">
        <Link to={href} className={cn("line-clamp-2 font-semibold leading-snug text-ink hover:text-white", compact ? "text-sm" : "text-[15px] sm:text-base")}>
          {video.title}
        </Link>
        <div className={cn("mt-1 flex flex-wrap items-center gap-x-1.5 text-muted", compact ? "text-xs" : "text-[13px]")}>
          <ChannelName channel={video.channel} />
          <span aria-hidden="true">·</span>
          <span>{views(video.views)}</span>
          {!compact && video.published_at && <span aria-hidden="true">·</span>}
          {!compact && video.published_at && <span>{timeAgo(video.published_at)}</span>}
        </div>
        {video.ai_generated && <AiBadge className="mt-1.5" />}
        {snippet && <div className="mt-2">{snippet}</div>}
      </div>
    </article>
  )
}

export function ReelTile({ video }: { video: VideoCard }) {
  return (
    <Link to={`/reels?start=${video.id}`} className="group relative block w-36 shrink-0 snap-start sm:w-44">
      <div className="relative aspect-[9/16] overflow-hidden rounded-xl bg-panel-2">
        {video.thumbnail && <img src={video.thumbnail} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]" />}
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-transparent" />
        <div className="absolute inset-x-2 bottom-2">
          <p className="line-clamp-2 text-[13px] font-semibold leading-snug text-white">{video.title}</p>
          <p className="mt-1 flex items-center gap-1 text-[11px] text-white/75">
            <Play size={11} fill="currentColor" aria-hidden="true" />
            {compactNumber(video.views)}
          </p>
        </div>
        {video.ai_generated && <AiBadge className="absolute left-2 top-2" />}
        <AccessBadge video={video} className="absolute right-2 top-2" />
      </div>
    </Link>
  )
}
