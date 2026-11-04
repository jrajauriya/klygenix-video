import { ExternalLink } from "lucide-react"
import { Badge } from "@klygenixvideo/ui"
import { formatMoney } from "@klygenixvideo/client"
import { Row, Status, VIDEO_STATUS, humanise, watchUrl } from "../../lib/shared"
import type { TargetSummary, TargetType } from "../../lib/types"

function WatchLink({ publicId, label }: { publicId: string; label: string }) {
  return (
    <a
      href={watchUrl(publicId)}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline"
    >
      {label} <ExternalLink size={13} />
    </a>
  )
}

export function TargetPreview({ type, id, target }: { type: TargetType; id: number; target: TargetSummary }) {
  if (target.missing) {
    return <p className="text-sm text-slate-500">This {type} no longer exists (#{id}).</p>
  }

  if (type === "video") {
    return (
      <div className="space-y-3">
        {target.thumbnail && (
          <img
            src={target.thumbnail}
            alt=""
            className={`rounded-lg bg-slate-100 object-cover ${target.kind === "reel" ? "h-64 w-36" : "aspect-video w-full"}`}
          />
        )}
        <div>
          <p className="font-semibold text-navy">{target.title}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            {target.channel && <span>@{target.channel}</span>}
            {target.kind && <Badge color="slate">{target.kind === "reel" ? "Reel" : "Long video"}</Badge>}
            <Status map={VIDEO_STATUS} status={target.status} />
          </div>
        </div>
        {target.description && <p className="whitespace-pre-line text-sm text-slate-600">{target.description}</p>}
        {target.public_id && <WatchLink publicId={target.public_id} label="Open the watch page" />}
      </div>
    )
  }

  if (type === "live") {
    return (
      <div className="space-y-3">
        <div>
          <p className="font-semibold text-navy">{target.title || "Untitled stream"}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            {target.channel && <span>@{target.channel}</span>}
            <Badge color="red">Live stream</Badge>
            {target.status && <Badge color={target.status === "live" ? "green" : "slate"}>{humanise(target.status)}</Badge>}
          </div>
        </div>
        {target.public_id && <WatchLink publicId={target.public_id} label="Open the stream" />}
      </div>
    )
  }

  if (type === "live_message") {
    return (
      <div className="space-y-3">
        <blockquote className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800">
          {target.text || "—"}
        </blockquote>
        <dl className="grid grid-cols-2 gap-3">
          <Row label="Author" value={target.author} />
          <Row label="Kind" value={target.paid_minor ? `${humanise(target.kind ?? "chat")} · ${formatMoney(target.paid_minor, "INR")}` : humanise(target.kind ?? "chat")} />
          <Row label="Status" value={target.status ? humanise(target.status) : "—"} />
          <Row label="In stream" value={target.live_title} />
        </dl>
        {target.live && <WatchLink publicId={target.live} label="Open the stream" />}
      </div>
    )
  }

  if (type === "comment" || type === "danmaku") {
    return (
      <div className="space-y-3">
        <blockquote className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800">
          {target.text || "—"}
        </blockquote>
        <dl className="grid grid-cols-2 gap-3">
          <Row label="Kind" value={type === "comment" ? "Comment" : "Danmaku"} />
          <Row label="Status" value={target.status ? humanise(target.status) : "—"} />
          <Row label="On video" value={target.video_title} wide />
        </dl>
        {target.video && <WatchLink publicId={target.video} label="Open the video" />}
      </div>
    )
  }

  return (
    <dl className="grid grid-cols-2 gap-3">
      <Row label="Channel" value={target.name} />
      <Row label="Handle" value={target.handle ? `@${target.handle}` : "—"} />
      <Row label="Strikes" value={String(target.strikes ?? 0)} />
      <Row label="State" value={target.suspended ? <Badge color="red">Suspended</Badge> : <Badge color="green">Active</Badge>} />
    </dl>
  )
}
