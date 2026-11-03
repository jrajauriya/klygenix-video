import { useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { api } from "@klygenixvideo/auth"
import { Button, Card, Field, Input, PageHeader, Tabs, useConfirm } from "@klygenixvideo/ui"
import type { Tenant } from "@klygenixvideo/types"
import { TenantFeaturesEditor } from "./TenantFeaturesEditor"
import { TenantModules } from "./TenantModules"
import { TenantPayments } from "./TenantPayments"

const BLANK = {
  name: "", slug: "", plan: "standard", owner_email: "", owner_name: "",
  city: "", state: "", phone: "", max_users: 5, products: ["video"],
}

export default function TenantDetail() {
  const { tenantId } = useParams()
  const isNew = tenantId === "new"
  const navigate = useNavigate()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [tab, setTab] = useState("details")
  const [form, setForm] = useState(BLANK)

  const { data: tenant } = useQuery<Tenant>({
    queryKey: ["admin-tenant", tenantId],
    queryFn: async () => (await api.get(`/api/admin/tenants/${tenantId}`)).data,
    enabled: !isNew,
  })

  const save = useMutation({
    mutationFn: async () => {
      if (isNew) return (await api.post("/api/admin/tenants", form)).data
      return (await api.patch(`/api/admin/tenants/${tenantId}`, {
        name: form.name || tenant?.name,
        max_users: form.max_users,
      })).data
    },
    onSuccess: (d: any) => {
      qc.invalidateQueries({ queryKey: ["admin-tenants"] })
      if (d?.owner_password) {
        toast.success(`Owner password: ${d.owner_password}`, { duration: 30_000 })
      } else {
        toast.success("Saved")
      }
      navigate("/tenants")
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail ?? "Could not save"),
  })

  const resetOwner = useMutation({
    mutationFn: async () =>
      (await api.post(`/api/admin/tenants/${tenantId}/reset-owner-password`)).data,
    onSuccess: (d: { email_sent: boolean; message: string }) =>
      d.email_sent
        ? toast.success(d.message)
        : toast.error(d.message, { duration: 15_000 }),
    onError: (err: any) =>
      toast.error(err?.response?.data?.detail ?? "That could not be reset."),
  })

  return (
    <>
      <PageHeader
        title={isNew ? "Open an account" : (tenant?.name ?? "Account")}
        subtitle={isNew ? "Creates the tenant, its owner and its access rows" : tenant?.slug}
      />

      {!isNew && (
        <Tabs
          active={tab}
          onChange={setTab}
          tabs={[
            { key: "details", label: "Details" },
            { key: "modules", label: "Products" },
            { key: "features", label: "Features" },
            { key: "payments", label: "Payments" },
          ]}
        />
      )}

      {(isNew || tab === "details") && (
        <Card className="p-5">
          <div className="grid max-w-2xl grid-cols-2 gap-4">
            <div className="col-span-2">
            <Field label="Account name">
              <Input
                value={form.name || tenant?.name || ""}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            </div>
            {isNew && (
              <>
                <Field label="Slug">
                  <Input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} />
                </Field>
                <Field label="Seats">
                  <Input
                    type="number"
                    value={String(form.max_users)}
                    onChange={(e) => setForm({ ...form, max_users: Number(e.target.value) })}
                  />
                </Field>
                <Field label="Owner name">
                  <Input value={form.owner_name} onChange={(e) => setForm({ ...form, owner_name: e.target.value })} />
                </Field>
                <Field label="Owner email">
                  <Input value={form.owner_email} onChange={(e) => setForm({ ...form, owner_email: e.target.value })} />
                </Field>
                <Field label="City">
                  <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
                </Field>
                <Field label="State">
                  <Input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
                </Field>
              </>
            )}
          </div>
          <div className="mt-5 flex gap-2">
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? "Saving…" : isNew ? "Create account" : "Save"}
            </Button>
            <Button variant="outline" onClick={() => navigate("/tenants")}>
              Cancel
            </Button>
            {!isNew && (
              <Button
                variant="outline"
                className="ml-auto"
                disabled={resetOwner.isPending}
                onClick={async () => {
                  const ok = await confirm({
                    title: "Reset the owner's password?",
                    message:
                      "A new password is generated and emailed to the owner. Their current one stops working immediately, and nobody here is shown the new one.",
                    confirmLabel: "Reset and email",
                    variant: "destructive",
                  })
                  if (ok) resetOwner.mutate()
                }}
              >
                Reset owner password
              </Button>
            )}
          </div>
        </Card>
      )}

      {!isNew && tab === "modules" && <TenantModules tenantId={Number(tenantId)} />}
      {!isNew && tab === "features" && <TenantFeaturesEditor tenantId={Number(tenantId)} />}
      {!isNew && tab === "payments" && <TenantPayments tenantId={Number(tenantId)} />}
    </>
  )
}
