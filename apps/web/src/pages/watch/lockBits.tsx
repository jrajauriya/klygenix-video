import { Lock } from "lucide-react"
import { cn } from "@klygenixvideo/ui"
import type { VideoLock } from "../../lib/types"
import { tr, useT } from "../../i18n"

export function previewLabel(lock: VideoLock): string {
  const s = Math.max(0, lock.preview_seconds)
  if (!s) return tr("No preview")
  if (s < 60) return tr("{s} s preview", { s })
  return s % 60 ? tr("{m} min {s} s preview", { m: Math.floor(s / 60), s: s % 60 }) : tr("{m} min preview", { m: Math.floor(s / 60) })
}

export function PreviewBadge({ lock, className }: { lock: VideoLock; className?: string }) {
  const t = useT("watchx")
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md bg-black/80 px-2 py-1 text-xs font-semibold text-white", className)}>
      <Lock size={12} aria-hidden="true" /> {t("Preview")} · {previewLabel(lock)}
    </span>
  )
}

export function LockedAi({ className }: { className?: string }) {
  const t = useT("watchx")
  return (
    <section aria-label={t("AI notes")} className={cn("flex flex-col items-center justify-center gap-2 rounded-2xl border border-line bg-panel p-6 text-center", className)}>
      <Lock size={22} className="text-brand-soft" aria-hidden="true" />
      <p className="text-sm font-semibold">{t("Transcript and Ask unlock with the video")}</p>
      <p className="max-w-xs text-xs text-muted">{t("Once you have access, you can read the transcript, turn on subtitles and ask the video questions.")}</p>
    </section>
  )
}
