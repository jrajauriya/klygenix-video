import { useState, type FormEvent } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { CheckCircle2, Loader2, MailCheck, XCircle } from "lucide-react"
import { PLAY_COUNTRIES, api, countryCode } from "@klygenixvideo/auth"
import { cn } from "@klygenixvideo/ui"
import { AuthShell, ErrorNote } from "../components/AuthShell"
import { Btn, Field, INPUT, TEXTAREA } from "../components/bits"
import { errStatus, errText } from "../lib/api"
import { useTitle } from "../lib/title"
import { useT } from "../i18n"
import { rich } from "../i18n/rich"

const COUNTRY_NAMES: Record<string, string> = {
  IN: "India", US: "United States", GB: "United Kingdom", AE: "United Arab Emirates", SG: "Singapore",
  CA: "Canada", AU: "Australia", DE: "Germany", other: "Somewhere else",
}

type Role = "viewer" | "creator" | "brand"

const ROLES: { key: Role; label: string; hint: string }[] = [
  { key: "viewer", label: "Watch", hint: "Videos, reels, Ask-the-video" },
  { key: "creator", label: "Create", hint: "Open a channel and earn" },
  { key: "brand", label: "Advertise", hint: "Ads and sponsorships" },
]

export function WaitlistForm({ defaultRole, defaultEmail }: { defaultRole?: string | null; defaultEmail?: string }) {
  const t = useT("auth")
  const start = ROLES.some((r) => r.key === defaultRole) ? (defaultRole as Role) : "viewer"
  const [form, setForm] = useState({ email: defaultEmail ?? "", name: "", role: start, country: "IN", language: "en", note: "", channel_url: "" })
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const [sent, setSent] = useState<string | null>(null)
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }))

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError("")
    setPending(true)
    try {
      await api.post("/api/video/waitlist", {
        email: form.email.trim(), name: form.name.trim(), role: form.role, country: countryCode(form.country),
        language: form.language, note: form.note.trim(), channel_url: form.role === "creator" && form.channel_url.trim() ? form.channel_url.trim() : null,
      })
      setSent(form.email.trim())
    } catch (err) {
      setError(errStatus(err) === 429 ? t("Too many requests from here. Try again in a little while.") : errText(err, t("You could not be added to the waitlist. Check the fields and try again.")))
    } finally {
      setPending(false)
    }
  }

  if (sent) {
    return (
      <div role="status" className="space-y-3 text-center">
        <MailCheck size={36} className="mx-auto text-brand-soft" aria-hidden="true" />
        <p className="text-base font-semibold">{t("Check your inbox")}</p>
        <p className="text-sm text-muted">{rich(t("We sent a link to {email}. Open it to confirm your place on the waitlist. We'll email you an invite when there's room."), { email: <span className="font-semibold text-ink">{sent}</span> })}</p>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-muted">{t("I want to")}</legend>
        <div className="grid grid-cols-3 gap-2">
          {ROLES.map((r) => (
            <label
              key={r.key}
              className={cn(
                "flex cursor-pointer flex-col items-center gap-0.5 rounded-xl border px-2 py-2.5 text-center has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand",
                form.role === r.key ? "border-brand bg-brand/15" : "border-line hover:border-brand/50",
              )}
            >
              <input type="radio" name="waitlist-role" value={r.key} checked={form.role === r.key} onChange={() => set("role", r.key)} className="sr-only" />
              <span className="text-sm font-semibold">{t(r.label)}</span>
              <span className="text-[11px] leading-tight text-muted">{t(r.hint)}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <Field label={t("Email")}>
        <input className={INPUT} type="email" value={form.email} onChange={(e) => set("email", e.target.value)} required maxLength={200} autoComplete="email" />
      </Field>
      <Field label={t("Your name (optional)")}>
        <input className={INPUT} value={form.name} onChange={(e) => set("name", e.target.value)} maxLength={120} autoComplete="name" />
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t("Country")}>
          <select className={INPUT} value={form.country} onChange={(e) => set("country", e.target.value)}>
            {PLAY_COUNTRIES.map((c) => <option key={c} value={c}>{t(COUNTRY_NAMES[c])}</option>)}
          </select>
        </Field>
        <Field label={t("Preferred language")}>
          <select className={INPUT} value={form.language} onChange={(e) => set("language", e.target.value)}>
            <option value="en">English</option>
            <option value="hi">हिन्दी (Hindi)</option>
          </select>
        </Field>
      </div>
      {form.role === "creator" && (
        <Field label={t("Your channel elsewhere (optional)")} hint={t("A YouTube, Instagram or Bilibili link helps us invite you sooner.")}>
          <input className={INPUT} type="url" value={form.channel_url} onChange={(e) => set("channel_url", e.target.value)} maxLength={300} placeholder="https://" />
        </Field>
      )}
      <Field label={t("Anything you'd like to tell us? (optional)")}>
        <textarea className={TEXTAREA} rows={3} value={form.note} onChange={(e) => set("note", e.target.value)} maxLength={1000} />
      </Field>
      {error && <ErrorNote>{error}</ErrorNote>}
      <Btn type="submit" tone="brand" size="lg" className="w-full" disabled={pending}>{pending ? t("Joining…") : t("Join the waitlist")}</Btn>
    </form>
  )
}

export function WaitlistPage() {
  const t = useT("auth")
  useTitle(t("Join the waitlist"))
  const [params] = useSearchParams()
  return (
    <AuthShell
      title={t("Join the Klygenix Play waitlist")}
      subtitle={t("We're letting people in a few at a time. Leave your email and we'll send you an invite.")}
      footer={
        <>
          <p>{t("Have an invite code?")} <Link to="/signup" className="font-semibold text-brand-soft hover:underline">{t("Create your account")}</Link></p>
          <p className="mt-2 text-xs text-faint">{t("You can watch everything without an account.")}</p>
        </>
      }
    >
      <WaitlistForm defaultRole={params.get("role")} defaultEmail={params.get("email") ?? undefined} />
    </AuthShell>
  )
}

export function WaitlistConfirmPage() {
  const t = useT("auth")
  useTitle(t("Confirm your place"))
  const [params] = useSearchParams()
  const token = params.get("token") ?? ""
  const q = useQuery({
    queryKey: ["waitlist-confirm", token],
    enabled: token.length >= 10,
    queryFn: async () => (await api.post<{ ok: boolean; status: string }>("/api/video/waitlist/confirm", { token })).data,
    retry: false,
    staleTime: Infinity,
    gcTime: Infinity,
  })
  const bad = token.length < 10 || q.isError
  return (
    <AuthShell title={bad ? t("This link doesn't work") : q.isLoading ? t("Confirming…") : t("You're on the list")} footer={<Link to="/" className="font-semibold text-brand-soft hover:underline">{t("Keep watching")}</Link>}>
      <div role="status" className="space-y-3 text-center">
        {bad ? (
          <>
            <XCircle size={36} className="mx-auto text-[#f87171]" aria-hidden="true" />
            <p className="text-sm text-muted">
              {errStatus(q.error) === 404 || token.length < 10
                ? t("The link is not valid or was already used. If you already confirmed, you're on the list.")
                : errText(q.error, t("We could not confirm your place. Try the link again."))}
            </p>
            <Link to="/waitlist" className="inline-block text-sm font-semibold text-brand-soft hover:underline">{t("Join the waitlist again")}</Link>
          </>
        ) : q.isLoading ? (
          <Loader2 size={28} className="mx-auto animate-spin text-muted" aria-label={t("Confirming…")} />
        ) : (
          <>
            <CheckCircle2 size={36} className="mx-auto text-[#4ade80]" aria-hidden="true" />
            <p className="text-sm text-muted">
              {q.data?.status === "invited"
                ? t("You've already been invited. Check your inbox for the invite code.")
                : t("Your email is confirmed. We'll send you an invite as soon as there's room.")}
            </p>
          </>
        )}
      </div>
    </AuthShell>
  )
}
