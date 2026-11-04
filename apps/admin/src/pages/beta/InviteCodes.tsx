import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Check, Copy, Plus } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { Badge, Button, DataTable, Field, Input, Modal, PageHeader, Select, ToggleField, useConfirm } from "@klygenixvideo/ui"
import { usePagedList } from "@klygenixvideo/client"
import { VIDEO_ADMIN, detail, humanise, relative, useCanAct, when } from "../../lib/shared"

interface Code {
  id: number
  hint: string
  role: "viewer" | "creator"
  email: string | null
  note: string
  max_uses: number
  used: number
  expires_at: string | null
  revoked_at: string | null
  created_at: string
  code?: string
}

const KEY = "admin-beta-codes"

function state(c: Code): { label: string; color: "green" | "slate" | "red" | "amber" } {
  if (c.revoked_at) return { label: "Revoked", color: "red" }
  if (c.expires_at && new Date(c.expires_at) < new Date()) return { label: "Expired", color: "slate" }
  if (c.used >= c.max_uses) return { label: "Used up", color: "slate" }
  return { label: "Active", color: "green" }
}

function CopyCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex items-center gap-2">
      <code className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-center font-num text-lg font-bold tracking-wider text-navy">{code}</code>
      <Button
        variant="outline"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(code)
            setCopied(true)
            toast.success("Code copied")
          } catch {
            toast.error("Copy it by hand; the clipboard is blocked")
          }
        }}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  )
}

function NewCode({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [role, setRole] = useState("viewer")
  const [uses, setUses] = useState("1")
  const [days, setDays] = useState("30")
  const [email, setEmail] = useState("")
  const [note, setNote] = useState("")
  const [send, setSend] = useState(false)
  const [made, setMade] = useState<Code | null>(null)

  const usesN = Number(uses)
  const daysN = Number(days)
  const emailOk = !email.trim() || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())
  const ok = Number.isInteger(usesN) && usesN >= 1 && usesN <= 10000 && (!days || (Number.isInteger(daysN) && daysN >= 1 && daysN <= 365)) && emailOk

  const create = useMutation({
    mutationFn: async () =>
      (await api.post<Code>(`${VIDEO_ADMIN}/beta/codes`, {
        role,
        max_uses: usesN,
        days: days ? daysN : null,
        email: email.trim() || null,
        note: note.trim(),
        send: send && Boolean(email.trim()),
      })).data,
    onSuccess: (c) => {
      setMade(c)
      qc.invalidateQueries({ queryKey: [KEY] })
    },
    onError: (err) => toast.error(detail(err, "The code could not be created")),
  })

  if (made?.code) {
    return (
      <Modal open onClose={onClose} size="sm" title="Invite code created" footer={<div className="flex justify-end"><Button onClick={onClose}>Done</Button></div>}>
        <p className="mb-3 text-sm text-slate-600">This is the only time the full code is shown. Copy it now; the list keeps only the last four characters.</p>
        <CopyCode code={made.code} />
        <p className="mt-3 text-xs text-slate-500">
          {humanise(made.role)} code · {made.max_uses} use{made.max_uses === 1 ? "" : "s"} · {made.expires_at ? `expires ${when(made.expires_at)}` : "never expires"}
          {send && made.email ? ` · emailed to ${made.email}` : ""}
        </p>
      </Modal>
    )
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="New invite code"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={create.isPending}>Cancel</Button>
          <Button onClick={() => create.mutate()} disabled={!ok || create.isPending}>{create.isPending ? "Creating…" : "Create code"}</Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Role">
            <Select value={role} onChange={setRole} options={[{ value: "viewer", label: "Viewer" }, { value: "creator", label: "Creator" }]} />
          </Field>
          <Field label="Uses" hint="1 to 10,000">
            <Input type="number" min={1} max={10000} value={uses} onChange={(e) => setUses(e.target.value)} />
          </Field>
          <Field label="Valid for (days)" hint="Empty for no expiry">
            <Input type="number" min={1} max={365} value={days} onChange={(e) => setDays(e.target.value)} />
          </Field>
        </div>
        <Field label="Only for this email" error={emailOk ? undefined : "Enter a valid email address."} hint="Optional. Leave empty for a code anyone can use.">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Note" hint="For your records, like who asked for it.">
          <Input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <ToggleField label="Email the code" hint={email.trim() ? `Sends the invite email to ${email.trim()}.` : "Add an email above to send it."} checked={send && Boolean(email.trim())} onChange={setSend} disabled={!email.trim()} />
      </div>
    </Modal>
  )
}

export default function InviteCodes() {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const canAct = useCanAct("admin.beta")
  const [creating, setCreating] = useState(false)
  const list = usePagedList<Code>(KEY, `${VIDEO_ADMIN}/beta/codes`, {}, 100)

  const revoke = useMutation({
    mutationFn: async (id: number) => (await api.post(`${VIDEO_ADMIN}/beta/codes/${id}/revoke`)).data,
    onSuccess: () => {
      toast.success("Code revoked")
      qc.invalidateQueries({ queryKey: [KEY] })
    },
    onError: (err) => toast.error(detail(err, "The code could not be revoked")),
  })

  async function ask(c: Code) {
    const ok = await confirm({
      title: `Revoke the code ending ${c.hint}?`,
      message: "Nobody can use it after this. Accounts already made with it are not affected.",
      confirmLabel: "Revoke",
      variant: "destructive",
    })
    if (ok) revoke.mutate(c.id)
  }

  return (
    <>
      <PageHeader
        title="Invite codes"
        subtitle="Codes for signing up and opening a channel during the beta"
        actions={canAct ? <Button onClick={() => setCreating(true)}><Plus size={15} /> New code</Button> : undefined}
      />
      <DataTable
        label="Invite codes"
        loading={list.isLoading}
        rows={list.rows}
        rowKey={(r) => r.id}
        serverTotal={list.total}
        onServerPage={list.onServerPage}
        pageSize={list.pageSize}
        unitLabel="codes"
        emptyTitle="No invite codes yet"
        columns={[
          { key: "code", header: "Code", render: (r) => <span className="font-num font-semibold text-navy">…{r.hint}</span> },
          { key: "role", header: "Role", render: (r) => <Badge color={r.role === "creator" ? "purple" : "slate"}>{humanise(r.role)}</Badge> },
          { key: "uses", header: "Used", align: "right", render: (r) => <span className="font-num">{r.used} / {r.max_uses}</span> },
          { key: "for", header: "For", render: (r) => <span className="text-slate-600">{r.email ?? "Anyone"}{r.note ? ` · ${r.note}` : ""}</span> },
          { key: "expires", header: "Expires", render: (r) => <span className="text-slate-500">{r.expires_at ? when(r.expires_at) : "Never"}</span> },
          { key: "state", header: "State", render: (r) => { const s = state(r); return <Badge color={s.color}>{s.label}</Badge> } },
          { key: "created", header: "Created", render: (r) => <span className="text-slate-500">{relative(r.created_at)}</span> },
          {
            key: "actions",
            header: "",
            srHeader: "Actions",
            align: "right",
            render: (r) =>
              canAct && !r.revoked_at ? (
                <Button size="sm" variant="ghost" className="text-red-700" onClick={() => ask(r)} disabled={revoke.isPending}>Revoke</Button>
              ) : null,
          },
        ]}
      />
      {creating && <NewCode onClose={() => setCreating(false)} />}
    </>
  )
}
