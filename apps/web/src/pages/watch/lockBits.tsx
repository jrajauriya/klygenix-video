import { Lock } from "lucide-react"
import { cn } from "@klygenixvideo/ui"
import type { VideoLock } from "../../lib/types"

export function previewLabel(lock: VideoLock): string {
  const s = Math.max(0, lock.preview_seconds)
  if (!s) return "No preview"
  return s >= 60 ? `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ""} preview` : `${s} s preview`
}

export function PreviewBadge({ lock, className }: { lock: VideoLock; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md bg-black/80 px-2 py-1 text-xs font-semibold text-white", className)}>
      <Lock size={12} aria-hidden="true" /> Preview · {previewLabel(lock)}
    </span>
  )
}

export function LockedAi({ className }: { className?: string }) {
  return (
    <section aria-label="AI notes" className={cn("flex flex-col items-center justify-center gap-2 rounded-2xl border border-line bg-panel p-6 text-center", className)}>
      <Lock size={22} className="text-brand-soft" aria-hidden="true" />
      <p className="text-sm font-semibold">Transcript and Ask unlock with the video</p>
      <p className="max-w-xs text-xs text-muted">Once you have access, you can read the transcript, turn on subtitles and ask the video questions.</p>
    </section>
  )
}
