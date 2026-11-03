import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { api } from "@klygenixvideo/auth"
import { DataTable, Drawer, DrawerFooter, Field, PageHeader, SectionHeading, Select, Textarea } from "@klygenixvideo/ui"
import { ACTION_TONE, Row, Status, VIDEO_ADMIN, detail, humanise, useCanAct, when } from "../lib/shared"
import type { AppealRow } from "../lib/types"
import { ModerationTabs } from "../components/moderation/ModerationTabs"
import { TargetPreview } from "../components/moderation/TargetPreview"

const KEY = "admin-video-appeals"

const FILTERS = [
  { value: "open", label: "Open" },
  { value: "upheld", label: "Upheld" },
  { value: "overturned", label: "Overturned" },
]

function AppealDrawer({ appeal, onClose }: { appeal: AppealRow | null; onClose: () => void }) {
  const qc = useQueryClient()
  const canAct = useCanAct("admin.moderation")
  const [note, setNote] = useState("")

  const decide = useMutation({
    mutationFn: async (decision: "upheld" | "overturned") =>
      (await api.post(`${VIDEO_ADMIN}/appeals/${appeal?.id}`, { decision, note: note.trim() })).data,
    onSuccess: (_d, decision) => {
      toast.success(decision === "overturned" ? "Appeal granted — the action was reversed" : "Appeal declined")
      qc.invalidateQueries({ queryKey: [KEY] })
      qc.invalidateQueries({ queryKey: ["admin-video-actions"] })
      qc.invalidateQueries({ queryKey: ["admin-video-queue"] })
      setNote("")
      onClose()
    },
    onError: (err) => toast.error(detail(err, "That decision could not be saved.")),
  })

  if (!appeal) return null
  const a = appeal.action
  const open = appeal.status === "open"
  const blocked = note.trim().length < 3

  return (
    <Drawer
      open
      onClose={onClose}
      width="lg"
      title={`Appeal #${appeal.id}`}
      subtitle={`Filed ${when(appeal.created_at, true)}`}
      footer={
        open && canAct ? (
          <DrawerFooter
            secondary={[
              {
                label: "Uphold the action",
                onClick: () => decide.mutate("upheld"),
                disabled: blocked,
                pending: decide.isPending && decide.variables === "upheld",
              },
            ]}
            save={{
              label: "Overturn and restore",
              onClick: () => decide.mutate("overturned"),
              disabled: blocked,
              pending: decide.isPending && decide.variables === "overturned",
            }}
          />
        ) : undefined
      }
    >
      <div className="space-y-6">
        <section>
          <SectionHeading>The creator says</SectionHeading>
          <p className="whitespace-pre-line rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800">
            {appeal.text}
          </p>
        </section>
        {a && (
          <section>
            <SectionHeading>The action appealed</SectionHeading>
            <dl className="grid grid-cols-2 gap-4">
              <Row label="Action" value={<Status map={ACTION_TONE} status={a.action} />} />
              <Row label="Target" value={`${humanise(a.target_type)} #${a.target_id}`} />
              <Row label="Reason given" value={a.reason} wide />
            </dl>
            <div className="mt-4">
              <TargetPreview type={a.target_type} id={a.target_id} target={a.target} />
            </div>
          </section>
        )}
        {open && canAct && (
          <Field label="Note to the creator" required hint="Overturning restores the item and lifts any strike from this action.">
            <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        )}
      </div>
    </Drawer>
  )
}

export default function Appeals() {
  const [status, setStatus] = useState("open")
  const [open, setOpen] = useState<AppealRow | null>(null)
  const { data: rows = [], isLoading } = useQuery<AppealRow[]>({
    queryKey: [KEY, status],
    queryFn: async () => (await api.get(`${VIDEO_ADMIN}/appeals`, { params: { status } })).data,
  })

  return (
    <>
      <PageHeader title="Moderation" subtitle="Creators asking for a decision to be looked at again" />
      <ModerationTabs active="/moderation/appeals" />
      <DataTable
        label="Appeals"
        loading={isLoading}
        rows={rows}
        rowKey={(r) => r.id}
        unitLabel="appeals"
        emptyTitle={status === "open" ? "No open appeals" : "Nothing here"}
        toolbarRight={<Select value={status} onChange={setStatus} options={FILTERS} aria-label="Status" className="w-40" />}
        onRowClick={(r) => setOpen(r)}
        columns={[
          { key: "when", header: "Filed", render: (r) => when(r.created_at, true) },
          { key: "action", header: "Action", render: (r) => (r.action ? <Status map={ACTION_TONE} status={r.action.action} /> : "—") },
          {
            key: "target",
            header: "Target",
            render: (r) =>
              r.action ? r.action.target.title ?? r.action.target.name ?? `${humanise(r.action.target_type)} #${r.action.target_id}` : "—",
          },
          { key: "text", header: "Appeal", render: (r) => <span className="line-clamp-1 max-w-md text-slate-600">{r.text}</span> },
        ]}
      />
      <AppealDrawer appeal={open} onClose={() => setOpen(null)} />
    </>
  )
}
