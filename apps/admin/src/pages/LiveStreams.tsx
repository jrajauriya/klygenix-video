import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { ExternalLink, OctagonX, RefreshCw } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { Badge, Button, DataTable, Field, Modal, PageHeader, Select, Textarea, type DataTableColumn } from "@klygenixvideo/ui"
import { Status, VIDEO_ADMIN, WEB_URL, detail, num, useCanAct, when, type Tone } from "../lib/shared"

interface AdminLive {
  id: string
  title: string
  status: string
  scheduled_at: string | null
  started_at: string | null
  ended_at: string | null
  members_rank: number | null
  slow_mode_seconds: number
  viewers: number
  peak_viewers: number
  replay_enabled: boolean
  tenant_id: number
  error: string | null
  channel: { id: number; handle: string; name: string } | null
}

const LIVE_STATUS: Record<string, Tone> = {
  scheduled: { label: "Scheduled", color: "amber" },
  live: { label: "Live", color: "red" },
  ended: { label: "Ended", color: "slate" },
  failed: { label: "Failed", color: "red" },
}

const FILTER = [
  { value: "all", label: "Every status" },
  ...Object.entries(LIVE_STATUS).map(([value, t]) => ({ value, label: t.label })),
]

export default function LiveStreams() {
  const canAct = useCanAct("admin.moderation")
  const [status, setStatus] = useState("live")
  const [stopping, setStopping] = useState<AdminLive | null>(null)

  const { data = [], isLoading, isFetching, refetch } = useQuery({
    queryKey: ["admin-live", status],
    queryFn: async () => (await api.get<AdminLive[]>(`${VIDEO_ADMIN}/live`, { params: status === "all" ? {} : { status } })).data,
    refetchInterval: 15_000,
  })

  const columns: DataTableColumn<AdminLive>[] = [
    {
      key: "title",
      header: "Stream",
      sortValue: (r) => r.title,
      render: (r) => (
        <div className="min-w-0">
          <p className="max-w-[22rem] truncate font-medium text-slate-800">{r.title}</p>
          <p className="text-xs text-slate-500">
            {r.channel ? `@${r.channel.handle}` : "No channel"} · tenant {r.tenant_id} · {r.id}
          </p>
          {r.error && <p className="max-w-[22rem] truncate text-xs text-red-700" title={r.error}>{r.error}</p>}
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      sortValue: (r) => r.status,
      render: (r) => (
        <div className="flex flex-wrap gap-1">
          <Status map={LIVE_STATUS} status={r.status} />
          {r.members_rank ? <Badge color="purple">Members {r.members_rank}+</Badge> : null}
        </div>
      ),
    },
    {
      key: "viewers",
      header: "Viewers",
      align: "right",
      className: "font-num",
      sortValue: (r) => (r.status === "live" ? r.viewers : r.peak_viewers),
      render: (r) => (r.status === "live" ? `${num(r.viewers)} now` : `${num(r.peak_viewers)} peak`),
    },
    {
      key: "when",
      header: "When",
      sortValue: (r) => r.started_at ?? r.scheduled_at ?? "",
      render: (r) => (
        <span className="whitespace-nowrap text-slate-600">
          {r.ended_at ? `Ended ${when(r.ended_at, true)}` : r.started_at ? `Started ${when(r.started_at, true)}` : r.scheduled_at ? `Planned ${when(r.scheduled_at, true)}` : "—"}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (r) => (
        <div className="flex justify-end gap-1.5">
          <a href={`${WEB_URL}/live/${r.id}`} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-brand hover:bg-brand-50">
            Watch <ExternalLink size={11} aria-hidden="true" />
          </a>
          {canAct && (r.status === "live" || r.status === "scheduled") && (
            <Button size="sm" variant="destructive" onClick={() => setStopping(r)}>
              <OctagonX size={13} /> Force stop
            </Button>
          )}
        </div>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Live streams"
        subtitle="What is live right now across every channel, and a way to stop it"
        actions={
          <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw size={14} /> {isFetching ? "Refreshing…" : "Refresh"}
          </Button>
        }
      />
      <DataTable
        label="Live streams"
        rows={data}
        columns={columns}
        rowKey={(r) => r.id}
        loading={isLoading}
        unitLabel="streams"
        emptyTitle={status === "live" ? "Nobody is live" : "No streams"}
        emptyDescription="Streams appear here as soon as a creator schedules or starts one."
        toolbarRight={<Select value={status} onChange={setStatus} options={FILTER} className="w-40" aria-label="Status" />}
        note="Shows the 100 most recent streams for the status chosen. Refreshes every 15 seconds."
      />
      <StopModal stream={stopping} onClose={() => setStopping(null)} />
    </>
  )
}

function StopModal({ stream, onClose }: { stream: AdminLive | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const valid = reason.trim().length >= 3

  async function stop() {
    if (!stream) return
    setBusy(true)
    try {
      await api.post(`${VIDEO_ADMIN}/live/${stream.id}/stop`, { reason: reason.trim() })
      toast.success("Stream stopped")
      qc.invalidateQueries({ queryKey: ["admin-live"] })
      qc.invalidateQueries({ queryKey: ["admin-ops-failed"] })
      setReason("")
      onClose()
    } catch (err) {
      toast.error(detail(err, "The stream could not be stopped"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={Boolean(stream)}
      onClose={() => {
        setReason("")
        onClose()
      }}
      title="Force stop this stream?"
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" onClick={stop} disabled={busy || !valid}>{busy ? "Stopping…" : "Stop stream"}</Button>
        </div>
      }
    >
      {stream && (
        <div className="space-y-4">
          <p className="text-sm text-slate-700">
            <b>{stream.title}</b>{stream.channel ? ` on @${stream.channel.handle}` : ""} ends at once for every viewer. The creator sees
            the reason on the stream, and the stop is written to the audit log. A stopped stream cannot be restarted.
          </p>
          <Field label="Reason" required hint="3 to 300 characters. The creator sees this." error={reason && !valid ? "Write at least 3 characters" : undefined}>
            <Textarea rows={3} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </div>
      )}
    </Modal>
  )
}
