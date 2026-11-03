import { useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Radio } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import {
  Badge, Button, DataTable, Field, Input, ListPage, Modal, PageHeader, Select, StatusPill, Textarea, ToggleField,
  type DataTableColumn,
} from "@klygenixvideo/ui"
import { compact, detail, when } from "../lib/format"
import { LIVE_STATUS, LIVE_STUDIO, useTierOptions, type LiveStream } from "../lib/live"

export function LiveStatusPill({ status }: { status: string }) {
  const s = LIVE_STATUS[status] ?? { label: status, hex: "#475569" }
  return <StatusPill label={s.label} hex={s.hex} />
}

export function useLiveStreams() {
  return useQuery({
    queryKey: ["studio-live"],
    queryFn: async () => (await api.get<LiveStream[]>(LIVE_STUDIO)).data,
    refetchInterval: (q) => ((q.state.data ?? []).some((s) => s.status === "live") ? 10_000 : false),
  })
}

export default function Live() {
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const { data, isLoading } = useLiveStreams()
  const rows = data ?? []
  const open = rows.find((s) => s.status === "scheduled" || s.status === "live")

  const columns: DataTableColumn<LiveStream>[] = [
    {
      key: "title",
      header: "Stream",
      render: (s) => (
        <div className="min-w-0">
          <p className="max-w-[22rem] truncate font-medium text-slate-800">{s.title}</p>
          {s.error && <p className="max-w-[22rem] truncate text-xs text-red-700">{s.error}</p>}
        </div>
      ),
    },
    { key: "status", header: "Status", render: (s) => <LiveStatusPill status={s.status} /> },
    {
      key: "when",
      header: "When",
      render: (s) => (
        <span className="whitespace-nowrap text-slate-600">
          {s.started_at ? `Started ${when(s.started_at, true)}` : s.scheduled_at ? `Planned ${when(s.scheduled_at, true)}` : `Created`}
        </span>
      ),
    },
    {
      key: "viewers",
      header: "Viewers",
      align: "right",
      render: (s) => <span className="font-num text-slate-700">{s.status === "live" ? compact(s.viewers) : `peak ${compact(s.peak_viewers)}`}</span>,
    },
    {
      key: "access",
      header: "Who can watch",
      render: (s) => (s.members_rank ? <Badge color="purple">Members level {s.members_rank}+</Badge> : <Badge color="slate">Everyone</Badge>),
    },
  ]

  return (
    <ListPage>
      <PageHeader
        title="Live"
        subtitle="Stream from OBS or straight from your browser, moderate the chat, and keep a replay."
        actions={
          open ? (
            <Button onClick={() => navigate(`/live/${open.id}`)}><Radio size={15} /> Open {open.status === "live" ? "live stream" : "next stream"}</Button>
          ) : (
            <Button onClick={() => setCreating(true)}><Radio size={15} /> Go live or schedule</Button>
          )
        }
      />
      <DataTable
        label="Live streams"
        rows={rows}
        columns={columns}
        rowKey={(s) => s.id}
        loading={isLoading}
        unitLabel="streams"
        onRowClick={(s) => navigate(`/live/${s.id}`)}
        emptyTitle="No live streams yet"
        emptyDescription="Create a stream to get your stream key, or go live from this browser."
      />
      <CreateStream open={creating} onClose={() => setCreating(false)} openId={open?.id} />
    </ListPage>
  )
}

function CreateStream({ open, onClose, openId }: { open: boolean; onClose: () => void; openId?: string }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const tiers = useTierOptions()
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [scheduledAt, setScheduledAt] = useState("")
  const [slow, setSlow] = useState("0")
  const [rank, setRank] = useState("")
  const [replay, setReplay] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const slowSeconds = Math.max(0, Math.min(600, Math.round(Number(slow) || 0)))

  async function create() {
    setBusy(true)
    setError(null)
    try {
      const { data } = await api.post<LiveStream>(LIVE_STUDIO, {
        title: title.trim(),
        description,
        scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : null,
        members_rank: rank ? Number(rank) : null,
        replay_enabled: replay,
        slow_mode_seconds: slowSeconds,
      })
      qc.invalidateQueries({ queryKey: ["studio-live"] })
      toast.success(scheduledAt ? "Stream scheduled" : "Stream created. Start sending video to go live.")
      onClose()
      navigate(`/live/${data.id}`)
    } catch (err) {
      const text = detail(err, "The stream could not be created")
      setError(text)
      toast.error(text)
      qc.invalidateQueries({ queryKey: ["studio-live"] })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New live stream"
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={create} disabled={busy || !title.trim()}>{busy ? "Creating…" : scheduledAt ? "Schedule" : "Create stream"}</Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="Title" required>
          <Input value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Description">
          <Textarea rows={3} value={description} maxLength={5000} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="Planned start" hint="Leave empty to go live as soon as video arrives.">
          <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Slow mode (seconds)" hint="0 turns it off. Up to 600.">
            <Input type="number" min={0} max={600} value={slow} onChange={(e) => setSlow(e.target.value)} />
          </Field>
          <Field label="Who can watch">
            <Select value={rank} onChange={setRank} options={tiers} aria-label="Who can watch" />
          </Field>
        </div>
        <ToggleField label="Keep a replay" hint="When the stream ends, it is saved as a video on your channel." checked={replay} onChange={setReplay} />
        {error && (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
            {openId && (
              <> <Link to={`/live/${openId}`} className="font-semibold underline" onClick={onClose}>Open that stream</Link></>
            )}
          </p>
        )}
      </div>
    </Modal>
  )
}
