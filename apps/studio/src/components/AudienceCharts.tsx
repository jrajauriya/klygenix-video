import { useState } from "react"
import { Link } from "react-router-dom"
import { CHART_AXIS, CHART_LINE, CHART_RULE, Card } from "@klygenixvideo/ui"
import { formatMoney } from "@klygenixvideo/client"
import { compact } from "../lib/format"
import type { ExternalRow, Revenue, SourceRow } from "../lib/types"
import { useWidth } from "./DailyChart"
import { tr, useT } from "../i18n"

const SOURCE_LABEL: Record<string, string> = {
  home: "Home feed",
  reels: "Reels",
  search: "Search",
  channel: "Channel page",
  related: "Related videos",
  playlist: "Playlists",
  share: "Shared links",
  external: "Other websites",
  follow: "Following feed",
  direct: "Direct or unknown",
}

const PURPOSE_LABEL: Record<string, string> = {
  tip: "Tips",
  boost: "Danmaku boosts",
  membership: "Memberships",
  video: "Paid videos",
  series: "Series",
}

export const sourceLabel = (s: string) => (SOURCE_LABEL[s] ? tr(SOURCE_LABEL[s]) : s.replace(/_/g, " "))

const HEIGHT = 200
const PAD = { top: 12, right: 12, bottom: 24, left: 40 }

