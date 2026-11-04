import { useState } from "react"
import { useSearchParams } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Send } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Spinner, Tabs, Textarea } from "@klygenixvideo/ui"
import { useHasPermission } from "../lib/team"
import { ViewOnly } from "../components/team/ViewOnly"
import { STUDIO } from "../lib/hooks"
import { compact, detail, languageName, status, when } from "../lib/format"
import { DEAL_MIN, deliverableLabel, useDeals, type Brief } from "../lib/market"
import { ApplicationStatusPill } from "../components/brand/shared"
import { DealsTable } from "../components/brand/DealsTable"
import { inr, parseRupees } from "../components/earnings/shared"
import { useT } from "../i18n"

const TABS = [
  { key: "briefs", label: "Open briefs" },
  { key: "deals", label: "My deals" },
]

function Apply({ brief, onClose, onDone }: { brief: Brief; onClose: () => void; onDone: () => void }) {
  const t = useT()
  const [pitch, setPitch] = useState("")
  const [quote, setQuote] = useState(String(brief.budget_min_minor / 100))
  const [busy, setBusy] = useState(false)
  const [refused, setRefused] = useState<string | null>(null)
  const minor = parseRupees(quote)
  const quoteError = minor === null || minor < DEAL_MIN ? t("At least {amount}.", { amount: inr(DEAL_MIN) }) : undefined

  async function send() {
    setBusy(true)
    setRefused(null)
    try {
      await api.post(`${STUDIO}/sponsorships/briefs/${brief.id}/apply`, { pitch: pitch.trim(), quote_minor: minor })
      toast.success(t("Applied. The brand will see your pitch."))
      onDone()
    } catch (err) {
      const message = detail(err, t("Your application could not be sent"))
      if (status(err) === 409) setRefused(message)
      else toast.error(message)
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t("Apply to \"{title}\"", { title: brief.title })}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>{t("Cancel")}</Button>
          <Button onClick={send} disabled={busy || pitch.trim().length < 20 || Boolean(quoteError)}><Send size={14} /> {busy ? t("Sending…") : t("Send application")}</Button>
        </div>
      }
    >
      <div className="space-y-4">
        {refused && <p role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3.5 py-2.5 text-sm text-red-800">{refused}</p>}
        <Field label={t("Your pitch")} required error={pitch && pitch.trim().length < 20 ? t("At least 20 characters.") : undefined}
          hint={t("Why your audience fits, what you would make, and a past video that shows it.")}>
          <Textarea rows={5} value={pitch} maxLength={3000} onChange={(e) => setPitch(e.target.value)} />
        </Field>
        <Field label={t("Your price (₹)")} required error={quoteError} hint={t("The brand's budget is {min} to {max}.", { min: inr(brief.budget_min_minor), max: inr(brief.budget_max_minor) })}>
          <Input value={quote} inputMode="decimal" onChange={(e) => setQuote(e.target.value)} className="max-w-[12rem]" />
        </Field>
        <p className="text-xs text-slate-600">
          {t("You need active payouts to take sponsorships. If the brand accepts, they fund the deal first and the money is held until they approve your video.")}
        </p>
      </div>
    </Modal>
  )
}

function OpenBriefs() {
  const t = useT()
  const qc = useQueryClient()
  const canApply = useHasPermission("video.sponsorships", "full")
  const [applying, setApplying] = useState<Brief | null>(null)
  const { data, isLoading } = useQuery({
    queryKey: ["studio-open-briefs"],
    queryFn: async () => (await api.get<Brief[]>(`${STUDIO}/sponsorships/briefs`)).data,
  })

  if (isLoading) return <Spinner />
  if (!data?.length) return <EmptyState title={t("No open briefs for your channel right now")} hint={t("Brands post new briefs often. Briefs only show when your channel's language and followers match.")} />

  return (
    <>
      <ul className="grid gap-4 lg:grid-cols-2">
        {data.map((b) => (
          <li key={b.id}>
            <Card className="flex h-full flex-col gap-3 p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-bold text-navy">{b.title}</h2>
                  <p className="text-xs text-slate-500">{t("{brand} · posted {date}", { brand: b.brand?.name ?? t("A brand"), date: when(b.created_at) })}</p>
                </div>
                <Badge color="purple">{deliverableLabel(b.deliverable)}</Badge>
              </div>
              <p className="whitespace-pre-line text-sm text-slate-700">{b.description}</p>
              <dl className="mt-auto grid grid-cols-2 gap-2 text-sm">
                <div>
                  <dt className="text-xs text-slate-500">{t("Budget")}</dt>
                  <dd className="font-num font-semibold text-navy">{t("{min} to {max}", { min: inr(b.budget_min_minor), max: inr(b.budget_max_minor) })}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">{t("Apply by")}</dt>
                  <dd className="text-slate-800">{b.deadline ? when(b.deadline) : t("No deadline")}</dd>
                </div>
                {b.min_followers > 0 && (
                  <div>
                    <dt className="text-xs text-slate-500">{t("Followers")}</dt>
                    <dd className="text-slate-800">{t("{n} or more", { n: compact(b.min_followers) })}</dd>
                  </div>
                )}
                {b.languages.length > 0 && (
                  <div>
                    <dt className="text-xs text-slate-500">{t("Languages")}</dt>
                    <dd className="text-slate-800">{b.languages.map(languageName).join(", ")}</dd>
                  </div>
                )}
              </dl>
              <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
                {b.my_application ? (
                  <span className="flex items-center gap-2 text-sm text-slate-600">
                    {t("You quoted")} <span className="font-num font-semibold">{inr(b.my_application.quote_minor)}</span>
                    <ApplicationStatusPill status={b.my_application.status} />
                  </span>
                ) : canApply ? (
                  <Button size="sm" onClick={() => setApplying(b)}>{t("Apply")}</Button>
                ) : null}
              </div>
            </Card>
          </li>
        ))}
      </ul>
      {applying && (
        <Apply
          brief={applying}
          onClose={() => setApplying(null)}
          onDone={() => {
            setApplying(null)
            qc.invalidateQueries({ queryKey: ["studio-open-briefs"] })
          }}
        />
      )}
    </>
  )
}

export default function Sponsorships() {
  const t = useT()
  const [params, setParams] = useSearchParams()
  const tab = params.get("tab") === "deals" ? "deals" : "briefs"
  const { data: deals, isLoading } = useDeals()
  const canApply = useHasPermission("video.sponsorships", "full")

  return (
    <div className="pb-8">
      <PageHeader title={t("Sponsorships")} subtitle={t("Paid work from brands. Apply to briefs, deliver the video, get paid when the brand approves.")} />
      {!canApply && <ViewOnly className="mb-4" what={t("Your role can see briefs and deals but not apply to briefs or deliver videos.")} />}
      <Tabs tabs={TABS.map((x) => ({ ...x, label: t(x.label) }))} active={tab} onChange={(k) => setParams(k === "briefs" ? {} : { tab: k }, { replace: true })} />
      {tab === "briefs" ? <OpenBriefs /> : <DealsTable rows={(deals ?? []).filter((d) => d.role === "creator")} loading={isLoading} role="creator" />}
    </div>
  )
}
