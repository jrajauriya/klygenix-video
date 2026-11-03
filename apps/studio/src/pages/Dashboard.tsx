import { Link, useNavigate } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { Clapperboard, Clock, ExternalLink, Eye, Heart, MessageCircle, MessagesSquare, Upload } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { Badge, Button, Card, EmptyState, PageHeader, StatCard } from "@klygenixvideo/ui"
import { STUDIO, useChannel, useChannelAnalytics, useMe } from "../lib/hooks"
import { channelUrl, clock, compact, watchTime } from "../lib/format"
import type { StudioVideo } from "../lib/types"
import { ChannelAvatar } from "../components/ChannelAvatar"
import { AiStatusBadge, VideoStatusPill } from "../components/StatusChips"
import { UsageMeters } from "../components/UsageMeters"
import { DailyChart } from "../components/DailyChart"

const BUSY = ["uploading", "processing", "scanning"]

export default function Dashboard() {
  const navigate = useNavigate()
  const { data: channel } = useChannel()
  const { data: me } = useMe()
  const { data } = useQuery({
    queryKey: ["studio-videos", "dashboard"],
    queryFn: async () => {
      const res = await api.get<StudioVideo[]>(`${STUDIO}/videos?limit=30`)
      return { rows: res.data, total: Number(res.headers["x-total-count"] ?? res.data.length) }
    },
    refetchInterval: (q) => (q.state.data?.rows.some((v) => BUSY.includes(v.status) || v.ai_status === "running") ? 5000 : false),
  })
  const videos = data?.rows ?? []
  const { data: stats } = useChannelAnalytics(28)
  const totals = stats?.totals
  const working = videos.filter((v) => BUSY.includes(v.status) || v.status === "in_review")
  const latestLong = videos.find((v) => v.kind === "long" && v.source === "upload" && v.status === "published" && v.suggestion_count > 0)
  const ideas = latestLong?.suggestion_count ?? 0
  const plan = me?.plans.creator

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={channel ? `Welcome back. Here is how ${channel.name} is doing.` : undefined}
        actions={<Button onClick={() => navigate("/videos?upload=1")}><Upload size={15} /> Upload a video</Button>}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard size="sm" label="Views" value={totals ? compact(totals.views) : "—"} icon={<Eye size={16} />} accent="brand" />
        <StatCard size="sm" label="Watch time" value={totals ? watchTime(totals.watch_ms) : "—"} icon={<Clock size={16} />} accent="blue" />
        <StatCard size="sm" label="Likes" value={totals ? compact(totals.likes) : "—"} icon={<Heart size={16} />} accent="red" />
        <StatCard size="sm" label="Comments" value={totals ? compact(totals.comments) : "—"} icon={<MessageCircle size={16} />} accent="green" />
        <StatCard size="sm" label="Danmaku" value={totals ? compact(totals.danmaku) : "—"} icon={<MessagesSquare size={16} />} accent="amber" />
      </div>
      <p className="mt-2 text-xs text-slate-500">All-time totals for every video on your channel.</p>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="min-w-0 space-y-4 lg:col-span-2">
          {latestLong && ideas > 0 && (
            <Card className="flex flex-col gap-4 border-brand-100 bg-brand-50 p-5 sm:flex-row sm:items-center">
              {latestLong.thumbnail && (
                <img src={latestLong.thumbnail} alt="" className="aspect-video w-full max-w-xs rounded-lg object-cover sm:w-44" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-brand">Make clips</p>
                <p className="truncate text-base font-bold text-navy">{latestLong.title}</p>
                <p className="mt-0.5 text-sm text-slate-600">
                  {ideas} clip {ideas === 1 ? "idea is" : "ideas are"} ready from this video. Turn the best moments into vertical reels with captions.
                </p>
              </div>
              <Button onClick={() => navigate(`/videos/${latestLong.id}?tab=clips`)}>
                <Clapperboard size={15} /> See clip ideas
              </Button>
            </Card>
          )}

          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-bold text-navy">Views in the last 28 days</h2>
                {stats && <p className="text-xs text-slate-500">{compact(stats.period.views)} views · {compact(stats.period.followers_gained)} new followers</p>}
              </div>
              <Link to="/analytics" className="text-sm font-semibold text-brand hover:underline">Analytics</Link>
            </div>
            {stats ? <DailyChart days={stats.days} showMetricPicker={false} /> : <div className="h-[180px] animate-pulse rounded-lg bg-slate-100" />}
          </Card>

          <Card className="p-5">
            <h2 className="mb-3 text-sm font-bold text-navy">Processing now</h2>
            {working.length === 0 ? (
              <p className="text-sm text-slate-500">Nothing is processing. New uploads show their progress here.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {working.map((v) => (
                  <li key={v.id}>
                    <Link to={`/videos/${v.id}`} className="flex items-center gap-3 py-2.5 hover:bg-slate-50">
                      <div className="h-10 w-16 shrink-0 overflow-hidden rounded bg-slate-200">
                        {v.thumbnail && <img src={v.thumbnail} alt="" className="h-full w-full object-cover" />}
                      </div>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">{v.title}</span>
                      <VideoStatusPill video={v} />
                      <AiStatusBadge value={v.ai_status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold text-navy">Latest videos</h2>
              <Link to="/videos" className="text-sm font-semibold text-brand hover:underline">All videos</Link>
            </div>
            {videos.length === 0 ? (
              <EmptyState title="No videos yet" hint="Upload your first video and we will make a transcript, chapters and clip ideas from it."
                action={<Button onClick={() => navigate("/videos?upload=1")}><Upload size={15} /> Upload</Button>} />
            ) : (
              <ul className="divide-y divide-slate-100">
                {videos.slice(0, 5).map((v) => (
                  <li key={v.id}>
                    <Link to={`/videos/${v.id}`} className="flex items-center gap-3 py-2.5 hover:bg-slate-50">
                      <div className="relative h-10 w-16 shrink-0 overflow-hidden rounded bg-slate-200">
                        {v.thumbnail && <img src={v.thumbnail} alt="" className="h-full w-full object-cover" />}
                        <span className="absolute bottom-0 right-0 rounded-tl bg-black/70 px-1 font-num text-[10px] text-white">{clock(v.duration_ms)}</span>
                      </div>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">{v.title}</span>
                      <span className="hidden font-num text-xs text-slate-500 sm:inline">{compact(v.views)} views</span>
                      <VideoStatusPill video={v} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="min-w-0 space-y-4">
          {channel && (
            <Card className="flex items-center gap-4 p-5">
              <ChannelAvatar channel={channel} size={56} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-bold text-navy">{channel.name}</p>
                <p className="truncate text-sm text-slate-500">@{channel.handle}</p>
                <p className="mt-1 text-sm text-slate-600">
                  <span className="font-num font-semibold">{compact(channel.followers)}</span> followers ·{" "}
                  <span className="font-num font-semibold">{channel.video_count}</span> videos
                </p>
                <a href={channelUrl(channel.handle)} target="_blank" rel="noopener noreferrer"
                  className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-brand hover:underline">
                  Open your public page <ExternalLink size={13} />
                </a>
              </div>
            </Card>
          )}
          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-navy">Your plan</h2>
              {plan && <Badge color={plan.free ? "slate" : "brand"}>{plan.name}</Badge>}
            </div>
            {plan && <p className="mb-4 text-sm text-slate-600">{plan.description}</p>}
            {me && <UsageMeters usage={me.usage} />}
            <Link to="/billing" className="mt-4 inline-block text-sm font-semibold text-brand hover:underline">
              {plan?.free ? "Upgrade for more AI minutes and renders" : "Manage your plan"}
            </Link>
          </Card>
        </div>
      </div>
    </>
  )
}
