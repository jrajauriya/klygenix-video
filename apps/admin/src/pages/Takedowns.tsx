import { useEffect, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { ExternalLink } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { Badge, Button, DataTable, Drawer, Field, PageHeader, SectionHeading, Select, Textarea, useConfirm } from "@klygenixvideo/ui"
import { Note, Row, Status, TAKEDOWN_STATUS, VIDEO_ADMIN, detail, humanise, relative, useCanAct, when } from "../lib/shared"
import type { Takedown } from "../lib/types"

const KEY = "admin-video-takedowns"

const FILTERS = [
  { value: "all", label: "All" },
  { value: "received", label: "Received" },
  { value: "acknowledged", label: "Acknowledged" },
  { value: "actioned", label: "Actioned" },
  { value: "rejected", label: "Rejected" },
  { value: "restored", label: "Restored" },
]

const DECISIONS: { status: string; label: string; hint: string; destructive?: boolean }[] = [
  { status: "acknowledged", label: "Acknowledge", hint: "Starts the clock on resolution; nothing is removed." },
  { status: "actioned", label: "Take down", hint: "Removes the video. Copyright notices also add a strike.", destructive: true },
  { status: "rejected", label: "Reject", hint: "The notice does not hold up; the video stays." },
  { status: "restored", label: "Restore", hint: "Puts a taken-down video back after a counter-notice." },
]

function SlaBadge({ t }: { t: Takedown }) {
  if (t.resolved_at) return <Badge color="slate">Resolved</Badge>
  if (t.ack_overdue) return <Badge color="red">Acknowledgement overdue</Badge>
  if (t.resolve_overdue) return <Badge color="red">Resolution overdue</Badge>
  if (!t.acknowledged_at) return <Badge color="amber">Acknowledge {relative(t.ack_due_at)}</Badge>
  return <Badge color="blue">Resolve {relative(t.resolve_due_at)}</Badge>
}

function TakedownDrawer({ t, onClose }: { t: Takedown | null; onClose: () => void }) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const canAct = useCanAct("admin.takedowns")
  const [note, setNote] = useState("")

  const decide = useMutation({
    mutationFn: async (status: string) => (await api.post(`${VIDEO_ADMIN}/takedowns/${t?.id}`, { status, note: note.trim() })).data,
    onSuccess: (_d, status) => {
      toast.success(`Marked ${humanise(status).toLowerCase()}`)
      qc.invalidateQueries({ queryKey: [KEY] })
      qc.invalidateQueries({ queryKey: ["admin-video-stats"] })
      qc.invalidateQueries({ queryKey: ["admin-video-actions"] })
      setNote("")
      onClose()
    },
    onError: (err) => toast.error(detail(err, "That decision could not be saved.")),
  })

  if (!t) return null

  async function choose(d: (typeof DECISIONS)[number]) {
    if (d.destructive) {
      const ok = await confirm({
        title: "Take the video down?",
        message: t?.kind === "copyright" ? "The video is removed and the channel gets a copyright strike." : "The video is removed.",
        confirmLabel: "Take down",
        variant: "destructive",
      })
      if (!ok) return
    }
    decide.mutate(d.status)
  }

  const resolved = Boolean(t.resolved_at)
  const available = DECISIONS.filter((d) => {
    if (d.status === "acknowledged") return !t.acknowledged_at && !resolved
    if (d.status === "restored") return t.status === "actioned"
    return !resolved
  })

  return (
    <Drawer open onClose={onClose} width="lg" title={`${t.reference} · ${humanise(t.kind)}`} subtitle={`Received ${when(t.received_at, true)}`}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          <Status map={TAKEDOWN_STATUS} status={t.status} />
          <SlaBadge t={t} />
          {t.sworn && <Badge color="purple">Sworn statement</Badge>}
        </div>

        <section>
          <SectionHeading>Notice</SectionHeading>
          <dl className="grid grid-cols-2 gap-4">
            <Row label="Complainant" value={t.complainant_name} />
            <Row label="Email" value={<a className="text-brand hover:underline" href={`mailto:${t.complainant_email}`}>{t.complainant_email}</a>} />
            <Row
              label="Target"
              wide
              value={
                <a href={t.target_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 break-all text-brand hover:underline">
                  {t.target_url} <ExternalLink size={13} />
                </a>
              }
            />
            <Row label="Video" value={t.video_id ? `#${t.video_id}` : "Not matched to a video"} />
            <Row label="Kind" value={humanise(t.kind)} />
            <Row label="Details" value={t.details} wide />
          </dl>
        </section>

        <section>
          <SectionHeading>Deadlines</SectionHeading>
          <dl className="grid grid-cols-2 gap-4">
            <Row
              label="Acknowledge by"
              value={
                <span className={t.ack_overdue ? "font-semibold text-red-600" : undefined}>
                  {when(t.ack_due_at, true)} ({relative(t.ack_due_at)})
                </span>
              }
            />
            <Row label="Acknowledged" value={t.acknowledged_at ? when(t.acknowledged_at, true) : "Not yet"} />
            <Row
              label="Resolve by"
              value={
                <span className={t.resolve_overdue ? "font-semibold text-red-600" : undefined}>
                  {when(t.resolve_due_at, true)} ({relative(t.resolve_due_at)})
                </span>
              }
            />
            <Row label="Resolved" value={t.resolved_at ? when(t.resolved_at, true) : "Not yet"} />
            {t.decision_note && <Row label="Decision note" value={t.decision_note} wide />}
          </dl>
        </section>

        {canAct && available.length > 0 && (
          <section>
            <SectionHeading>Decision</SectionHeading>
            <Field label="Note" hint="Kept on the notice and shown in the actions log.">
              <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <div className="mt-3 space-y-2">
              {available.map((d) => (
                <div key={d.status} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2">
                  <p className="text-sm text-slate-600">{d.hint}</p>
                  <Button
                    size="sm"
                    variant={d.destructive ? "destructive" : "outline"}
                    disabled={decide.isPending}
                    onClick={() => choose(d)}
                  >
                    {decide.isPending && decide.variables === d.status ? "Working…" : d.label}
                  </Button>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </Drawer>
  )
}

export default function Takedowns() {
  const [status, setStatus] = useState("all")
  const [params, setParams] = useSearchParams()
  const [openId, setOpenId] = useState<number | null>(null)
  const { data: rows = [], isLoading } = useQuery<Takedown[]>({
    queryKey: [KEY, status],
    queryFn: async () => (await api.get(`${VIDEO_ADMIN}/takedowns`, { params: status === "all" ? {} : { status } })).data,
    refetchInterval: 60_000,
  })

  useEffect(() => {
    const wanted = Number(params.get("open"))
    if (wanted && !openId) setOpenId(wanted)
  }, [params, openId])

  function close() {
    setOpenId(null)
    if (params.has("open")) {
      params.delete("open")
      setParams(params, { replace: true })
    }
  }

  const open = rows.find((r) => r.id === openId) ?? null
  const overdue = rows.filter((r) => !r.resolved_at && (r.ack_overdue || r.resolve_overdue)).length

  return (
    <>
      <PageHeader title="Takedowns" subtitle="Legal notices — copyright, IT Rules, intimate imagery and court orders" />
      {overdue > 0 && (
        <Note className="mb-4">
          <p>
            <b>{overdue}</b> notice{overdue === 1 ? " is" : "s are"} past a deadline. The IT Rules expect acknowledgement within a day and
            resolution within fifteen.
          </p>
        </Note>
      )}
      <DataTable
        label="Takedowns"
        loading={isLoading}
        rows={rows}
        rowKey={(r) => r.id}
        unitLabel="notices"
        emptyTitle="No notices"
        toolbarRight={<Select value={status} onChange={setStatus} options={FILTERS} aria-label="Status" className="w-44" />}
        onRowClick={(r) => setOpenId(r.id)}
        rowClassName={(r) => (!r.resolved_at && (r.ack_overdue || r.resolve_overdue) ? "bg-red-50/60" : undefined)}
        columns={[
          { key: "ref", header: "Reference", render: (r) => <span className="font-num font-medium text-navy">{r.reference}</span> },
          { key: "kind", header: "Kind", render: (r) => humanise(r.kind) },
          { key: "who", header: "Complainant", render: (r) => r.complainant_name },
          { key: "status", header: "Status", render: (r) => <Status map={TAKEDOWN_STATUS} status={r.status} /> },
          { key: "sla", header: "Deadline", render: (r) => <SlaBadge t={r} /> },
          { key: "received", header: "Received", render: (r) => <span className="text-slate-500">{relative(r.received_at)}</span> },
        ]}
      />
      <TakedownDrawer t={open} onClose={close} />
    </>
  )
}
