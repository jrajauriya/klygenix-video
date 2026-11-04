import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Lock, RefreshCw, Save, Send } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { Button, Card, Field, Input, Select, useConfirm } from "@klygenixvideo/ui"
import { useHasPermission } from "@klygenixvideo/client"
import { STUDIO } from "../../lib/hooks"
import { detail, when } from "../../lib/format"
import type { Earnings, PayoutAccount } from "../../lib/types"
import { AccountStatusPill } from "./shared"
import { useT } from "../../i18n"

const BUSINESS_TYPES = [
  { value: "individual", label: "Individual" },
  { value: "proprietorship", label: "Sole proprietorship" },
  { value: "partnership", label: "Partnership" },
  { value: "private_limited", label: "Private limited company" },
  { value: "public_limited", label: "Public limited company" },
  { value: "llp", label: "LLP" },
  { value: "trust", label: "Trust" },
  { value: "society", label: "Society" },
  { value: "ngo", label: "NGO" },
]

const FIELD_LABEL: Record<string, string> = {
  legal_name: "Legal name",
  contact_name: "Contact name",
  email: "Email",
  phone: "Mobile",
  pan: "PAN",
  gstin: "GSTIN",
  address: "Address",
  beneficiary_name: "Name on the bank account",
  ifsc: "IFSC",
  account_number: "Account number",
  business_type: "Business type",
}

type Form = {
  business_type: string
  legal_name: string
  contact_name: string
  email: string
  phone: string
  pan: string
  gstin: string
  street1: string
  street2: string
  city: string
  state: string
  postal_code: string
  beneficiary_name: string
  ifsc: string
  account_number: string
}

function fromAccount(a: PayoutAccount | null): Form {
  return {
    business_type: a?.business_type ?? "individual",
    legal_name: a?.legal_name ?? "",
    contact_name: a?.contact_name ?? "",
    email: a?.email ?? "",
    phone: a?.phone ?? "",
    pan: a?.pan ?? "",
    gstin: a?.gstin ?? "",
    street1: a?.address?.street1 ?? "",
    street2: a?.address?.street2 ?? "",
    city: a?.address?.city ?? "",
    state: a?.address?.state ?? "",
    postal_code: a?.address?.postal_code ?? "",
    beneficiary_name: a?.beneficiary_name ?? "",
    ifsc: a?.ifsc ?? "",
    account_number: "",
  }
}

function ReadOnly({ a }: { a: PayoutAccount }) {
  const t = useT()
  const addr = a.address ?? {}
  const rows: [string, string | null | undefined][] = [
    ["Business type", (() => { const label = BUSINESS_TYPES.find((b) => b.value === a.business_type)?.label; return label ? t(label) : a.business_type })()],
    ["Legal name", a.legal_name],
    ["Contact", [a.contact_name, a.email, a.phone].filter(Boolean).join(" · ")],
    ["PAN", a.pan],
    ["GSTIN", a.gstin || t("Not registered")],
    ["Address", [addr.street1, addr.street2, addr.city, addr.state, addr.postal_code].filter(Boolean).join(", ")],
    ["Bank account", `${a.beneficiary_name ?? ""} · ${a.ifsc ?? ""} · •••• ${a.account_last4 ?? "—"}`],
  ]
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt className="text-xs text-slate-500">{t(k)}</dt>
          <dd className="mt-0.5 break-words text-sm text-slate-800">{v || "—"}</dd>
        </div>
      ))}
    </dl>
  )
}

