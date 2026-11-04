import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { CheckCheck, Clock, Eye, Gauge, Heart, MessageCircle, MessagesSquare, Timer } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { Card, StatCard } from "@klygenixvideo/ui"
import { STUDIO, rangeDates, type RangeDays } from "../../lib/hooks"
import { clock, compact, watchTime } from "../../lib/format"
import type { StudioVideo, VideoAnalytics } from "../../lib/types"
import { DailyChart, RangePicker } from "../DailyChart"
import { RetentionChart, TrafficSources } from "../AudienceCharts"
import { useT } from "../../i18n"

export function averageView(v: Pick<StudioVideo, "watch_ms" | "views">): number {
  return v.views > 0 ? Math.round(v.watch_ms / v.views) : 0
}

export function AnalyticsTab({ video }: { video: StudioVideo }) {
  const t = useT()
  const [range, setRange] = useState<RangeDays>(28)
  const { from, to } = rangeDates(range)
  const { data } = useQuery({
    queryKey: ["studio-video-analytics", video.id, from, to],
    queryFn: async () => (await api.get<VideoAnalytics>(`${STUDIO}/videos/${video.id}/analytics`, { params: { from, to } })).data,
  })
  const tot = data?.totals
  const avg = tot?.avg_view_ms ?? 0
  const share = video.duration_ms > 0 && avg > 0 ? Math.min(100, Math.round((avg / video.duration_ms) * 100)) : null
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label={t("Views")} value={tot ? compact(tot.views) : "—"} icon={<Eye size={16} />} accent="brand" />
        <StatCard label={t("Watch time")} value={tot ? watchTime(tot.watch_ms) : "—"} icon={<Clock size={16} />} accent="blue" />
        <StatCard label={t("Average view")} value={tot && tot.views ? clock(avg) : "—"} icon={<Timer size={16} />} accent="navy"
          hint={share !== null ? t("{share}% of {length}", { share, length: clock(video.duration_ms) }) : undefined} />
        <StatCard label={t("Watched to the end")} value={tot && tot.views ? `${Math.round(tot.completion_rate * 100)}%` : "—"} icon={<CheckCheck size={16} />} accent="green"
          hint={tot && tot.views ? t("{done} of {views} views", { done: compact(tot.completions), views: compact(tot.views) }) : undefined} />
        <StatCard label={t("Likes")} value={tot ? compact(tot.likes) : "—"} icon={<Heart size={16} />} accent="red"
          hint={tot && tot.views ? t("{pct}% of views", { pct: ((tot.likes / tot.views) * 100).toFixed(1) }) : undefined} />
        <StatCard label={t("Comments")} value={tot ? compact(tot.comments) : "—"} icon={<MessageCircle size={16} />} accent="green" />
        <StatCard label={t("Danmaku")} value={tot ? compact(tot.danmaku) : "—"} icon={<MessagesSquare size={16} />} accent="amber" />
        <StatCard label={t("Length")} value={clock(video.duration_ms)} icon={<Gauge size={16} />} accent="navy" />
      </div>
      <Card className="p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-navy">{t("Daily activity")}</h3>
            <p className="text-xs text-slate-500">{t("Last {n} days, India time.", { n: range })}</p>
          </div>
          <RangePicker value={range} onChange={setRange} />
        </div>
        {data ? <DailyChart days={data.days} /> : <div className="h-[180px] animate-pulse rounded-lg bg-slate-100" />}
      </Card>
      <Card className="p-5">
        <h3 className="text-sm font-bold text-navy">{t("Audience retention")}</h3>
        <p className="mb-3 text-xs text-slate-500">{t("How many viewers are still watching at each point, last {n} days.", { n: range })}</p>
        {data ? <RetentionChart points={data.retention ?? []} lengthLabel={video.duration_ms ? clock(video.duration_ms) : undefined} /> : <div className="h-[200px] animate-pulse rounded-lg bg-slate-100" />}
      </Card>
      {data && <TrafficSources sources={data.sources ?? []} external={data.external ?? []} />}
      <p className="text-xs text-slate-500">{t("Totals are all time and update every few minutes. Average view is total watch time divided by views.")}</p>
    </div>
  )
}
