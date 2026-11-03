import { useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { ExternalLink, Eye, Film, Square } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { Button, Card, EmptyState, ListPage, PageHeader, Spinner, StatusPill, useConfirm } from "@klygenixvideo/ui"
import { compact, detail, when } from "../lib/format"
import { LIVE_STUDIO, type LiveStream } from "../lib/live"
import { VIDEO_STATUS } from "../components/StatusChips"
import { VideoPreview } from "../components/VideoPreview"
import { IngestDetails } from "../components/live/Ingest"
import { BrowserGoLive } from "../components/live/BrowserGoLive"
import { LiveChat } from "../components/live/LiveChat"
import { LiveSettings } from "../components/live/LiveSettings"
import { LiveStatusPill } from "./Live"

const BUSY = ["uploading", "processing", "scanning"]

export default function GoLive() {
  const { publicId = "" } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [viewers, setViewers] = useState<number | null>(null)
  const [ending, setEnding] = useState(false)
  const key = ["studio-live", publicId]

  const { data: stream, isLoading, isError } = useQuery({
    queryKey: key,
    queryFn: async () => (await api.get<LiveStream>(`${LIVE_STUDIO}/${publicId}`)).data,
    refetchInterval: (q) => {
      const s = q.state.data
      if (!s) return false
      if (s.status === "live" && !s.playback) return 2500
      if (s.status === "live" || s.status === "scheduled") return 4000
      if (!s.replay_enabled || s.error) return false
      return !s.replay || BUSY.includes(s.replay.status) ? 5000 : false
    },
  })

  if (isLoading) return <Spinner />
  if (isError || !stream) return <EmptyState title="This live stream could not be found" hint="It may belong to another channel." />

  const closed = stream.status === "ended" || stream.status === "failed"
  const count = closed ? stream.peak_viewers : viewers ?? stream.viewers

  const refresh = () => qc.invalidateQueries({ queryKey: key })

  async function end() {
    const ok = await confirm({
      title: "End this stream?",
      message: stream?.replay_enabled
        ? "Viewers see that the stream has ended, and the replay starts being prepared. A stream cannot be restarted."
        : "Viewers see that the stream has ended. A stream cannot be restarted.",
      confirmLabel: "End stream",
      variant: "destructive",
    })
    if (!ok) return
    setEnding(true)
    try {
      const { data } = await api.post<LiveStream>(`${LIVE_STUDIO}/${publicId}/end`)
      qc.setQueryData(key, data)
      qc.invalidateQueries({ queryKey: ["studio-live"] })
      refresh()
      toast.success("Stream ended")
    } catch (err) {
      toast.error(detail(err, "Could not end the stream"))
    } finally {
      setEnding(false)
    }
  }

  return (
    <ListPage>
      <PageHeader
        title={stream.title}
        onBack={() => navigate("/live")}
        actions={!closed ? (
          <Button variant="destructive" onClick={end} disabled={ending}><Square size={14} /> {ending ? "Ending…" : "End stream"}</Button>
        ) : undefined}
      />
      <div className="-mt-1 mb-4 flex flex-wrap items-center gap-3 pl-10 text-sm text-slate-600">
        <LiveStatusPill status={stream.status} />
        <span className="inline-flex items-center gap-1 font-num"><Eye size={14} aria-hidden="true" /> {compact(count)} {closed ? (count === 1 ? "peak viewer" : "peak viewers") : stream.status === "live" ? "watching" : "waiting"}</span>
        {stream.scheduled_at && stream.status === "scheduled" && <span>Planned {when(stream.scheduled_at, true)}</span>}
        {stream.started_at && <span>Started {when(stream.started_at, true)}</span>}
        {stream.ended_at && <span>Ended {when(stream.ended_at, true)}</span>}
        {stream.members_rank ? <span>Members level {stream.members_rank}+</span> : null}
      </div>
      {stream.error && <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{stream.error}</p>}
      <div className="grid gap-5 pb-8 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="min-w-0 space-y-5">
          <Card className="space-y-3 p-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-navy">What viewers see</h2>
              {stream.status === "live" && <span className="text-xs text-slate-500">A few seconds behind</span>}
            </div>
            <VideoPreview
              src={stream.status === "live" ? stream.playback?.url : null}
              autoPlay
              muted
            />
            {stream.status === "scheduled" && <p className="text-sm text-slate-500">Start sending video from OBS or this browser. The preview appears as soon as the stream is live.</p>}
            {stream.status === "live" && !stream.playback && <p className="text-sm text-slate-500">Waiting for the first video segments…</p>}
          </Card>
          {closed ? <Replay stream={stream} /> : (
            <>
              {stream.ingest.browser && <BrowserGoLive stream={stream} onChange={refresh} />}
              <IngestDetails stream={stream} />
            </>
          )}
        </div>
        <div className="min-w-0 space-y-5">
          <LiveChat
            stream={stream}
            onViewers={setViewers}
            onSlowMode={(seconds) => qc.setQueryData<LiveStream>(key, (s) => (s ? { ...s, slow_mode_seconds: seconds } : s))}
            onEnded={refresh}
          />
          <LiveSettings key={`${stream.id}-${stream.status}`} stream={stream} />
        </div>
      </div>
    </ListPage>
  )
}

function Replay({ stream }: { stream: LiveStream }) {
  const replay = stream.replay
  const s = replay ? VIDEO_STATUS[replay.status as keyof typeof VIDEO_STATUS] ?? { label: replay.status, hex: "#475569" } : null
  return (
    <Card className="space-y-3 p-5">
      <h2 className="text-sm font-bold text-navy">Replay</h2>
      {!stream.replay_enabled ? (
        <p className="text-sm text-slate-500">Replays were off for this stream.</p>
      ) : replay || stream.replay_video_id ? (
        <div className="flex flex-wrap items-center gap-3">
          <Film size={18} className="text-brand" aria-hidden="true" />
          {s && <StatusPill label={s.label} hex={s.hex} />}
          <Link to={`/videos/${replay?.video_id ?? stream.replay_video_id}`} className="inline-flex items-center gap-1 text-sm font-semibold text-brand hover:underline">
            Open the replay video <ExternalLink size={12} aria-hidden="true" />
          </Link>
        </div>
      ) : stream.error ? (
        <p className="text-sm text-slate-500">No replay could be made for this stream.</p>
      ) : (
        <p className="text-sm text-slate-500">Preparing the replay. It appears in your videos when it is ready.</p>
      )}
    </Card>
  )
}
