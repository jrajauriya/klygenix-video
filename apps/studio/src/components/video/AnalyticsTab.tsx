import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { CheckCheck, Clock, Eye, Gauge, Heart, MessageCircle, MessagesSquare, Timer } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { Card, StatCard } from "@klygenixvideo/ui"
import { STUDIO, rangeDates, type RangeDays } from "../../lib/hooks"
import { clock, compact, watchTime } from "../../lib/format"
import type { StudioVideo, VideoAnalytics } from "../../lib/types"
import { DailyChart, RangePicker } from "../DailyChart"

export function averageView(v: Pick<StudioVideo, "watch_ms" | "views">): number {
  return v.views > 0 ? Math.round(v.watch_ms / v.views) : 0
}

export function AnalyticsTab({ video }: { video: StudioVideo }) {
  const [range, setRange] = useState<RangeDays>(28)
  const { from, to } = rangeDates(range)
  const { data } = useQuery({
    queryKey: ["studio-video-analytics", video.id, from, to],
    queryFn: async () => (await api.get<VideoAnalytics>(`${STUDIO}/videos/${video.id}/analytics`, { params: { from, to } })).data,
  })
  const t = data?.totals
  const avg = t?.avg_view_ms ?? 0
  const share = video.duration_ms > 0 && avg > 0 ? Math.min(100, Math.round((avg / video.duration_ms) * 100)) : null
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Views" value={t ? compact(t.views) : "—"} icon={<Eye size={16} />} accent="brand" />
        <StatCard label="Watch time" value={t ? watchTime(t.watch_ms) : "—"} icon={<Clock size={16} />} accent="blue" />
        <StatCard label="Average view" value={t && t.views ? clock(avg) : "—"} icon={<Timer size={16} />} accent="navy"
          hint={share !== null ? `${share}% of ${clock(video.duration_ms)}` : undefined} />
        <StatCard label="Watched to the end" value={t && t.views ? `${Math.round(t.completion_rate * 100)}%` : "—"} icon={<CheckCheck size={16} />} accent="green"
          hint={t && t.views ? `${compact(t.completions)} of ${compact(t.views)} views` : undefined} />
        <StatCard label="Likes" value={t ? compact(t.likes) : "—"} icon={<Heart size={16} />} accent="red"
          hint={t && t.views ? `${((t.likes / t.views) * 100).toFixed(1)}% of views` : undefined} />
        <StatCard label="Comments" value={t ? compact(t.comments) : "—"} icon={<MessageCircle size={16} />} accent="green" />
        <StatCard label="Danmaku" value={t ? compact(t.danmaku) : "—"} icon={<MessagesSquare size={16} />} accent="amber" />
        <StatCard label="Length" value={clock(video.duration_ms)} icon={<Gauge size={16} />} accent="navy" />
      </div>
      <Card className="p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-navy">Daily activity</h3>
            <p className="text-xs text-slate-500">Last {range} days, India time.</p>
          </div>
          <RangePicker value={range} onChange={setRange} />
        </div>
        {data ? <DailyChart days={data.days} /> : <div className="h-[180px] animate-pulse rounded-lg bg-slate-100" />}
      </Card>
      <p className="text-xs text-slate-500">Totals are all time and update every few minutes. Average view is total watch time divided by views.</p>
    </div>
  )
}