export function RetentionChart({ points, lengthLabel }: { points: { at_pct: number; audience: number }[]; lengthLabel?: string }) {
  const t = useT()
  const [box, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const plotW = Math.max(0, width - PAD.left - PAD.right)
  const plotH = HEIGHT - PAD.top - PAD.bottom
  const base = PAD.top + plotH
  const x = (pct: number) => PAD.left + (pct / 100) * plotW
  const y = (a: number) => base - Math.max(0, Math.min(1, a)) * plotH
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(p.at_pct).toFixed(1)},${y(p.audience).toFixed(1)}`).join("")
  const area = points.length ? `${line}L${x(points[points.length - 1].at_pct)},${base}L${x(points[0].at_pct)},${base}Z` : ""
  const h = hover !== null ? points[hover] : null
  const half = points.findIndex((p) => p.audience < 0.5)

  if (!points.length) {
    return <p className="rounded-lg bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">{t("Not enough views yet to draw how long people watch.")}</p>
  }

  return (
    <div>
      <div ref={box} className="relative w-full" style={{ height: HEIGHT }} onMouseLeave={() => setHover(null)}>
        {width > 0 && (
          <svg width={width} height={HEIGHT} role="img" aria-label={t("Audience retention: {pct}% still watching at the end", { pct: Math.round(points[points.length - 1].audience * 100) })} className="block">
            {[0, 0.5, 1].map((tick) => (
              <g key={tick}>
                <line x1={PAD.left} x2={width - PAD.right} y1={y(tick)} y2={y(tick)} stroke={CHART_RULE} strokeWidth={1} />
                <text x={PAD.left - 6} y={y(tick)} dy="0.32em" textAnchor="end" fontSize={10} fill={CHART_AXIS} className="font-num">{tick * 100}%</text>
              </g>
            ))}
            {[0, 25, 50, 75, 100].map((tick) => (
              <text key={tick} x={x(tick)} y={HEIGHT - 6} textAnchor={tick === 0 ? "start" : tick === 100 ? "end" : "middle"} fontSize={10} fill={CHART_AXIS} className="font-num">{tick}%</text>
            ))}
            <path d={area} fill={CHART_LINE} opacity={0.12} />
            <path d={line} fill="none" stroke={CHART_LINE} strokeWidth={2} strokeLinejoin="round" />
            {h && <circle cx={x(h.at_pct)} cy={y(h.audience)} r={4} fill={CHART_LINE} />}
            <rect x={PAD.left} y={PAD.top} width={plotW} height={plotH} fill="transparent"
              onMouseMove={(e) => {
                const r = (e.currentTarget as SVGRectElement).getBoundingClientRect()
                const pct = ((e.clientX - r.left) / r.width) * 100
                let best = 0
                points.forEach((p, i) => {
                  if (Math.abs(p.at_pct - pct) < Math.abs(points[best].at_pct - pct)) best = i
                })
                setHover(best)
              }} />
          </svg>
        )}
        {h && hover !== null && (
          <div className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 whitespace-nowrap rounded-md border border-slate-200 bg-white px-2 py-1 text-xs shadow-md"
            style={{ left: Math.min(Math.max(x(h.at_pct), 60), width - 60) }}>
            <p className="font-num text-slate-600">{t("{pct}% in", { pct: Math.round(h.at_pct) })} · <b className="text-navy">{Math.round(h.audience * 100)}%</b> {t("still watching")}</p>
          </div>
        )}
      </div>
      <p className="mt-1 text-xs text-slate-500">
        {lengthLabel ? t("Across: how far into the video ({length} long). Up: share of viewers still watching.", { length: lengthLabel }) : t("Across: how far into the video. Up: share of viewers still watching.")}
        {half > 0 ? " " + t("Half the audience has left by {pct}% of the way in.", { pct: Math.round(points[half].at_pct) }) : ""}
      </p>
      <table className="sr-only">
        <caption>{t("Audience retention")}</caption>
        <thead><tr><th>{t("Position")}</th><th>{t("Still watching")}</th></tr></thead>
        <tbody>{points.map((p) => <tr key={p.at_pct}><td>{p.at_pct}%</td><td>{Math.round(p.audience * 100)}%</td></tr>)}</tbody>
      </table>
    </div>
  )
}

function Bars<T>({ rows, label, value, title, format = compact }: {
  rows: T[]
  label: (r: T) => string
  value: (r: T) => number
  title: string
  format?: (n: number) => string
}) {
  const total = rows.reduce((a, r) => a + value(r), 0)
  const most = Math.max(1, ...rows.map(value))
  return (
    <ul aria-label={title} className="space-y-2.5">
      {rows.map((r) => {
        const v = value(r)
        return (
          <li key={label(r)}>
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate text-slate-700">{label(r)}</span>
              <span className="shrink-0 font-num text-slate-600">
                <b className="text-navy">{format(v)}</b>{total > 0 ? ` · ${Math.round((v / total) * 100)}%` : ""}
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
              <div className="h-full rounded-full bg-brand" style={{ width: `${(v / most) * 100}%` }} />
            </div>
          </li>
        )
      })}
    </ul>
  )
}

export function TrafficSources({ sources, external }: { sources: SourceRow[]; external: ExternalRow[] }) {
  const t = useT()
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="p-5">
        <h2 className="text-sm font-bold text-navy">{t("Where views came from")}</h2>
        <p className="mb-3 text-xs text-slate-500">{t("The page or feed a viewer was on when they started watching.")}</p>
        {sources.length ? (
          <Bars title={t("Traffic sources")} rows={sources} label={(r) => sourceLabel(r.source)} value={(r) => r.views} />
        ) : (
          <p className="text-sm text-slate-500">{t("No views in these days yet.")}</p>
        )}
      </Card>
      <Card className="p-5">
        <h2 className="text-sm font-bold text-navy">{t("Top other websites")}</h2>
        <p className="mb-3 text-xs text-slate-500">{t("Sites that linked or embedded your videos.")}</p>
        {external.length ? (
          <Bars title={t("Top other websites")} rows={external} label={(r) => r.host} value={(r) => r.views} />
        ) : (
          <p className="text-sm text-slate-500">{t("No views from other websites in these days.")}</p>
        )}
      </Card>
    </div>
  )
}

export function RevenueByStream({ revenue, days }: { revenue: Revenue; days: number }) {
  const t = useT()
  const inr = (n: number) => formatMoney(n, revenue.currency || "INR")
  return (
    <Card className="p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-navy">{t("Revenue by stream")}</h2>
          <p className="text-xs text-slate-500">{t("Last {n} days, after refunds. Your share is after commission, GST and tax withheld.", { n: days })}</p>
        </div>
        <Link to="/earnings" className="text-sm font-semibold text-brand hover:underline">{t("Open Earnings")}</Link>
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:max-w-md">
        <div className="rounded-lg bg-slate-50 px-3 py-2">
          <p className="text-xs text-slate-500">{t("Viewers paid")}</p>
          <p className="font-num text-lg font-bold text-navy">{inr(revenue.gross_minor)}</p>
        </div>
        <div className="rounded-lg bg-slate-50 px-3 py-2">
          <p className="text-xs text-slate-500">{t("Your share")}</p>
          <p className="font-num text-lg font-bold text-navy">{inr(revenue.net_minor)}</p>
        </div>
      </div>
      {revenue.by_purpose.length ? (
        <table className="w-full text-sm">
          <caption className="sr-only">{t("Revenue by stream")}</caption>
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
              <th scope="col" className="py-1.5 font-semibold">{t("Stream|revenue")}</th>
              <th scope="col" className="py-1.5 text-right font-semibold">{t("Sales")}</th>
              <th scope="col" className="py-1.5 text-right font-semibold">{t("Viewers paid")}</th>
              <th scope="col" className="py-1.5 text-right font-semibold">{t("Your share")}</th>
            </tr>
          </thead>
          <tbody>
            {revenue.by_purpose.map((p) => {
              const most = Math.max(1, ...revenue.by_purpose.map((r) => r.gross_minor))
              return (
                <tr key={p.purpose} className="border-b border-slate-50">
                  <th scope="row" className="py-2 text-left font-medium text-slate-700">
                    {PURPOSE_LABEL[p.purpose] ? t(PURPOSE_LABEL[p.purpose]) : p.purpose}
                    <div className="mt-1 h-1.5 w-32 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
                      <div className="h-full rounded-full bg-brand" style={{ width: `${(p.gross_minor / most) * 100}%` }} />
                    </div>
                  </th>
                  <td className="py-2 text-right font-num">{p.sales}</td>
                  <td className="py-2 text-right font-num">{inr(p.gross_minor)}</td>
                  <td className="py-2 text-right font-num font-semibold text-navy">{inr(p.net_minor)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      ) : (
        <p className="text-sm text-slate-500">{t("No sales in these days. Tips, boosts, memberships and paid videos show here.")}</p>
      )}
    </Card>
  )
}
