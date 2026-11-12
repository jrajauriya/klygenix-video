import { useEffect, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { api } from "@klygenixvideo/auth"
import { Button, Card, Field, Input } from "@klygenixvideo/ui"
import type { Tenant } from "@klygenixvideo/types"

const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/

function fromTenant(t: Tenant) {
  const s = t.settings || {}
  const g = s.grievance_officer || {}
  return {
    address: t.address || "", city: t.city || "", state: t.state || "", pin_code: t.pin_code || "",
    gst_number: t.gst_number || "", email: t.email || "", phone: t.phone || "",
    cin: s.cin || "", privacy_email: s.privacy_email || "", legal_email: s.legal_email || "",
    g_name: g.name || "", g_email: g.email || "", g_phone: g.phone || "",
  }
}

export function TenantCompany({ tenant }: { tenant: Tenant }) {
  const qc = useQueryClient()
  const platform = tenant.slug === "klygenix-video-admin"
  const [f, setF] = useState(() => fromTenant(tenant))
  useEffect(() => setF(fromTenant(tenant)), [tenant])
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value })
  const gstBad = f.gst_number !== "" && !GSTIN.test(f.gst_number.toUpperCase())

  const save = useMutation({
    mutationFn: async () => (await api.patch(`/api/admin/tenants/${tenant.id}`, {
      address: f.address, city: f.city, state: f.state, pin_code: f.pin_code, gst_number: f.gst_number.toUpperCase(),
      email: f.email, phone: f.phone,
      ...(platform ? { legal: { cin: f.cin, privacy_email: f.privacy_email, legal_email: f.legal_email,
        grievance_officer: { name: f.g_name, email: f.g_email, phone: f.g_phone } } } : {}),
    })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-tenant", String(tenant.id)] })
      toast.success("Saved")
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail ?? "Could not save"),
  })

  return (
    <Card className="p-5">
      <div className="grid max-w-2xl grid-cols-2 gap-4">
        <div className="col-span-2">
          <Field label="Registered address"><Input value={f.address} onChange={set("address")} /></Field>
        </div>
        <Field label="City"><Input value={f.city} onChange={set("city")} /></Field>
        <Field label="State"><Input value={f.state} onChange={set("state")} /></Field>
        <Field label="PIN code"><Input value={f.pin_code} onChange={set("pin_code")} inputMode="numeric" /></Field>
        <Field label="GSTIN" error={gstBad ? "15 characters, e.g. 27AAACK1234A1Z5" : undefined}>
          <Input value={f.gst_number} onChange={set("gst_number")} />
        </Field>
        <Field label="Support email"><Input type="email" value={f.email} onChange={set("email")} /></Field>
        <Field label="Phone"><Input value={f.phone} onChange={set("phone")} /></Field>
      </div>
      {platform && (
        <>
          <h3 className="mt-6 text-sm font-semibold">Published on the legal pages</h3>
          <p className="mt-1 text-xs text-slate-500">Terms, Privacy, Refunds, Contact and Grievance Officer show these instead of placeholders. The IT Rules require a published grievance officer.</p>
          <div className="mt-3 grid max-w-2xl grid-cols-2 gap-4">
            <Field label="CIN"><Input value={f.cin} onChange={set("cin")} /></Field>
            <Field label="Privacy email"><Input type="email" value={f.privacy_email} onChange={set("privacy_email")} /></Field>
            <Field label="Legal email"><Input type="email" value={f.legal_email} onChange={set("legal_email")} /></Field>
            <div />
            <Field label="Grievance officer name"><Input value={f.g_name} onChange={set("g_name")} /></Field>
            <Field label="Grievance officer email"><Input type="email" value={f.g_email} onChange={set("g_email")} /></Field>
            <Field label="Grievance officer phone"><Input value={f.g_phone} onChange={set("g_phone")} /></Field>
          </div>
        </>
      )}
      <div className="mt-5">
        <Button onClick={() => save.mutate()} disabled={save.isPending || gstBad}>{save.isPending ? "Saving…" : "Save"}</Button>
      </div>
    </Card>
  )
}
