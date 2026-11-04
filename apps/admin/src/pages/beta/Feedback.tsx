import { useEffect, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { api } from "@klygenixvideo/auth"
import { Badge, Button, DataTable, Drawer, Field, PageHeader, SectionHeading, Select, Spinner, Textarea } from "@klygenixvideo/ui"
import { usePagedList } from "@klygenixvideo/client"
import { Row, Status, VIDEO_ADMIN, detail, humanise, relative, useCanAct, when, type Tone } from "../../lib/shared"

interface Item {
  id: number
  reference: string
  kind: "bug" | "idea" | "other"
  body: string
  page: string
  app: string
  app_version: string
  email: string | null
  status: string
  admin_note: string
  has_screenshot: boolean
  user_agent: string
  created_at: string
}

const KEY = "admin-feedback"

const STATUS: Record<string, Tone> = {
  new: { label: "New", color: "amber" },
  triaged: { label: "Triaged", color: "blue" },
  done: { label: "Done", color: "green" },
  wontfix: { label: "Won't fix", color: "slate" },
}

const KIND: Record<string, Tone> = {
  bug: { label: "Bug", color: "red" },
  idea: { label: "Idea", color: "purple" },
  other: { label: "Other", color: "slate" },
}

const STATUS_FILTER = [{ value: "", label: "Any status" }, ...Object.entries(STATUS).map(([value, t]) => ({ value, label: t.label }))]
const KIND_FILTER = [{ value: "", label: "Any kind" }, ...Object.entries(KIND).map(([value, t]) => ({ value, label: t.label }))]
const APP_FILTER = [
  { value: "", label: "Any app" },
  ...["web", "studio", "admin", "mobile", "tv"].map((a) => ({ value: a, label: humanise(a) })),
]

function Screenshot({ id }: { id: number }) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let made: string | null = null
    let live = true
    api
      .get(`${VIDEO_ADMIN}/feedback/${id}/screenshot`, { responseType: "blob" })
      .then((res) => {
        if (!live) return
        made = URL.createObjectURL(res.data as Blob)
        setUrl(made)
      })
      .catch(() => live && setFailed(true))
    return () => {
      live = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [id])
  if (failed) return <p className="text-sm text-red-700">The screenshot could not be loaded.</p>
  if (!url) return <Spinner label="Loading the screenshot" />
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="block">
      <img src={url} alt="Screenshot sent with the feedback" className="max-h-96 w-full rounded-lg border border-slate-200 object-contain" />
    </a>
  )
}

function FeedbackDrawer({ item, onClose }: { item: Item; onClose: () => void }) {
  const qc = useQueryClient()
  const canAct = useCanAct("admin.beta")
  const [status, setStatus] = useState(item.status)
  const [note, setNote] = useState(item.admin_note)

  const save = useMutation({
    mutationFn: async () => (await api.patch(`${VIDEO_ADMIN}/feedback/${item.id}`, { status, admin_note: note.trim() })).data,
    onSuccess: () => {
      toast.success("Saved")
      qc.invalidateQueries({ queryKey: [KEY] })
      onClose()
    },
    onError: (err) => toast.error(detail(err, "Could not save")),
  })

  return (
    <Drawer
      open
      onClose={onClose}
      width="lg"
      title={`${item.reference} · ${KIND[item.kind]?.label ?? item.kind}`}
      subtitle={`${humanise(item.app)} · ${when(item.created_at, true)}`}
      footer={
        canAct ? (
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending || (status === item.status && note === item.admin_note)}>
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="space-y-6">
        <blockquote className="whitespace-pre-line rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800">{item.body}</blockquote>
        <section>
          <SectionHeading>Context</SectionHeading>
          <dl className="grid grid-cols-2 gap-4">
            <Row label="From" value={item.email ?? "Anonymous"} />
            <Row label="Page" value={item.page} />
            <Row label="App" value={`${humanise(item.app)}${item.app_version ? ` ${item.app_version}` : ""}`} />
            <Row label="Status" value={<Status map={STATUS} status={item.status} />} />
            <Row label="Browser" value={item.user_agent} wide />
          </dl>
        </section>
        {item.has_screenshot && (
          <section>
            <SectionHeading>Screenshot</SectionHeading>
            <Screenshot id={item.id} />
          </section>
        )}
        <section>
          <SectionHeading>Triage</SectionHeading>
          <div className="space-y-3">
            <Field label="Status">
              <Select value={status} onChange={setStatus} options={STATUS_FILTER.slice(1)} disabled={!canAct} />
            </Field>
            <Field label="Note" hint="For the team. Not sent to the person.">
              <Textarea rows={3} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} disabled={!canAct} />
            </Field>
          </div>
        </section>
      </div>
    </Drawer>
  )
}

export default function Feedback() {
  const [status, setStatus] = useState("")
  const [kind, setKind] = useState("")
  const [app, setApp] = useState("")
  const [open, setOpen] = useState<Item | null>(null)
  const filters = Object.fromEntries(Object.entries({ status, kind, app }).filter(([, v]) => v))
  const list = usePagedList<Item>(KEY, `${VIDEO_ADMIN}/feedback`, filters, 50)

  return (
    <>
      <PageHeader title="Feedback" subtitle="Bugs, ideas and notes sent from the apps" />
      <DataTable
        label="Feedback"
        loading={list.isLoading}
        rows={list.rows}
        rowKey={(r) => r.id}
        serverTotal={list.total}
        onServerPage={list.onServerPage}
        pageSize={list.pageSize}
        pageSizeOptions={[50, 100, 200]}
        unitLabel="messages"
        emptyTitle="No feedback"
        onRowClick={(r) => setOpen(r)}
        toolbarRight={
          <div className="flex flex-wrap gap-2">
            <Select value={status} onChange={setStatus} options={STATUS_FILTER} aria-label="Status" className="w-36" />
            <Select value={kind} onChange={setKind} options={KIND_FILTER} aria-label="Kind" className="w-32" />
            <Select value={app} onChange={setApp} options={APP_FILTER} aria-label="App" className="w-32" />
          </div>
        }
        columns={[
          { key: "ref", header: "Reference", render: (r) => <span className="font-num font-medium text-navy">{r.reference}</span> },
          { key: "kind", header: "Kind", render: (r) => <Status map={KIND} status={r.kind} /> },
          {
            key: "body",
            header: "Message",
            render: (r) => (
              <span className="block max-w-md">
                <span className="block truncate text-slate-800">{r.body}</span>
                <span className="block truncate text-xs text-slate-500">{r.page || "No page"}{r.has_screenshot ? " · screenshot" : ""}</span>
              </span>
            ),
          },
          { key: "app", header: "App", render: (r) => <Badge color="slate">{humanise(r.app)}</Badge> },
          { key: "status", header: "Status", render: (r) => <Status map={STATUS} status={r.status} /> },
          { key: "when", header: "Sent", render: (r) => <span className="text-slate-500">{relative(r.created_at)}</span> },
        ]}
      />
      {open && <FeedbackDrawer key={open.id} item={open} onClose={() => setOpen(null)} />}
    </>
  )
}
