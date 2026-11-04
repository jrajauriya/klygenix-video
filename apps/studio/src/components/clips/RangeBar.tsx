import { useRef, type PointerEvent } from "react"
import { clock } from "../../lib/format"
import { useT } from "../../i18n"

type Edge = "start" | "end"

export function RangeBar({
  durationMs,
  startMs,
  endMs,
  playheadMs,
  disabled,
  onChange,
}: {
  durationMs: number
  startMs: number
  endMs: number
  playheadMs: number
  disabled?: boolean
  onChange: (startMs: number, endMs: number) => void
}) {
  const t = useT()
  const bar = useRef<HTMLDivElement>(null)
  const dragging = useRef<Edge | null>(null)
  const total = Math.max(durationMs, 1)
  const pct = (ms: number) => `${Math.min(100, Math.max(0, (ms / total) * 100))}%`

  const msAt = (clientX: number) => {
    const r = bar.current!.getBoundingClientRect()
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width))
    return Math.round((f * total) / 100) * 100
  }

  const move = (edge: Edge, ms: number) => {
    if (edge === "start") onChange(Math.min(ms, endMs - 500), endMs)
    else onChange(startMs, Math.max(ms, startMs + 500))
  }

  const down = (edge: Edge) => (e: PointerEvent) => {
    if (disabled) return
    e.stopPropagation()
    dragging.current = edge
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }

  return (
    <div className="select-none">
      <div
        ref={bar}
        className="relative h-10 cursor-pointer rounded-md bg-slate-200"
        onPointerDown={(e) => {
          if (disabled) return
          const ms = msAt(e.clientX)
          move(Math.abs(ms - startMs) <= Math.abs(ms - endMs) ? "start" : "end", ms)
        }}
        onPointerMove={(e) => {
          if (dragging.current) move(dragging.current, msAt(e.clientX))
        }}
        onPointerUp={() => {
          dragging.current = null
        }}
      >
        <div className="absolute inset-y-0 rounded-md bg-brand/30 ring-2 ring-brand" style={{ left: pct(startMs), width: `calc(${pct(endMs)} - ${pct(startMs)})` }} />
        <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-navy" style={{ left: pct(playheadMs) }} />
        {(["start", "end"] as Edge[]).map((edge) => (
          <button
            key={edge}
            type="button"
            aria-label={edge === "start" ? t("Drag the start") : t("Drag the end")}
            disabled={disabled}
            onPointerDown={down(edge)}
            onPointerMove={(e) => {
              if (dragging.current === edge) move(edge, msAt(e.clientX))
            }}
            onPointerUp={() => {
              dragging.current = null
            }}
            className="absolute inset-y-[-4px] w-3 -translate-x-1/2 cursor-ew-resize rounded bg-brand shadow disabled:cursor-not-allowed"
            style={{ left: pct(edge === "start" ? startMs : endMs) }}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between font-num text-[11px] text-slate-500">
        <span>0:00</span>
        <span>{clock(durationMs)}</span>
      </div>
    </div>
  )
}
