import { useEffect, useRef, useState } from "react"
import { CHART_AXIS, CHART_LINE, CHART_RULE, cn } from "@klygenixvideo/ui"
import { compact, watchTime } from "../lib/format"
import { RANGES, type RangeDays } from "../lib/hooks"
import type { DayRow } from "../lib/types"

export type Metric = "views" | "watch_ms" | "likes"

const METRICS: { key: Metric; label: string }[] = [
  { key: "views", label: "Views" },
  { key: "watch_ms", label: "Watch time" },
  { key: "likes", label: "Likes" },
]

const HEIGHT = 180
const PAD = { top: 12, right: 8, bottom: 22, left: 44 }

function shortDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" })
}

function fmt(metric: Metric, n: number): string {
  return metric === "watch_ms" ? watchTime(n) : compact(n)
}

function niceCount(n: number): number {
  if (n <= 4) return 4
  const pow = 10 ** Math.floor(Math.log10(n))
  const unit = ([1, 2, 5, 10].find((s) => s * pow >= n / 2) ?? 10) * pow
  const max = Math.ceil(n / unit) * unit
  return max % 2 ? max + unit : max
}

function axisLabel(metric: Metric, t: number, max: number): string {
  if (metric === "watch_ms" && max < 240_000) return `${Math.round(t / 1000)} s`
  return fmt(metric, t)
}

function niceMax(metric: Metric, n: number): number {
  if (metric !== "watch_ms") return niceCount(n)
  const unit = n < 240_000 ? 1000 : 60_000
  return niceCount(n / unit) * unit
}

function barPath(x: number, y: number, w: number, base: number): string {
  const r = Math.min(4, w / 2, base - y)
  return `M${x},${base}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${base}Z`
}

export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

export function Segmented<T extends string | number>({ value, options, onChange, label }: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  label: string
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-md px-2.5 py-1 text-xs font-semibold transition",
            o.value === value ? "bg-brand text-white" : "text-slate-600 hover:bg-slate-100",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function RangePicker({ value, onChange }: { value: RangeDays; onChange: (v: RangeDays) => void }) {
  return <Segmented label="Date range" value={value} onChange={onChange} options={RANGES.map((d) => ({ value: d, label: `${d} days` }))} />
}

export function DailyChart({ days, metric: initial = "views", showMetricPicker = true }: { days: DayRow[]; metric?: Metric; showMetricPicker?: boolean }) {
  const [metric, setMetric] = useState<Metric>(initial)
  const [hover, setHover] = useState<number | null>(null)
  const [box, width] = useWidth<HTMLDivElement>()
  const values = days.map((d) => d[metric])
  const max = niceMax(metric, Math.max(0, ...values))
  const plotW = Math.max(0, width - PAD.left - PAD.right)
  const plotH = HEIGHT - PAD.top - PAD.bottom
  const base = PAD.top + plotH
  const step = days.length ? plotW / days.length : 0
  const gap = Math.max(2, step * 0.25)
  const barW = Math.max(1, step - gap)
  const y = (v: number) => base - (v / max) * plotH
  const ticks = [0, max / 2, max]
  const labelEvery = Math.max(1, Math.ceil(days.length / Math.max(1, Math.floor(plotW / 64))))
  const empty = values.every((v) => v === 0)
  const label = METRICS.find((m) => m.key === metric)!.label
  const h = hover !== null ? days[hover] : null

  return (
    <div>
      {showMetricPicker && (
        <div className="mb-3">
          <Segmented label="Measure" value={metric} onChange={setMetric} options={METRICS.map((m) => ({ value: m.key, label: m.label }))} />
        </div>
      )}
      <div ref={box} className="relative w-full" style={{ height: HEIGHT }} onMouseLeave={() => setHover(null)}>
        {width > 0 && (
          <svg width={width} height={HEIGHT} role="img" aria-label={`${label} per day, ${days.length} days`} className="block">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke={CHART_RULE} strokeWidth={1} />
                <text x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={10} fill={CHART_AXIS} className="font-num">
                  {axisLabel(metric, t, max)}
                </text>
              </g>
            ))}
            {days.map((d, i) => {
              const x = PAD.left + i * step + gap / 2
              const v = d[metric]
              return (
                <g key={d.day}>
                  {v > 0 && <path d={barPath(x, y(v), barW, base)} fill={CHART_LINE} opacity={hover === null || hover === i ? 1 : 0.45} />}
                  {i % labelEvery === 0 && (
                    <text x={x + barW / 2} y={HEIGHT - 6} textAnchor="middle" fontSize={10} fill={CHART_AXIS}>{shortDay(d.day)}</text>
                  )}
                  <rect x={PAD.left + i * step} y={PAD.top} width={step} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} />
                </g>
              )
            })}
          </svg>
        )}
        {empty && (
          <p className="pointer-events-none absolute inset-x-0 top-1/3 text-center text-sm text-slate-500">
            No {label.toLowerCase()} in these days yet.
          </p>
        )}
        {h && hover !== null && (
          <div
            className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 whitespace-nowrap rounded-md border border-slate-200 bg-white px-2 py-1 text-xs shadow-md"
            style={{ left: Math.min(Math.max(PAD.left + hover * step + step / 2, 50), width - 50) }}
          >
            <p className="font-semibold text-navy">{shortDay(h.day)}</p>
            <p className="font-num text-slate-600">{label}: {fmt(metric, h[metric])}</p>
          </div>
        )}
      </div>
      <table className="sr-only">
        <caption>{label} per day</caption>
        <thead><tr><th>Day</th><th>{label}</th></tr></thead>
        <tbody>{days.map((d) => <tr key={d.day}><td>{d.day}</td><td>{fmt(metric, d[metric])}</td></tr>)}</tbody>
      </table>
    </div>
  )
}
