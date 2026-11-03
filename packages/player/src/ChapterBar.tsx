import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react"
import type { Chapter } from "./types"
import { activeChapter, cx, formatClock } from "./format"

export interface ChapterBarProps {
  durationMs: number
  currentMs: number
  bufferedMs?: number
  chapters?: Chapter[]
  onSeek: (ms: number) => void
  showTitle?: boolean
  className?: string
  label?: string
}

export function ChapterBar({ durationMs, currentMs, bufferedMs = 0, chapters, onSeek, showTitle = false, className, label = "Seek" }: ChapterBarProps) {
  const track = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<{ x: number; ms: number } | null>(null)
  const [drag, setDrag] = useState<number | null>(null)
  const duration = Math.max(durationMs, 1)
  const shown = drag ?? currentMs
  const pct = Math.min(100, (shown / duration) * 100)
  const buffered = Math.min(100, (bufferedMs / duration) * 100)
  const current = activeChapter(chapters, shown)
  const ticks = (chapters ?? []).filter((c) => c.start_ms > 0 && c.start_ms < duration)

  function msAt(clientX: number) {
    const rect = track.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return 0
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    return Math.round(ratio * duration)
  }

  function onDown(e: PointerEvent<HTMLDivElement>) {
    if (!durationMs) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag(msAt(e.clientX))
  }

  function onMove(e: PointerEvent<HTMLDivElement>) {
    const ms = msAt(e.clientX)
    const rect = track.current?.getBoundingClientRect()
    setHover({ x: rect ? e.clientX - rect.left : 0, ms })
    if (drag !== null) setDrag(ms)
  }

  function onUp(e: PointerEvent<HTMLDivElement>) {
    if (drag === null) return
    const ms = msAt(e.clientX)
    setDrag(null)
    onSeek(ms)
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const step = e.shiftKey ? 10_000 : 5_000
    if (e.key === "ArrowRight") onSeek(Math.min(duration, currentMs + step))
    else if (e.key === "ArrowLeft") onSeek(Math.max(0, currentMs - step))
    else if (e.key === "Home") onSeek(0)
    else if (e.key === "End") onSeek(duration)
    else return
    e.preventDefault()
    e.stopPropagation()
  }

  const hoverChapter = hover ? activeChapter(chapters, hover.ms) : undefined

  return (
    <div className={cx("w-full select-none", className)}>
      {showTitle && current && (
        <div className="mb-1 truncate text-xs font-medium text-white/80">{current.title}</div>
      )}
      <div
        ref={track}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={Math.round(duration / 1000)}
        aria-valuenow={Math.round(shown / 1000)}
        aria-valuetext={`${formatClock(shown)} of ${formatClock(duration)}`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => setDrag(null)}
        onPointerLeave={() => setHover(null)}
        onKeyDown={onKey}
        className="group relative flex h-4 cursor-pointer touch-none items-center outline-none"
      >
        <div className="relative h-1 w-full overflow-hidden rounded-full bg-white/25 transition-[height] group-hover:h-1.5">
          <div className="absolute inset-y-0 left-0 bg-white/35" style={{ width: `${buffered}%` }} />
          <div className="absolute inset-y-0 left-0 bg-[#C026D3]" style={{ width: `${pct}%` }} />
          {ticks.map((c) => (
            <div key={c.start_ms} className="absolute inset-y-0 w-[3px] -translate-x-1/2 bg-black/70" style={{ left: `${(c.start_ms / duration) * 100}%` }} />
          ))}
        </div>
        <div
          className={cx(
            "pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#E879F9] shadow transition-[scale] group-hover:scale-100 group-focus-visible:scale-100",
            drag !== null ? "scale-100" : "scale-0",
          )}
          style={{ left: `${pct}%` }}
        />
        {hover && durationMs > 0 && (
          <div
            className="pointer-events-none absolute bottom-5 -translate-x-1/2 whitespace-nowrap rounded-md bg-black/85 px-2 py-1 text-[11px] font-medium text-white shadow"
            style={{ left: Math.max(30, Math.min(hover.x, (track.current?.clientWidth ?? 0) - 30)) }}
          >
            {hoverChapter && <span className="mr-1.5 text-white/70">{hoverChapter.title}</span>}
            {formatClock(hover.ms)}
          </div>
        )}
      </div>
    </div>
  )
}
