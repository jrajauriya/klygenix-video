import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Plus, Send } from "lucide-react"
import {
  Badge, Button, DataTable, Drawer, DrawerFooter, Field, Input, ListPage,
  PageHeader, Select, Switch, useConfirm,
} from "@klygenixvideo/ui"
import { api } from "@klygenixvideo/auth"

interface Config {
  id: number
  config_type: string
  tenant_id: number | null
  smtp_host: string
  smtp_port: number
  smtp_username: string
  from_email: string
  from_name: string
  use_tls: boolean
  is_active: boolean
  has_password: boolean
}

const BLANK = {
  config_type: "global",
  tenant_id: "",
  smtp_host: "",
  smtp_port: "587",
  smtp_username: "",
  smtp_password: "",
  from_email: "",
  from_name: "Klygenix",
  use_tls: true,
  is_active: true,
}

export default function EmailConfigPage() {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState({ ...BLANK })

  const { data: configs = [], isLoading } = useQuery<Config[]>({
    queryKey: ["admin-email-configs"],
    queryFn: async () => (await api.get("/api/admin/email-configs")).data,
  })

  useEffect(() => {
    if (!open) return
    if (editingId === null) {
      setForm({ ...BLANK })
      return
    }
    const row = configs.find((c) => c.id === editingId)
    if (row) {
      setForm({
        config_type: row.config_type,
        tenant_id: row.tenant_id ? String(row.tenant_id) : "",
        smtp_host: row.smtp_host,
        smtp_port: String(row.smtp_port),
        smtp_username: row.smtp_username,
        smtp_password: "",
        from_email: row.from_email,
        from_name: row.from_name,
        use_tls: row.use_tls,
        is_active: row.is_active,
      })
    }
  }, [open, editingId, configs])

  const done = () => {
    queryClient.invalidateQueries({ queryKey: ["admin-email-configs"] })
    setOpen(false)
    setEditingId(null)
  }

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        config_type: form.config_type,
        tenant_id: form.tenant_id ? Number(form.tenant_id) : null,
        smtp_host: form.smtp_host,
        smtp_port: Number(form.smtp_port) || 587,
        smtp_username: form.smtp_username,
        smtp_password: form.smtp_password || null,
        from_email: form.from_email,
        from_name: form.from_name,
        use_tls: form.use_tls,
        is_active: form.is_active,
      }
      const { data } = editingId
        ? await api.patch(`/api/admin/email-configs/${editingId}`, body)
        : await api.post("/api/admin/email-configs", body)
      return data
    },
    onSuccess: () => {
      toast.success(editingId ? "Configuration updated" : "Configuration added")
      done()
    },
    onError: (err: { response?: { data?: { detail?: string } } }) => {
      toast.error(err?.response?.data?.detail ?? "Could not save this configuration.")
    },
  })

  const remove = useMutation({
    mutationFn: async (id: number) => (await api.delete(`/api/admin/email-configs/${id}`)).data,
    onSuccess: () => {
      toast.success("Configuration removed")
      done()
    },
  })

  const probe = useMutation({
    mutationFn: async ({ id, recipient }: { id: number; recipient: string }) =>
      (await api.post(`/api/admin/email-configs/${id}/test`, { recipient })).data,
    onSuccess: (r: { success: boolean }) => {
      if (r.success) toast.success("Test message sent")
      else toast.error("The server accepted the request but did not send.")
    },
    onError: (err: { response?: { data?: { detail?: string } } }) => {
      toast.error(err?.response?.data?.detail ?? "Could not reach that SMTP server.")
    },
  })

  return (
    <ListPage>
      <PageHeader
        title="Email"
        subtitle="Where reminders and welcome messages are sent from."
        actions={
          <Button
            onClick={() => {
              setEditingId(null)
              setOpen(true)
            }}
          >
            <Plus size={16} /> Add configuration
          </Button>
        }
      />

      <DataTable<Config>
        loading={isLoading}
        rows={configs}
        rowKey={(c) => c.id}
        unitLabel="configurations"
        emptyTitle="No SMTP configured"
        emptyDescription="Until one exists, a dunning run defers its email instead of sending."
        onRowClick={(row) => {
          setEditingId(row.id)
          setOpen(true)
        }}
        columns={[
          {
            key: "scope",
            header: "Scope",
            render: (c) =>
              c.tenant_id ? (
                <Badge color="blue">Tenant {c.tenant_id}</Badge>
              ) : (
                <Badge color="slate">Platform default</Badge>
              ),
          },
          { key: "host", header: "Server", render: (c) => `${c.smtp_host}:${c.smtp_port}` },
          { key: "from", header: "From", render: (c) => `${c.from_name} <${c.from_email}>` },
          {
            key: "password",
            header: "Password",
            render: (c) =>
              c.has_password ? (
                <Badge color="green">Set</Badge>
              ) : (
                <Badge color="red">Missing</Badge>
              ),
          },
          {
            key: "active",
            header: "Status",
            render: (c) =>
              c.is_active ? <Badge color="green">Active</Badge> : <Badge color="slate">Off</Badge>,
          },
          {
            key: "test",
            header: "",
            srHeader: "Test",
            align: "right",
            render: (c) => (
              <Button
                size="sm"
                variant="outline"
                disabled={!c.has_password || probe.isPending}
                onClick={(e) => {
                  e.stopPropagation()
                  const recipient = window.prompt(
                    "Send a test message to which address?\nUse a catch-all, never a real customer.",
                  )
                  if (recipient) probe.mutate({ id: c.id, recipient })
                }}
              >
                <Send size={14} /> Test
              </Button>
            ),
          },
        ]}
      />

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={editingId ? "Edit configuration" : "Add configuration"}
        subtitle="A tenant without its own row falls back to the platform default."
        width="md"
      >
        <div className="space-y-3">
          <Field label="Scope" required>
            <Select
              value={form.config_type}
              onChange={(v) => setForm({ ...form, config_type: v })}
              options={[
                { value: "global", label: "Platform default" },
                { value: "tenant", label: "One tenant" },
              ]}
            />
          </Field>
          {form.config_type === "tenant" && (
            <Field label="Tenant id" required>
              <Input
                value={form.tenant_id}
                inputMode="numeric"
                onChange={(e) => setForm({ ...form, tenant_id: e.target.value })}
              />
            </Field>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="SMTP host" required>
              <Input
                value={form.smtp_host}
                onChange={(e) => setForm({ ...form, smtp_host: e.target.value })}
                placeholder="smtp.example.com"
              />
            </Field>
            <Field label="Port" required>
              <Input
                value={form.smtp_port}
                inputMode="numeric"
                onChange={(e) => setForm({ ...form, smtp_port: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Username" required>
            <Input
              value={form.smtp_username}
              onChange={(e) => setForm({ ...form, smtp_username: e.target.value })}
            />
          </Field>
          <Field
            label="Password"
            hint={editingId ? "Leave empty to keep the stored one." : "Stored encrypted."}
          >
            <Input
              type="password"
              value={form.smtp_password}
              onChange={(e) => setForm({ ...form, smtp_password: e.target.value })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="From address" required>
              <Input
                value={form.from_email}
                onChange={(e) => setForm({ ...form, from_email: e.target.value })}
              />
            </Field>
            <Field label="From name">
              <Input
                value={form.from_name}
                onChange={(e) => setForm({ ...form, from_name: e.target.value })}
              />
            </Field>
          </div>
          <div className="flex items-center gap-6 pt-1">
            <Switch
              checked={form.use_tls}
              onChange={(v) => setForm({ ...form, use_tls: v })}
              label="Use TLS"
            />
            <Switch
              checked={form.is_active}
              onChange={(v) => setForm({ ...form, is_active: v })}
              label="Active"
            />
          </div>
        </div>

        <DrawerFooter
          onCancel={() => setOpen(false)}
          destructive={
            editingId
              ? {
                  label: "Remove",
                  onClick: async () => {
                    const ok = await confirm({
                      title: "Remove this configuration?",
                      message: "Anything relying on it falls back to the platform default.",
                      variant: "destructive",
                      confirmLabel: "Remove",
                    })
                    if (ok) remove.mutate(editingId)
                  },
                  pending: remove.isPending,
                }
              : undefined
          }
          save={{
            label: "Save",
            onClick: () => save.mutate(),
            pending: save.isPending,
            disabled:
              save.isPending || !form.smtp_host || !form.smtp_username || !form.from_email,
          }}
        />
      </Drawer>
    </ListPage>
  )
}
