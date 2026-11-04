import { useEffect, useMemo, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Copy, ExternalLink, KeyRound, LogOut, MailCheck, Undo2 } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { Badge, Button, Card, Field, Input, Modal, PageHeader, SectionHeading, Spinner, Textarea, cn, useConfirm } from "@klygenixvideo/ui"
import { toMinor } from "@klygenixvideo/client"
import { Row, Status, WEB_URL, detail, humanise, relative, useCanAct, when } from "../../lib/shared"
import { inr } from "../../components/money/shared"
import { AccountBadges } from "./SupportDesk"
import { EVENT_KIND, SUPPORT, type SupportAccount as Account, type SupportEvent, type SupportSession, type SupportUser } from "./shared"

function newKey(): string {
  const c = globalThis.crypto
  return c && "randomUUID" in c ? c.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

type ReasonAction = "sign-out" | "support-session"

const REASON_COPY: Record<ReasonAction, { title: string; hint: string; button: string; confirm: string; message: string }> = {
  "sign-out": {
    title: "Sign out everywhere",
    hint: "5 to 300 characters. Kept in the audit log.",
    button: "Sign out everywhere",
    confirm: "Sign this person out on every device?",
    message: "Every session they have, on the web, the apps and the TV, ends now. They can sign in again with their password.",
  },
  "support-session": {
    title: "Open a read-only support session",
    hint: "5 to 300 characters. Kept in the audit log and shown with the session.",
    button: "Open session",
    confirm: "Open a read-only session as this person?",
    message: "You get a short-lived token that sees what they see and cannot change anything. Opening it is recorded in the audit log.",
  },
}

function ReasonDialog({ action, busy, onClose, onSubmit }: { action: ReasonAction; busy: boolean; onClose: () => void; onSubmit: (reason: string) => void }) {
  const confirm = useConfirm()
  const [reason, setReason] = useState("")
  const copy = REASON_COPY[action]
  const ok = reason.trim().length >= 5
  async function go() {
    if (!ok) return
    const yes = await confirm({
      title: copy.confirm,
      message: copy.message,
      confirmLabel: copy.button,
      variant: action === "sign-out" ? "destructive" : "default",
    })
    if (yes) onSubmit(reason.trim())
  }
  return (
    <Modal
      open
      onClose={onClose}
      title={copy.title}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant={action === "sign-out" ? "destructive" : "default"} onClick={go} disabled={!ok || busy}>
            {busy ? "Working…" : copy.button}
          </Button>
        </div>
      }
    >
      <Field label="Reason" required hint={copy.hint}>
        <Textarea rows={3} value={reason} minLength={5} maxLength={300} onChange={(e) => setReason(e.target.value)} autoFocus />
      </Field>
    </Modal>
  )
}

