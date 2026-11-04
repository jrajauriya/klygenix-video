import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import type { TranscriptSegment } from "./types"
import { cx, formatClock } from "./format"
import { SearchIcon } from "./icons"

export interface TranscriptPanelProps {
  segments: TranscriptSegment[]
  currentMs: number
  onSeek: (ms: number) => void
  autoScroll?: boolean
  className?: string
  emptyText?: string
  searchPlaceholder?: string
  noMatchText?: string
}

function highlight(text: string, query: string): ReactNode {
  if (!query) return text
  const lower = text.toLowerCase()
  const q = query.toLowerCase()
  const out: ReactNode[] = []
  let at = 0
  let i = lower.indexOf(q)
  while (i !== -1) {
    if (i > at) out.push(text.slice(at, i))
    out.push(<mark key={i} className="rounded bg-[#A21CAF]/60 px-0.5 text-white">{text.slice(i, i + q.length)}</mark>)
    at = i + q.length
    i = lower.indexOf(q, at)
  }
  out.push(text.slice(at))
  return out
}

export function TranscriptPanel({
  segments, currentMs, onSeek, autoScroll = true, className, emptyText = "No transcript yet.", searchPlaceholder = "Search in transcript", noMatchText = "Nothing matches that.",
}: TranscriptPanelProps) {
  const [query, setQuery] = useState("")
  const [follow, setFollow] = useState(true)
  const list = useRef<HTMLDivElement>(null)
  const resume = useRef<number | undefined>(undefined)
  const q = query.trim()

  const shown = useMemo(() => {
    if (!q) return segments
    const lower = q.toLowerCase()
    return segments.filter((s) => s.text.toLowerCase().includes(lower))
  }, [segments, q])

  const activeIndex = useMemo(() => {
    let found = -1
    for (let i = 0; i < segments.length; i++) {
      if (segments[i].start_ms <= currentMs) found = i
      else break
    }
    return found
  }, [segments, currentMs])

  const activeStart = activeIndex >= 0 ? segments[activeIndex].start_ms : -1

  useEffect(() => {
    if (!autoScroll || !follow || q) return
    const box = list.current
    const row = box?.querySelector<HTMLElement>(`[data-start="${activeStart}"]`)
    if (!box || !row) return
    const top = row.offsetTop - box.clientHeight / 3
    box.scrollTo({ top: Math.max(0, top), behavior: "smooth" })
  }, [activeStart, autoScroll, follow, q])

  useEffect(() => () => window.clearTimeout(resume.current), [])

  function pauseFollow() {
    setFollow(false)
    window.clearTimeout(resume.current)
    resume.current = window.setTimeout(() => setFollow(true), 6000)
  }

  return (
    <div className={cx("flex min-h-0 flex-col", className)}>
      <label className="relative mb-2 block shrink-0">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/45"><SearchIcon /></span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          className="h-9 w-full rounded-lg border border-white/10 bg-white/5 pl-9 pr-3 text-sm text-white placeholder:text-white/40 outline-none focus:border-[#C026D3]"
        />
      </label>
      {q && <div className="mb-1 shrink-0 text-xs text-white/50">{shown.length} {shown.length === 1 ? "match" : "matches"}</div>}
      <div ref={list} onWheel={pauseFollow} onTouchMove={pauseFollow} className="relative min-h-0 flex-1 overflow-y-auto pr-1">
        {shown.length === 0 && <p className="px-2 py-6 text-center text-sm text-white/50">{q ? noMatchText : emptyText}</p>}
        {shown.map((s) => {
          const on = s.start_ms === activeStart
          return (
            <button
              key={s.start_ms}
              type="button"
              data-start={s.start_ms}
              onClick={() => onSeek(s.start_ms)}
              className={cx(
                "flex w-full gap-3 rounded-lg px-2 py-1.5 text-left text-sm transition-colors",
                on ? "bg-[#A21CAF]/25 text-white" : "text-white/75 hover:bg-white/5",
              )}
            >
              <span className={cx("mt-0.5 w-12 shrink-0 text-xs tabular-nums", on ? "text-[#F0ABFC]" : "text-white/45")}>
                {s.label ?? formatClock(s.start_ms)}
              </span>
              <span className="min-w-0 flex-1 leading-relaxed">{highlight(s.text, q)}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
