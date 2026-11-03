import { useEffect, useMemo, useRef } from "react"
import type { DanmakuItem } from "./types"
import { cx, formatClock, isBlocked } from "./format"

export interface DanmakuRailProps {
  items: DanmakuItem[]
  currentMs?: number | null
  blocked?: string[]
  onSeek?: (ms: number) => void
  limit?: number
  className?: string
  emptyText?: string
}

export function DanmakuRail({ items, currentMs, blocked, onSeek, limit = 200, className, emptyText = "No danmaku yet. Be the first." }: DanmakuRailProps) {
  const list = useRef<HTMLDivElement>(null)
  const synced = typeof currentMs === "number"
  const shown = useMemo(() => {
    const visible = items.filter((d) => !isBlocked(d.text, blocked) && (!synced || d.t_ms <= (currentMs ?? 0)))
    return visible.slice(-limit)
  }, [items, blocked, synced, currentMs, limit])
  const lastKey = shown.length ? String(shown[shown.length - 1].id) : ""

  useEffect(() => {
    if (!synced) return
    const box = list.current
    if (box) box.scrollTo({ top: box.scrollHeight, behavior: "smooth" })
  }, [lastKey, synced])

  return (
    <div ref={list} className={cx("min-h-0 overflow-y-auto", className)} aria-live="polite">
      {shown.length === 0 && <p className="px-3 py-6 text-center text-sm text-white/50">{emptyText}</p>}
      <ul className="space-y-0.5 p-1">
        {shown.map((d) => (
          <li key={d.id}>
            <button
              type="button"
              disabled={!onSeek}
              onClick={() => onSeek?.(d.t_ms)}
              className={cx("flex w-full items-baseline gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-white/5 disabled:cursor-default", d.mine && "bg-[#A21CAF]/15", Boolean(d.boost_tier) && "bg-white/[0.06] font-semibold")}
              style={d.boost_tier && d.color ? { boxShadow: `inset 3px 0 0 ${d.color}` } : undefined}
            >
              <span className="w-10 shrink-0 text-[11px] tabular-nums text-white/40">{formatClock(d.t_ms)}</span>
              <span className="min-w-0 flex-1 break-words" style={{ color: d.color && d.color.toUpperCase() !== "#FFFFFF" ? d.color : undefined }}>
                {d.text}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