function RefundDialog({ userId, event, onClose }: { userId: number; event: SupportEvent; onClose: () => void }) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [amount, setAmount] = useState("")
  const [reason, setReason] = useState("")
  const [key] = useState(newKey)
  const [busy, setBusy] = useState(false)
  const paid = event.amount_minor ?? 0
  const text = amount.trim()
  const minor = /^\d+(\.\d{1,2})?$/.test(text) ? toMinor(text, "INR") : null
  const amountError = text
    ? minor === null || minor <= 0 ? "Enter an amount, like 49 or 99.50." : paid && minor > paid ? `At most ${inr(paid)}.` : undefined
    : undefined
  const ready = reason.trim().length >= 3 && !amountError

  async function submit() {
    const label = minor ? inr(minor) : "everything still refundable"
    const ok = await confirm({
      title: `Refund ${label}?`,
      message: "The money goes back to the buyer and a credit note is issued. If the creator was already paid their share, it is recovered from their next payouts. This cannot be undone.",
      confirmLabel: "Refund",
      variant: "destructive",
    })
    if (!ok) return
    setBusy(true)
    try {
      const { data } = await api.post<{ status: string; amount_minor: number }>(`/api/video/admin/payments/${event.payment_id}/refund`, {
        amount_minor: minor ?? undefined,
        reason: reason.trim(),
        idempotency_key: key,
      })
      toast.success(`Refunded ${inr(data.amount_minor)} (${data.status})`)
      qc.invalidateQueries({ queryKey: ["admin-support-user", userId] })
      qc.invalidateQueries({ queryKey: ["admin-money-payments"] })
      qc.invalidateQueries({ queryKey: ["admin-money-refunds"] })
      onClose()
    } catch (err) {
      toast.error(detail(err, "Could not refund the payment"))
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Refund payment #${event.payment_id}`}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" onClick={submit} disabled={!ready || busy}>
            <Undo2 size={14} /> {busy ? "Refunding…" : "Refund"}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <dl className="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3 text-sm">
          <div><dt className="text-xs text-slate-500">For</dt><dd className="font-medium text-slate-800">{event.title}</dd></div>
          <div><dt className="text-xs text-slate-500">Paid</dt><dd className="font-num text-slate-800">{paid ? inr(paid) : "—"}</dd></div>
        </dl>
        <Field label="Amount to refund (₹)" error={amountError} hint="Leave empty to refund everything that is still refundable.">
          <Input value={amount} inputMode="decimal" onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Reason" required hint="3 to 200 characters. Kept with the refund and on the credit note.">
          <Textarea rows={2} value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}

function useNow(ms: number) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

function SessionCard({ session, onEnd, ending }: { session: SupportSession; onEnd: () => void; ending: boolean }) {
  const now = useNow(15_000)
  const expired = new Date(session.expires_at).getTime() <= now
  async function copy() {
    try {
      await navigator.clipboard.writeText(session.access_token)
      toast.success("Token copied")
    } catch {
      toast.error("The browser would not copy the token")
    }
  }
  return (
    <div className={cn("rounded-lg border p-3.5", expired ? "border-slate-200 bg-slate-50" : "border-brand/30 bg-brand-50")} role="status">
      <div className="flex flex-wrap items-center gap-2">
        <KeyRound size={15} className="text-brand" aria-hidden="true" />
        <span className="font-semibold text-navy">Support session #{session.session_id}</span>
        {expired ? <Badge color="slate">Expired</Badge> : <Badge color="green">Open</Badge>}
        {session.read_only && <Badge color="blue">Read-only</Badge>}
      </div>
      <p className="mt-1 text-sm text-slate-700">
        {expired ? "Expired" : "Expires"} {when(session.expires_at, true)} ({relative(session.expires_at, now)}). The token is kept only on this page; it is gone when you leave.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {!expired && (
          <Button size="sm" variant="outline" onClick={copy}>
            <Copy size={13} /> Copy token
          </Button>
        )}
        <Button size="sm" variant="destructive" onClick={onEnd} disabled={ending}>
          {ending ? "Ending…" : "End session"}
        </Button>
      </div>
    </div>
  )
}

function Actions({ u }: { u: SupportUser }) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [asking, setAsking] = useState<ReasonAction | null>(null)
  const [session, setSession] = useState<SupportSession | null>(null)
  const refetch = () => qc.invalidateQueries({ queryKey: ["admin-support-user", u.id] })

  const withReason = useMutation({
    mutationFn: async ({ action, reason }: { action: ReasonAction; reason: string }) =>
      (await api.post(`${SUPPORT}/users/${u.id}/${action}`, { reason })).data,
    onSuccess: (data, { action }) => {
      if (action === "support-session") {
        setSession(data as SupportSession)
        toast.success("Read-only support session opened")
      } else {
        toast.success("Signed out on every device")
      }
      setAsking(null)
      refetch()
    },
    onError: (err) => toast.error(detail(err, "That did not work")),
  })

  const verify = useMutation({
    mutationFn: async () => (await api.post<{ ok: boolean; sent: boolean }>(`${SUPPORT}/users/${u.id}/verify-email`)).data,
    onSuccess: (d) => {
      d.sent ? toast.success(`Verification link sent to ${u.email}`) : toast.warning("A new link was made, but the email could not be sent. Check Email Config.")
      refetch()
    },
    onError: (err) => toast.error(detail(err, "The link could not be sent")),
  })

  const end = useMutation({
    mutationFn: async (id: number) => (await api.post(`${SUPPORT}/sessions/${id}/end`)).data,
    onSuccess: () => {
      toast.success("Support session ended")
      setSession(null)
      refetch()
    },
    onError: (err) => toast.error(detail(err, "The session could not be ended")),
  })

  async function resend() {
    const ok = await confirm({
      title: "Send a new verification link?",
      message: `A fresh link goes to ${u.email}. Older links stop working.`,
      confirmLabel: "Send link",
    })
    if (ok) verify.mutate()
  }

  async function endSession() {
    if (!session) return
    const ok = await confirm({
      title: "End the support session?",
      message: "The token stops working straight away.",
      confirmLabel: "End session",
      variant: "destructive",
    })
    if (ok) end.mutate(session.session_id)
  }

  const canSession = u.role !== "global_admin" && u.tenant_id !== null
  return (
    <Card className="p-5">
      <SectionHeading>Help this person</SectionHeading>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => setAsking("sign-out")}>
          <LogOut size={14} /> Sign out everywhere
        </Button>
        <Button variant="outline" onClick={resend} disabled={u.verified || verify.isPending}>
          <MailCheck size={14} /> {verify.isPending ? "Sending…" : "Resend verification"}
        </Button>
        <Button variant="outline" onClick={() => setAsking("support-session")} disabled={!canSession || !!session}>
          <KeyRound size={14} /> Open read-only support session
        </Button>
      </div>
      {u.verified && <p className="mt-2 text-xs text-slate-500">The email is already confirmed, so there is no link to resend.</p>}
      {!canSession && <p className="mt-2 text-xs text-slate-500">Support sessions are not available for platform admins or accounts without a workspace.</p>}
      {session && (
        <div className="mt-4">
          <SessionCard session={session} onEnd={endSession} ending={end.isPending} />
        </div>
      )}
      {asking && (
        <ReasonDialog
          action={asking}
          busy={withReason.isPending}
          onClose={() => setAsking(null)}
          onSubmit={(reason) => withReason.mutate({ action: asking, reason })}
        />
      )}
    </Card>
  )
}

