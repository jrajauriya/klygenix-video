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
import { useT } from "../i18n"

export function LiveStatusPill({ status }: { status: string }) {
  const t = useT()
  const s = LIVE_STATUS[status] ?? { label: status, hex: "#475569" }
  return <StatusPill label={t(s.label)} hex={s.hex} />
}

export function useLiveStreams() {
  return useQuery({
    queryKey: ["studio-live"],
    queryFn: async () => (await api.get<LiveStream[]>(LIVE_STUDIO)).data,
    refetchInterval: (q) => ((q.state.data ?? []).some((s) => s.status === "live") ? 10_000 : false),
  })
}

export default function Live() {
  const t = useT()
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const { data, isLoading } = useLiveStreams()
  const rows = data ?? []
  const open = rows.find((s) => s.status === "scheduled" || s.status === "live")

  const columns: DataTableColumn<LiveStream>[] = [
    {
      key: "title",
      header: t("Stream"),
      render: (s) => (
        <div className="min-w-0">
          <p className="max-w-[22rem] truncate font-medium text-slate-800">{s.title}</p>
          {s.error && <p className="max-w-[22rem] truncate text-xs text-red-700">{s.error}</p>}
        </div>
      ),
    },
    { key: "status", header: t("Status"), render: (s) => <LiveStatusPill status={s.status} /> },
    {
      key: "when",
      header: t("When"),
      render: (s) => (
        <span className="whitespace-nowrap text-slate-600">
          {s.started_at ? t("Started {when}", { when: when(s.started_at, true) }) : s.scheduled_at ? t("Planned {when}", { when: when(s.scheduled_at, true) }) : t("Created")}
        </span>
      ),
    },
    {
      key: "viewers",
      header: t("Viewers"),
      align: "right",
      render: (s) => <span className="font-num text-slate-700">{s.status === "live" ? compact(s.viewers) : t("peak {n}", { n: compact(s.peak_viewers) })}</span>,
    },
    {
      key: "access",
      header: t("Who can watch"),
      render: (s) => (s.members_rank ? <Badge color="purple">{t("Members level {n}+", { n: s.members_rank })}</Badge> : <Badge color="slate">{t("Everyone")}</Badge>),
    },
  ]

  return (
    <ListPage>
      <PageHeader
        title={t("Live")}
        subtitle={t("Stream from OBS or straight from your browser, moderate the chat, and keep a replay.")}
        actions={
          open ? (
            <Button onClick={() => navigate(`/live/${open.id}`)}><Radio size={15} /> {open.status === "live" ? t("Open live stream") : t("Open next stream")}</Button>
          ) : (
            <Button onClick={() => setCreating(true)}><Radio size={15} /> {t("Go live or schedule")}</Button>
          )
        }
      />
      <DataTable
        label={t("Live streams")}
        rows={rows}
        columns={columns}
        rowKey={(s) => s.id}
        loading={isLoading}
        unitLabel={t("streams")}
        onRowClick={(s) => navigate(`/live/${s.id}`)}
        emptyTitle={t("No live streams yet")}
        emptyDescription={t("Create a stream to get your stream key, or go live from this browser.")}
      />
      <CreateStream open={creating} onClose={() => setCreating(false)} openId={open?.id} />
    </ListPage>
  )
}

function CreateStream({ open, onClose, openId }: { open: boolean; onClose: () => void; openId?: string }) {
  const t = useT()
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
      toast.success(scheduledAt ? t("Stream scheduled") : t("Stream created. Start sending video to go live."))
      onClose()
      navigate(`/live/${data.id}`)
    } catch (err) {
      const text = detail(err, t("The stream could not be created"))
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
      title={t("New live stream")}
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>{t("Cancel")}</Button>
          <Button onClick={create} disabled={busy || !title.trim()}>{busy ? t("Creating…") : scheduledAt ? t("Schedule") : t("Create stream")}</Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label={t("Title")} required>
          <Input value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label={t("Description")}>
          <Textarea rows={3} value={description} maxLength={5000} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label={t("Planned start")} hint={t("Leave empty to go live as soon as video arrives.")}>
          <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("Slow mode (seconds)")} hint={t("0 turns it off. Up to 600.")}>
            <Input type="number" min={0} max={600} value={slow} onChange={(e) => setSlow(e.target.value)} />
          </Field>
          <Field label={t("Who can watch")}>
            <Select value={rank} onChange={setRank} options={tiers} aria-label={t("Who can watch")} />
          </Field>
        </div>
        <ToggleField label={t("Keep a replay")} hint={t("When the stream ends, it is saved as a video on your channel.")} checked={replay} onChange={setReplay} />
        {error && (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
            {openId && (
              <> <Link to={`/live/${openId}`} className="font-semibold underline" onClick={onClose}>{t("Open that stream")}</Link></>
            )}
          </p>
        )}
      </div>
    </Modal>
  )
}
