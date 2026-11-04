import { Info } from "lucide-react"
import { Badge, StatusPill } from "@klygenixvideo/ui"
import type { ClipStatus, StudioVideo, VideoStatus, Visibility } from "../lib/types"
import { useT } from "../i18n"

export const VIDEO_STATUS: Record<VideoStatus, { label: string; hex: string }> = {
  uploading: { label: "Uploading", hex: "#475569" },
  processing: { label: "Encoding", hex: "#1d4ed8" },
  scanning: { label: "Safety check", hex: "#6d28d9" },
  in_review: { label: "In review", hex: "#92400e" },
  published: { label: "Published", hex: "#166534" },
  blocked: { label: "Blocked", hex: "#b91c1c" },
  failed: { label: "Failed", hex: "#b91c1c" },
}

export const STATUS_OPTIONS = [
  { value: "all", label: "Any status" },
  ...Object.entries(VIDEO_STATUS).map(([value, s]) => ({ value, label: s.label })),
]

export function VideoStatusPill({ video }: { video: Pick<StudioVideo, "status" | "status_note"> }) {
  const t = useT()
  const s = VIDEO_STATUS[video.status] ?? { label: video.status, hex: "#475569" }
  return (
    <span className="inline-flex items-center gap-1" title={video.status_note ?? undefined}>
      <StatusPill label={t(s.label)} hex={s.hex} />
      {video.status_note && <Info size={13} className="text-slate-400" aria-label={video.status_note} />}
    </span>
  )
}

const VISIBILITY: Record<Visibility, { label: string; color: "green" | "slate" | "amber" | "blue" }> = {
  public: { label: "Public", color: "green" },
  unlisted: { label: "Unlisted", color: "blue" },
  private: { label: "Private", color: "slate" },
  scheduled: { label: "Scheduled", color: "amber" },
}

export function VisibilityBadge({ value }: { value: Visibility }) {
  const t = useT()
  const v = VISIBILITY[value] ?? { label: value, color: "slate" as const }
  return <Badge color={v.color}>{t(v.label)}</Badge>
}

const CLIP_STATUS: Record<string, { label: string; hex: string }> = {
  draft: { label: "Draft", hex: "#475569" },
  queued: { label: "Queued", hex: "#1d4ed8" },
  rendering: { label: "Rendering", hex: "#6d28d9" },
  rendered: { label: "Ready", hex: "#166534" },
  failed: { label: "Failed", hex: "#b91c1c" },
  published: { label: "Published as reel", hex: "#a21caf" },
  processing: { label: "Publishing", hex: "#1d4ed8" },
}

export function ClipStatusPill({ status }: { status: ClipStatus }) {
  const t = useT()
  const s = CLIP_STATUS[status] ?? { label: status, hex: "#475569" }
  return <StatusPill label={t(s.label)} hex={s.hex} />
}

const AI_STATUS: Record<string, string> = {
  pending: "AI waiting",
  queued: "AI queued",
  running: "AI working",
  transcribing: "Transcribing",
  analysing: "Analysing",
  ready: "AI ready",
  failed: "AI failed",
  no_captions: "Needs captions",
  skipped: "AI skipped",
  quota: "AI minutes used up",
}

export function AiStatusBadge({ value }: { value: string | null }) {
  const t = useT()
  if (!value) return null
  const color = value === "ready" ? "green" : value === "failed" ? "red" : value === "no_captions" ? "amber" : "purple"
  return <Badge color={color}>{AI_STATUS[value] ? t(AI_STATUS[value]) : value.replace(/_/g, " ")}</Badge>
}

export function KindBadge({ kind }: { kind: "long" | "reel" }) {
  const t = useT()
  return <Badge color={kind === "reel" ? "purple" : "slate"}>{kind === "reel" ? t("Reel") : t("Long")}</Badge>
}
