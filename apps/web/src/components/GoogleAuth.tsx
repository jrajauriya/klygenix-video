import { useState, type FormEvent, type ReactNode } from "react"
import { Link, useNavigate } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { GoogleButton, PLAY_COUNTRIES, PLAY_LANGUAGES, ageOn, countryCode, minimumAge, useGoogleFlow, type GoogleNeedsProfile } from "@klygenixvideo/auth"
import { ErrorNote } from "./AuthShell"
import { Btn, Field, INPUT } from "./bits"
import { LANG_NAMES } from "../lib/format"
import { useT } from "../i18n"
import { rich } from "../i18n/rich"

export const COUNTRY_NAMES: Record<string, string> = {
  IN: "India", US: "United States", GB: "United Kingdom", AE: "United Arab Emirates", SG: "Singapore",
  CA: "Canada", AU: "Australia", DE: "Germany", other: "Somewhere else",
}

function Finish({ profile, error, pending, onSubmit, onBack }: {
  profile: GoogleNeedsProfile
  error: string
  pending: boolean
  onSubmit: (body: { birth_date: string; country: string; language: string; name: string; invite: string | null }) => void
  onBack: () => void
}) {
  const t = useT("auth")
  const [form, setForm] = useState({ name: profile.name, birthDate: "", country: "IN", language: "en", invite: "" })
  const [local, setLocal] = useState("")
  const today = new Date().toISOString().slice(0, 10)

  function submit(e: FormEvent) {
    e.preventDefault()
    setLocal("")
    const age = ageOn(form.birthDate)
    const needed = minimumAge(form.country)
    if (age === null || age < needed) {
      setLocal(t("You need to be at least {age} to open an account in this country. You can still watch without one.", { age: needed }))
      return
    }
    onSubmit({ birth_date: form.birthDate, country: countryCode(form.country), language: form.language, name: form.name.trim(), invite: form.invite.trim() || null })
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="rounded-xl border border-line bg-white/[0.04] px-3 py-2.5">
        <p className="text-sm font-semibold">{t("One more step")}</p>
        <p className="mt-0.5 break-all text-xs text-muted">{t("Creating a Klygenix Play account for {email}.", { email: profile.email })}</p>
      </div>
      <Field label={t("Your name")}>
        <input className={INPUT} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoComplete="name" maxLength={80} />
      </Field>
      <Field label={t("Date of birth")}>
        <input className={INPUT} type="date" value={form.birthDate} max={today} onChange={(e) => setForm({ ...form, birthDate: e.target.value })} required autoComplete="bday" autoFocus />
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t("Country")}>
          <select className={INPUT} value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })}>
            {PLAY_COUNTRIES.map((c) => <option key={c} value={c}>{t(COUNTRY_NAMES[c])}</option>)}
          </select>
        </Field>
        <Field label={t("Language")}>
          <select className={INPUT} value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })}>
            {PLAY_LANGUAGES.map((l) => <option key={l} value={l}>{LANG_NAMES[l]}</option>)}
          </select>
        </Field>
      </div>
      {profile.invite_needed && (
        <Field label={t("Invite code")}>
          <input className={`${INPUT} font-mono uppercase tracking-wider`} value={form.invite} onChange={(e) => setForm({ ...form, invite: e.target.value })}
            required minLength={4} maxLength={40} autoComplete="off" autoCapitalize="characters" spellCheck={false} />
        </Field>
      )}
      <p className="rounded-xl bg-white/[0.04] px-3 py-2 text-xs text-muted">{t("18+ in India (16+ in Germany), 13+ elsewhere. You can still watch without an account.")}</p>
      {(local || error) && <ErrorNote>{local || error}</ErrorNote>}
      <Btn type="submit" tone="brand" size="lg" className="w-full" disabled={pending}>{pending ? t("Creating…") : t("Create account")}</Btn>
      <p className="text-center text-[11px] leading-relaxed text-faint">
        {rich(t("By creating an account you agree to the {terms}, {privacy} and {guidelines}."), {
          terms: <Link to="/legal/terms" className="underline hover:text-ink">{t("Terms")}</Link>,
          privacy: <Link to="/legal/privacy" className="underline hover:text-ink">{t("Privacy notice")}</Link>,
          guidelines: <Link to="/legal/guidelines" className="underline hover:text-ink">{t("Community guidelines")}</Link>,
        })}
      </p>
      <button type="button" onClick={onBack} className="w-full text-sm font-semibold text-brand-soft hover:underline">{t("Use a different account")}</button>
    </form>
  )
}

export function GoogleAuth({ back, children }: { back: string; children: ReactNode }) {
  const t = useT("auth")
  const navigate = useNavigate()
  const qc = useQueryClient()
  const flow = useGoogleFlow(() => {
    qc.clear()
    navigate(back, { replace: true })
  })
  const [code, setCode] = useState("")

  if (!flow.enabled) return <>{children}</>
  if (flow.profile) {
    return <Finish key={flow.profile.ticket} profile={flow.profile} error={flow.error} pending={flow.pending} onSubmit={(b) => void flow.finish(b)} onBack={flow.reset} />
  }
  return (
    <>
      <GoogleButton onCredential={flow.onCredential} />
      {flow.needsCode && (
        <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); void flow.submitCode(code) }}>
          <Field label={t("Code from your authenticator app")}>
            <input className={INPUT} inputMode="numeric" autoComplete="one-time-code" autoFocus value={code} onChange={(e) => setCode(e.target.value)} required />
          </Field>
          <Btn type="submit" tone="brand" className="w-full" disabled={flow.pending}>{t("Sign in")}</Btn>
        </form>
      )}
      {flow.error && <div className="mt-4"><ErrorNote>{flow.error}</ErrorNote></div>}
      <div className="my-5 flex items-center gap-3 text-xs uppercase text-faint" role="separator">
        <span className="h-px flex-1 bg-line" />{t("or")}<span className="h-px flex-1 bg-line" />
      </div>
      {children}
    </>
  )
}
