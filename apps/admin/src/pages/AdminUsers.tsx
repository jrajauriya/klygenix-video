import { useCallback, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Shield, UserPlus, Users as UsersIcon } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import {
  Badge, Button, DataTable, Drawer, DrawerFooter, Field, Input, PageHeader,
  RoleEditor, Select, StatCard, Switch, Tabs, useConfirm,
} from "@klygenixvideo/ui"
import type { AccessActions } from "@klygenixvideo/ui"

interface Member {
  id: number
  name: string
  email: string
  role: string
  is_active: boolean
  products: string[]
  phone: string | null
}

interface TeamInfo {
  max_users: number
  current_count: number
}

const ROLES = [
  { value: "user", label: "User", hint: "Sees what the access matrix allows" },
  { value: "admin", label: "Admin", hint: "Everything except the owner's own account" },
]

const BLANK = { name: "", email: "", role: "user", phone: "" }

export default function AdminUsers() {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [tab, setTab] = useState("people")
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Member | null>(null)
  const [form, setForm] = useState(BLANK)
  const [access, setAccess] = useState<AccessActions | null>(null)
  const onAccessActions = useCallback((a: AccessActions) => setAccess(a), [])

  const { data: members = [], isLoading } = useQuery<Member[]>({
    queryKey: ["admin-team"],
    queryFn: async () => (await api.get("/api/admin/team")).data,
  })
  const { data: info } = useQuery<TeamInfo>({
    queryKey: ["admin-team-info"],
    queryFn: async () => (await api.get("/api/admin/team/info")).data,
  })

  const active = useMemo(() => members.filter((m) => m.is_active).length, [members])
  const seatsLeft = (info?.max_users ?? 0) - (info?.current_count ?? 0)

  function close() {
    setOpen(false)
    setEditing(null)
    setForm(BLANK)
  }

  const add = useMutation({
    mutationFn: async () =>
      (
        await api.post("/api/admin/team", {
          name: form.name,
          email: form.email,
          role: form.role,
          phone: form.phone || null,
        })
      ).data,
    onSuccess: (d: { welcome_email_sent: boolean; message: string }) => {
      qc.invalidateQueries({ queryKey: ["admin-team"] })
      qc.invalidateQueries({ queryKey: ["admin-team-info"] })
      if (d.welcome_email_sent) toast.success(d.message)
      else toast.error(d.message, { duration: 15_000 })
      close()
    },
    onError: (err: { response?: { data?: { detail?: string } } }) =>
      toast.error(err?.response?.data?.detail ?? "That operator could not be added."),
  })

  const update = useMutation({
    mutationFn: async (body: Partial<Member>) =>
      (await api.patch(`/api/admin/team/${editing?.id ?? body.id}`, body)).data,
    onSuccess: (d: { message: string }) => {
      qc.invalidateQueries({ queryKey: ["admin-team"] })
      toast.success(d.message)
      close()
    },
    onError: (err: { response?: { data?: { detail?: string } } }) =>
      toast.error(err?.response?.data?.detail ?? "That change could not be saved."),
  })

  const deactivate = useMutation({
    mutationFn: async (id: number) => (await api.delete(`/api/admin/team/${id}`)).data,
    onSuccess: (d: { message: string }) => {
      qc.invalidateQueries({ queryKey: ["admin-team"] })
      qc.invalidateQueries({ queryKey: ["admin-team-info"] })
      toast.success(d.message)
      close()
    },
    onError: (err: { response?: { data?: { detail?: string } } }) =>
      toast.error(err?.response?.data?.detail ?? "That operator could not be removed."),
  })

  return (
    <>
      <PageHeader
        title="Users & Roles"
        subtitle="Who operates this console, and what each of them can open"
        actions={
          tab === "people" ? (
            <Button onClick={() => setOpen(true)} disabled={seatsLeft <= 0}>
              <UserPlus size={16} /> Add operator
            </Button>
          ) : access?.dirty ? (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => access.reset()}>
                Reset to defaults
              </Button>
              <Button onClick={() => access.save()} disabled={access.saving}>
                {access.saving ? "Saving…" : "Save access"}
              </Button>
            </div>
          ) : undefined
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Operators" value={String(members.length)} size="sm" />
        <StatCard label="Active" value={String(active)} size="sm" />
        <StatCard
          label="Seats left"
          value={info ? String(Math.max(seatsLeft, 0)) : "—"}
          size="sm"
          accent={seatsLeft <= 0 ? "red" : "brand"}
        />
      </div>

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { key: "people", label: "People", icon: <UsersIcon size={15} /> },
          { key: "access", label: "Screen access", icon: <Shield size={15} /> },
        ]}
      />

      {tab === "people" && (
        <DataTable<Member>
          loading={isLoading}
          rows={members}
          rowKey={(m) => m.id}
          unitLabel="operators"
          emptyTitle="No operators yet"
          emptyDescription="Everyone here can open the platform console. Add them deliberately."
          onRowClick={(m) => {
            setEditing(m)
            setForm({ name: m.name, email: m.email, role: m.role, phone: m.phone ?? "" })
            setOpen(true)
          }}
          columns={[
            {
              key: "name",
              header: "Operator",
              sortValue: (m) => m.name,
              render: (m) => (
                <div>
                  <b>{m.name}</b>
                  <span className="ml-2 text-xs text-slate-400">{m.email}</span>
                </div>
              ),
            },
            {
              key: "role",
              header: "Role",
              render: (m) => (
                <Badge color={m.role === "admin" ? "brand" : "slate"}>
                  {ROLES.find((r) => r.value === m.role)?.label ?? m.role}
                </Badge>
              ),
            },
            {
              key: "phone",
              header: "Phone",
              render: (m) => m.phone ?? "—",
            },
            {
              key: "is_active",
              header: "Status",
              render: (m) => (
                <Badge color={m.is_active ? "green" : "slate"}>
                  {m.is_active ? "Active" : "Deactivated"}
                </Badge>
              ),
            },
          ]}
        />
      )}

      {tab === "access" && (
        <RoleEditor app="admin" canEdit onActions={onAccessActions} />
      )}

      <Drawer
        open={open}
        onClose={close}
        title={editing ? "Edit operator" : "Add an operator"}
        subtitle={
          editing
            ? undefined
            : "A password is generated and emailed to them. Nobody here is shown it."
        }
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="Name" required className="col-span-2">
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <Field label="Email" required className="col-span-2">
            <Input
              type="email"
              value={form.email}
              disabled={Boolean(editing)}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </Field>
          <Field label="Role" hint={ROLES.find((r) => r.value === form.role)?.hint}>
            <Select
              value={form.role}
              onChange={(v) => setForm({ ...form, role: v })}
              options={ROLES.map((r) => ({ value: r.value, label: r.label }))}
            />
          </Field>
          <Field label="Phone">
            <Input
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </Field>
          {editing && (
            <div className="col-span-2 flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
              <span className="text-sm text-slate-700">Can sign in</span>
              <Switch
                checked={editing.is_active}
                onChange={(v: boolean) =>
                  update.mutate({ id: editing.id, is_active: v })
                }
              />
            </div>
          )}
        </div>
        <DrawerFooter
          onCancel={close}
          save={{
            label: editing ? "Save" : "Add and email them",
            pending: add.isPending || update.isPending,
            disabled: !form.name.trim() || !form.email.trim(),
            onClick: () =>
              editing
                ? update.mutate({
                    name: form.name,
                    role: form.role,
                    phone: form.phone || null,
                  })
                : add.mutate(),
          }}
          destructive={
            editing && editing.is_active
              ? {
                  label: "Deactivate",
                  onClick: async () => {
                    const ok = await confirm({
                      title: "Deactivate this operator?",
                      message:
                        "They stop being able to sign in. The account stays, so what they did is still attributable.",
                      confirmLabel: "Deactivate",
                      variant: "destructive",
                    })
                    if (ok) deactivate.mutate(editing.id)
                  },
                }
              : undefined
          }
        />
      </Drawer>
    </>
  )
}
