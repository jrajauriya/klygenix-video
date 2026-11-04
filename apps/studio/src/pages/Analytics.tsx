import { useNavigate, useSearchParams } from "react-router-dom"
import { Clock, Eye, Heart, MessageCircle, MessagesSquare, Timer, UserPlus, Users } from "lucide-react"
import { Card, DataTable, ListPage, PageHeader, StatCard, type DataTableColumn } from "@klygenixvideo/ui"
import { parseRange, useChannelAnalytics } from "../lib/hooks"
import { clock, compact, watchTime } from "../lib/format"
import type { ChannelAnalytics } from "../lib/types"
import { KindBadge } from "../components/StatusChips"
import { averageView } from "../components/video/AnalyticsTab"
import { DailyChart, RangePicker } from "../components/DailyChart"
import { RevenueByStream, TrafficSources } from "../components/AudienceCharts"
import { useHasFeature } from "@klygenixvideo/client"
import { useHasPermission } from "../lib/team"
import { useT } from "../i18n"

type Top = ChannelAnalytics["top"][number]

export default function Analytics() {
  const t = useT()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const range = parseRange(params.get("days"))
  const { data, isLoading } = useChannelAnalytics(range)
  const totals = data?.totals
  const p = data?.period
  const top = data?.top ?? []
  const most = Math.max(1, ...top.map((v) => v.views))
  const moneyOn = useHasFeature("video.earnings")
  const moneyAllowed = useHasPermission("video.earnings")

  const columns: DataTableColumn<Top>[] = [
    {
      key: "title",
      header: t("Video"),
      render: (v) => (
        <div className="flex min-w-0 items-center gap-2">
          <KindBadge kind={v.kind} />
          <span className="max-w-[20rem] truncate font-medium text-slate-800">{v.title}</span>
        </div>
      ),
    },
    {
      key: "views",
      header: t("Views"),
      sortKey: "views",
      render: (v) => (
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-brand" style={{ width: `${(v.views / most) * 100}%` }} />
          </div>
          <span className="font-num">{compact(v.views)}</span>
        </div>
      ),
    },
    { key: "watch", header: t("Watch time"), sortKey: "watch_ms", align: "right", render: (v) => <span className="font-num">{watchTime(v.watch_ms)}</span> },
    { key: "avg", header: t("Average view"), align: "right", sortValue: (v) => averageView(v), render: (v) => <span className="font-num">{v.views ? clock(averageView(v)) : "—"}</span> },
  ]

  return (
    <ListPage>
      <PageHeader
        title={t("Analytics")}
        subtitle={t("How your channel is doing, day by day.")}
        actions={<RangePicker value={range} onChange={(d) => setParams({ days: String(d) }, { replace: true })} />}
      />
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{t("Last {n} days", { n: range })}</h2>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatCard size="sm" label={t("Views")} value={p ? compact(p.views) : "—"} icon={<Eye size={16} />} accent="brand" />
        <StatCard size="sm" label={t("Watch time")} value={p ? watchTime(p.watch_ms) : "—"} icon={<Clock size={16} />} accent="blue" />
        <StatCard size="sm" label={t("Average view")} value={p && p.views ? clock(Math.round(p.watch_ms / p.views)) : "—"} icon={<Timer size={16} />} accent="navy" />
        <StatCard size="sm" label={t("Likes")} value={p ? compact(p.likes) : "—"} icon={<Heart size={16} />} accent="red" />
        <StatCard size="sm" label={t("New followers")} value={p ? compact(p.followers_gained) : "—"} icon={<UserPlus size={16} />} accent="green" />
      </div>
      <Card className="mb-4 p-5">
        <h2 className="mb-1 text-sm font-bold text-navy">{t("Daily activity")}</h2>
        <p className="mb-3 text-xs text-slate-500">{t("India time. Days fill in as views are counted, every few minutes.")}</p>
        {data ? <DailyChart days={data.days} /> : <div className="h-[180px] animate-pulse rounded-lg bg-slate-100" />}
      </Card>
      {data && (
        <div className="mb-4 space-y-4">
          <TrafficSources sources={data.sources ?? []} external={data.external ?? []} />
          {data.revenue && moneyOn && moneyAllowed && <RevenueByStream revenue={data.revenue} days={range} />}
        </div>
      )}
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{t("All time")}</h2>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard size="sm" label={t("Views")} value={totals ? compact(totals.views) : "—"} icon={<Eye size={16} />} accent="brand" />
        <StatCard size="sm" label={t("Watch time")} value={totals ? watchTime(totals.watch_ms) : "—"} icon={<Clock size={16} />} accent="blue" />
        <StatCard size="sm" label={t("Likes")} value={totals ? compact(totals.likes) : "—"} icon={<Heart size={16} />} accent="red" />
        <StatCard size="sm" label={t("Comments")} value={totals ? compact(totals.comments) : "—"} icon={<MessageCircle size={16} />} accent="green" />
        <StatCard size="sm" label={t("Danmaku")} value={totals ? compact(totals.danmaku) : "—"} icon={<MessagesSquare size={16} />} accent="amber" />
        <StatCard size="sm" label={t("Followers")} value={totals ? compact(totals.followers) : "—"} icon={<Users size={16} />} accent="navy" />
      </div>
      <DataTable
        label={t("Top videos")}
        rows={top}
        columns={columns}
        rowKey={(v) => v.id}
        loading={isLoading}
        initialSort={{ key: "views", dir: "desc" }}
        unitLabel={t("videos")}
        onRowClick={(v) => navigate(`/videos/${v.id}?tab=analytics`)}
        emptyTitle={t("No videos yet")}
        note={totals ? t("Your top {n} of {total} videos by all-time views.", { n: top.length, total: totals.videos }) : undefined}
      />
    </ListPage>
  )
}
