import { useNavigate } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { AlertTriangle, Clock, Eye, Film, Flag, Gavel, MessageSquare, ShieldAlert, Users, Wallet } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { Badge, Card, PageHeader, StatCard } from "@klygenixvideo/ui"
import { formatMoney } from "@klygenixvideo/client"
import { VIDEO_ADMIN, humanise, num, relative } from "../lib/shared"
import type { QueueItem, Takedown, VideoStats } from "../lib/types"

function Breakdown({ title, rows }: { title: string; rows: [string, number][] }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-slate-400">Nothing yet</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {rows.map(([k, v]) => (
            <li key={k} className="flex items-center justify-between text-sm">
              <span className="text-slate-600">{humanise(k)}</span>
              <span className="font-num font-semibold text-navy">{num(v)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function Attention() {
  const navigate = useNavigate()
  const { data: queue = [] } = useQuery<QueueItem[]>({
    queryKey: ["admin-video-queue", "dashboard"],
    queryFn: async () => (await api.get(`${VIDEO_ADMIN}/queue`, { params: { limit: 200 } })).data,
  })
  const { data: takedowns = [] } = useQuery<Takedown[]>({
    queryKey: ["admin-video-takedowns", "all"],
    queryFn: async () => (await api.get(`${VIDEO_ADMIN}/takedowns`)).data,
  })
  const held = queue.filter((q) => q.why === "held")
  const overdue = takedowns.filter((t) => !t.resolved_at && (t.ack_overdue || t.resolve_overdue))

  return (
    <Card className="p-0">
      <div className="border-b border-slate-200 px-4 py-3">
        <h3 className="font-semibold text-navy">Needs attention</h3>
        <p className="text-xs text-slate-500">Videos held by the scan and takedowns past their deadline</p>
      </div>
      {held.length === 0 && overdue.length === 0 ? (
        <p className="px-4 py-6 text-sm text-slate-400">Nothing is waiting. Held videos and overdue takedowns show here.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {held.map((h) => (
            <li key={`v${h.target_id}`}>
              <button
                type="button"
                onClick={() => navigate(`/moderation?open=video:${h.target_id}`)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"
              >
                <ShieldAlert size={16} className="shrink-0 text-amber-600" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-navy">{h.target.title ?? `Video #${h.target_id}`}</p>
                  <p className="truncate text-xs text-slate-500">
                    Held {relative(h.since)} {h.labels.length > 0 && `· ${h.labels.join(", ")}`}
                  </p>
                </div>
                <Badge color="amber">Held</Badge>
              </button>
            </li>
          ))}
          {overdue.map((t) => (
            <li key={`t${t.id}`}>
              <button
                type="button"
                onClick={() => navigate(`/takedowns?open=${t.id}`)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"
              >
                <AlertTriangle size={16} className="shrink-0 text-red-600" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-navy">
                    {t.reference} · {humanise(t.kind)}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {t.ack_overdue ? `Acknowledgement was due ${relative(t.ack_due_at)}` : `Resolution was due ${relative(t.resolve_due_at)}`}
                  </p>
                </div>
                <Badge color="red">Overdue</Badge>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

export default function Dashboard() {
  const navigate = useNavigate()
  const { data } = useQuery<VideoStats>({
    queryKey: ["admin-video-stats"],
    queryFn: async () => (await api.get(`${VIDEO_ADMIN}/stats`)).data,
    refetchInterval: 60_000,
  })

  const dash = "—"
  const revenue = Object.entries(data?.revenue_minor ?? {})
  const subs = Object.values(data?.active_subscriptions ?? {}).reduce((a, b) => a + b, 0)
  const published = Object.values(data?.videos.published_by_kind ?? {}).reduce((a, b) => a + b, 0)

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Klygenix Play at a glance" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Published videos"
          value={data ? num(published) : dash}
          hint={data ? `${num(data.videos.published_by_kind.long)} long · ${num(data.videos.published_by_kind.reel)} reels` : undefined}
          icon={<Film size={20} />}
          onClick={() => navigate("/videos")}
        />
        <StatCard label="Minutes hosted" value={data ? num(data.videos.minutes) : dash} icon={<Clock size={20} />} accent="blue" />
        <StatCard label="Views" value={data ? num(data.videos.views) : dash} icon={<Eye size={20} />} accent="green" />
        <StatCard label="Channels" value={data ? num(data.channels) : dash} icon={<Users size={20} />} accent="navy" />
        <StatCard
          label="Comments · danmaku"
          value={data ? `${num(data.comments)} · ${num(data.danmaku)}` : dash}
          icon={<MessageSquare size={20} />}
          accent="navy"
        />
        <StatCard
          label="Open reports"
          value={data ? num(data.open_reports) : dash}
          hint={data ? `${num(data.held_videos)} videos held for review` : undefined}
          icon={<Flag size={20} />}
          accent={data && (data.open_reports > 0 || data.held_videos > 0) ? "amber" : "green"}
          onClick={() => navigate("/moderation")}
        />
        <StatCard
          label="Open takedowns"
          value={data ? num(data.open_takedowns) : dash}
          hint={data ? `${num(data.overdue_takedowns)} overdue` : undefined}
          icon={<Gavel size={20} />}
          accent={data && data.overdue_takedowns > 0 ? "red" : "blue"}
          onClick={() => navigate("/takedowns")}
        />
        <StatCard
          label="Revenue"
          value={revenue.length ? revenue.map(([c, m]) => formatMoney(m, c)).join(" · ") : data ? formatMoney(0, "INR") : dash}
          hint={data ? `${num(subs)} active subscriptions` : undefined}
          icon={<Wallet size={20} />}
          accent="green"
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Attention />
        </div>
        <div className="space-y-4">
          <Breakdown title="Videos by status" rows={Object.entries(data?.videos.by_status ?? {})} />
          <Breakdown title="Active subscriptions" rows={Object.entries(data?.active_subscriptions ?? {})} />
        </div>
      </div>
    </>
  )
}