export function PayoutSetup({ data }: { data: Earnings }) {
  const t = useT()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const canEdit = useHasPermission("video.earnings", "full")
  const account = data.account
  const editable = account ? account.editable : true
  const [form, setForm] = useState<Form>(() => fromAccount(account))
  const [problems, setProblems] = useState<string[]>(data.problems)
  const [busy, setBusy] = useState<"save" | "submit" | "refresh" | null>(null)
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const refresh = () => qc.invalidateQueries({ queryKey: ["studio-earnings"] })

  function body() {
    const out: Record<string, unknown> = {
      business_type: form.business_type,
      legal_name: form.legal_name,
      contact_name: form.contact_name,
      email: form.email,
      phone: form.phone.replace(/\s+/g, ""),
      pan: form.pan.toUpperCase(),
      gstin: form.gstin.toUpperCase(),
      address: { street1: form.street1, street2: form.street2, city: form.city, state: form.state, postal_code: form.postal_code },
      beneficiary_name: form.beneficiary_name,
      ifsc: form.ifsc.toUpperCase(),
    }
    const number = form.account_number.replace(/\s+/g, "")
    if (number) out.account_number = number
    return out
  }

  async function save(quiet = false): Promise<boolean> {
    setBusy("save")
    try {
      const { data: res } = await api.put<{ account: PayoutAccount; problems: string[] }>(`${STUDIO}/earnings/account`, body())
      setProblems(res.problems)
      setForm((f) => ({ ...f, account_number: "" }))
      if (!quiet) toast.success(res.problems.length ? t("Saved. A few details are still missing.") : t("Saved. You can submit it now."))
      refresh()
      return true
    } catch (err) {
      toast.error(detail(err, t("Could not save your payout details")))
      return false
    } finally {
      setBusy(null)
    }
  }

  async function submit() {
    const ok = await confirm({
      title: t("Submit your payout details?"),
      message: t("They go to our payment partner to be checked. You cannot change them while they are being checked."),
      confirmLabel: t("Submit"),
    })
    if (!ok) return
    if (!(await save(true))) return
    setBusy("submit")
    try {
      const { data: res } = await api.post<{ account: PayoutAccount }>(`${STUDIO}/earnings/account/submit`)
      const s = res.account.status
      if (s === "needs_clarification") toast.warning(t("The payment partner needs a few changes. See what they asked for above the form."))
      else toast.success(s === "activated" ? t("Payouts are active. You can take money now.") : t("Submitted. We will let you know when it is checked."))
      refresh()
    } catch (err) {
      toast.error(detail(err, t("Could not submit your payout details")))
    } finally {
      setBusy(null)
    }
  }

  async function check() {
    setBusy("refresh")
    try {
      await api.post(`${STUDIO}/earnings/account/refresh`)
      toast.success(t("Status updated"))
      refresh()
    } catch (err) {
      toast.error(detail(err, t("Could not check the status")))
    } finally {
      setBusy(null)
    }
  }

  const disabled = !editable || !canEdit || busy !== null
  const requirements = account?.requirements ?? []

  return (
    <Card className="p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex flex-wrap items-center gap-2 text-sm font-bold text-navy">
            {t("Payout setup")} <AccountStatusPill status={account?.status} />
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {t("Where we send your share. Payments go through our payment partner, which checks your PAN and bank account before money can move.")}
          </p>
          {account?.submitted_at && (
            <p className="mt-1 text-xs text-slate-500">
              {account.activated_at
                ? t("Submitted {date} · active since {since}", { date: when(account.submitted_at, true), since: when(account.activated_at) })
                : t("Submitted {date}", { date: when(account.submitted_at, true) })}
            </p>
          )}
        </div>
        {account?.gateway_account_id && ["submitted", "under_review", "needs_clarification"].includes(account.status) && (
          <Button size="sm" variant="outline" onClick={check} disabled={busy !== null}>
            <RefreshCw size={13} /> {busy === "refresh" ? t("Checking…") : t("Check status")}
          </Button>
        )}
      </div>

      {requirements.length > 0 && (
        <div role="alert" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900">
          <p className="font-semibold">{t("The payment partner asked for changes")}</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {requirements.map((r, i) => (
              <li key={`${r.field}-${i}`}><b>{FIELD_LABEL[r.field] ? t(FIELD_LABEL[r.field]) : r.field}:</b> {r.reason}</li>
            ))}
          </ul>
        </div>
      )}

      {!editable && account ? (
        <ReadOnly a={account} />
      ) : (
        <div className="space-y-5">
          <fieldset className="space-y-4">
            <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{t("You")}</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("Business type")}>
                <Select value={form.business_type} onChange={(v) => setForm((f) => ({ ...f, business_type: v }))} options={BUSINESS_TYPES.map((o) => ({ ...o, label: t(o.label) }))} disabled={disabled} aria-label={t("Business type")} />
              </Field>
              <Field label={t("Legal name")} hint={t("Exactly as on your PAN")}>
                <Input value={form.legal_name} maxLength={200} onChange={set("legal_name")} disabled={disabled} autoComplete="name" />
              </Field>
              <Field label={t("Contact name")}>
                <Input value={form.contact_name} maxLength={120} onChange={set("contact_name")} disabled={disabled} />
              </Field>
              <Field label={t("Email")}>
                <Input type="email" value={form.email} maxLength={200} onChange={set("email")} disabled={disabled} autoComplete="email" />
              </Field>
              <Field label={t("Mobile")} hint={t("10 digits")}>
                <Input type="tel" value={form.phone} maxLength={20} onChange={set("phone")} disabled={disabled} autoComplete="tel" />
              </Field>
              <Field label="PAN" hint={t("Like ABCDE1234F")}>
                <Input value={form.pan} maxLength={10} onChange={set("pan")} disabled={disabled} className="uppercase" />
              </Field>
              <Field label="GSTIN" hint={t("Leave empty if you are not registered for GST")}>
                <Input value={form.gstin} maxLength={15} onChange={set("gstin")} disabled={disabled} className="uppercase" />
              </Field>
            </div>
          </fieldset>

          <fieldset className="space-y-4">
            <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{t("Address")}</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("Street")}>
                <Input value={form.street1} onChange={set("street1")} disabled={disabled} autoComplete="address-line1" />
              </Field>
              <Field label={t("Area or landmark")}>
                <Input value={form.street2} onChange={set("street2")} disabled={disabled} autoComplete="address-line2" />
              </Field>
              <Field label={t("City")}>
                <Input value={form.city} onChange={set("city")} disabled={disabled} autoComplete="address-level2" />
              </Field>
              <Field label={t("State")}>
                <Input value={form.state} onChange={set("state")} disabled={disabled} autoComplete="address-level1" />
              </Field>
              <Field label={t("PIN code")}>
                <Input value={form.postal_code} maxLength={6} inputMode="numeric" onChange={set("postal_code")} disabled={disabled} autoComplete="postal-code" />
              </Field>
            </div>
          </fieldset>

          <fieldset className="space-y-4">
            <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{t("Bank account")}</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("Name on the bank account")}>
                <Input value={form.beneficiary_name} maxLength={120} onChange={set("beneficiary_name")} disabled={disabled} />
              </Field>
              <Field label="IFSC" hint={t("Like HDFC0001234")}>
                <Input value={form.ifsc} maxLength={11} onChange={set("ifsc")} disabled={disabled} className="uppercase" />
              </Field>
              <Field
                label={t("Account number")}
                hint={account?.account_last4 ? t("On file: •••• {last4}. Type a new number only to change it.", { last4: account.account_last4 }) : t("6 to 20 digits")}
              >
                <Input value={form.account_number} maxLength={24} inputMode="numeric" autoComplete="off" onChange={set("account_number")} disabled={disabled} />
              </Field>
            </div>
            <p className="flex items-start gap-1.5 text-xs text-slate-500">
              <Lock size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
              {t("Your account number is stored sealed and only passed to the payment partner. We show only its last 4 digits, even to you.")}
            </p>
          </fieldset>

          {account && problems.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-700">
              <p className="font-semibold text-navy">{t("Before you can submit")}</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {problems.map((p) => <li key={p}>{p}</li>)}
              </ul>
            </div>
          )}

          {canEdit ? (
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-4">
              <Button variant="outline" onClick={() => save()} disabled={disabled}>
                <Save size={14} /> {busy === "save" ? t("Saving…") : t("Save")}
              </Button>
              <Button onClick={submit} disabled={disabled}>
                <Send size={14} /> {busy === "submit" ? t("Submitting…") : t("Submit for checking")}
              </Button>
            </div>
          ) : (
            <p className="border-t border-slate-100 pt-4 text-sm text-slate-500">{t("Only the channel owner or someone with full access to earnings can change payout details.")}</p>
          )}
        </div>
      )}
    </Card>
  )
}