function Timeline({ userId, events }: { userId: number; events: SupportEvent[] }) {
  const canRefund = useCanAct("admin.money")
  const [kind, setKind] = useState("")
  const [refunding, setRefunding] = useState<SupportEvent | null>(null)
  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const e of events) c[e.kind] = (c[e.kind] ?? 0) + 1
    return c
  }, [events])
  const kinds = Object.keys(EVENT_KIND).filter((k) => counts[k])
  const shown = useMemo(
    () => [...events].filter((e) => !kind || e.kind === kind).sort((a, b) => (b.at ?? "").localeCompare(a.at ?? "")),
    [events, kind],
  )
  const chip = (key: string, label: string, n: number) => (
    <button
      key={key || "all"}
      type="button"
      aria-pressed={kind === key}
      onClick={() => setKind(key)}
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
        kind === key ? "border-navy bg-navy text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
      )}
    >
      {label} <span className="font-num">{n}</span>
    </button>
  )
  return (
    <Card className="self-start p-5">
      <SectionHeading>Timeline</SectionHeading>
      <div role="group" aria-label="Show events of kind" className="mb-4 flex flex-wrap gap-1.5">
        {chip("", "All", events.length)}
        {kinds.map((k) => chip(k, EVENT_KIND[k].label, counts[k]))}
      </div>
      {shown.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500">Nothing to show.</p>
      ) : (
        <ol className="relative space-y-0 border-l border-slate-200 pl-5" aria-label="Account events, newest first">
          {shown.map((e, i) => (
            <li key={`${e.kind}-${e.at}-${i}`} className="relative pb-4 last:pb-0">
              <span className="absolute -left-[25px] top-1.5 h-2 w-2 rounded-full bg-slate-400 ring-4 ring-white" aria-hidden="true" />
              <div className="flex flex-wrap items-center gap-2">
                <Status map={EVENT_KIND} status={e.kind} />
                <span className="font-medium text-navy">{e.title}</span>
                <time dateTime={e.at ?? undefined} className="text-xs text-slate-500" title={e.at ? when(e.at, true) : undefined}>
                  {e.at ? `${when(e.at, true)} · ${relative(e.at)}` : "No date"}
                </time>
              </div>
              {e.detail && <p className="mt-0.5 break-words text-sm text-slate-600">{e.detail}</p>}
              {e.kind === "purchase" && e.payment_id && canRefund && (
                <Button size="sm" variant="outline" className="mt-1.5" onClick={() => setRefunding(e)} aria-label={`Refund payment ${e.payment_id}`}>
                  <Undo2 size={13} /> Refund
                </Button>
              )}
            </li>
          ))}
        </ol>
      )}
      {refunding && <RefundDialog key={refunding.payment_id ?? 0} userId={userId} event={refunding} onClose={() => setRefunding(null)} />}
    </Card>
  )
}

export default function SupportAccount() {
  const { userId } = useParams()
  const id = Number(userId)
  const navigate = useNavigate()
  const canAct = useCanAct("admin.support")
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["admin-support-user", id],
    queryFn: async () => (await api.get<Account>(`${SUPPORT}/users/${id}`)).data,
    enabled: Number.isFinite(id) && id > 0,
    retry: false,
  })
  const back = () => (window.history.length > 1 ? navigate(-1) : navigate("/support"))

  if (isLoading) return <Spinner label="Loading the account" />
  if (isError || !data) {
    return (
      <>
        <PageHeader title="Account" onBack={back} />
        <Card className="p-5 text-sm text-red-700" role="alert">{detail(error, "This account could not be loaded.")}</Card>
      </>
    )
  }
  const u = data.user
  return (
    <>
      <PageHeader title={u.name || u.email} subtitle={`User #${u.id} · ${u.email}`} onBack={back} />
      <div className="grid gap-4 pb-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <div className="space-y-4">
          <Card className="p-5">
            <SectionHeading>Account</SectionHeading>
            <div className="mb-4"><AccountBadges u={u} /></div>
            <dl className="grid grid-cols-2 gap-4">
              <Row label="Email" value={u.email} wide />
              <Row label="Role" value={humanise(u.role)} />
              <Row label="Region" value={u.home_region ? u.home_region.toUpperCase() : "—"} />
              <Row label="Workspace" value={u.tenant_id ? <Link to={`/tenants/${u.tenant_id}`} className="text-brand hover:underline">#{u.tenant_id}</Link> : "None"} />
              <Row label="Two-step sign-in" value={u.two_step ? "On" : "Off"} />
              <Row label="Joined" value={u.created_at ? when(u.created_at, true) : "—"} />
              <Row label="Last sign-in" value={u.last_login ? `${when(u.last_login, true)} (${relative(u.last_login)})` : "Never"} />
            </dl>
          </Card>
          {u.channel && (
            <Card className="p-5">
              <SectionHeading>Channel</SectionHeading>
              <dl className="grid grid-cols-2 gap-4">
                <Row label="Name" value={u.channel.name} />
                <Row
                  label="Handle"
                  value={
                    <a href={`${WEB_URL}/@${u.channel.handle}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand hover:underline">
                      @{u.channel.handle} <ExternalLink size={12} aria-hidden="true" />
                      <span className="sr-only">(opens in a new tab)</span>
                    </a>
                  }
                />
                <Row label="Strikes" value={String(u.channel.strikes)} />
                <Row label="Status" value={u.channel.suspended ? "Suspended" : "Active"} />
              </dl>
            </Card>
          )}
          {canAct && <Actions u={u} />}
        </div>
        <Timeline userId={u.id} events={data.events} />
      </div>
    </>
  )
}
