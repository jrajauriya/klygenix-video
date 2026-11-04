import { useEffect, useState, type FormEvent } from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { Eye, EyeOff } from "lucide-react"
import {
  HANDLE_PATTERN, PLAY_COUNTRIES, PLAY_LANGUAGES, ageOn, api, countryCode, minimumAge, suggestHandle,
  useAuthStore, useLogin,
} from "@klygenixvideo/auth"
import type { UserInfo } from "@klygenixvideo/types"
import { AuthShell, ErrorNote } from "../components/AuthShell"
import { Btn, Field, INPUT } from "../components/bits"
import { errStatus, errText } from "../lib/api"
import { useSignupState } from "../lib/beta"
import { WaitlistForm } from "./Waitlist"
import { LANG_NAMES } from "../lib/format"
import { useTitle } from "../lib/title"
import { useT } from "../i18n"
import { rich } from "../i18n/rich"

const COUNTRY_NAMES: Record<string, string> = {
  IN: "India", US: "United States", GB: "United Kingdom", AE: "United Arab Emirates", SG: "Singapore",
  CA: "Canada", AU: "Australia", DE: "Germany", other: "Somewhere else",
}

function safeReturn(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/login") || raw.startsWith("/signup")) return "/"
  return raw
}

export function LoginPage() {
  const t = useT("auth")
  useTitle(t("Sign in"))
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const login = useLogin()
  const signup = useSignupState().data
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [code, setCode] = useState("")
  const [needsCode, setNeedsCode] = useState(false)
  const [show, setShow] = useState(false)
  const [error, setError] = useState("")
  const back = safeReturn(params.get("returnUrl"))

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError("")
    try {
      await login.mutateAsync({ email: email.trim(), password, code: needsCode ? code.trim() : undefined })
      qc.clear()
      navigate(back, { replace: true })
    } catch (err) {
      const res = (err as { response?: { status?: number; headers?: Record<string, string> } }).response
      if (res?.headers?.["x-totp-required"]) {
        setNeedsCode(true)
        setError(needsCode ? t("That code is not right.") : "")
        return
      }
      setError(errText(err, t("Invalid email or password.")))
    }
  }

  return (
    <AuthShell
      title={t("Sign in to Klygenix Play")}
      subtitle={t("Ask videos, send danmaku and pick up where you left off.")}
      footer={
        <>
          {signup?.mode === "closed" ? (
            <p>{t("New here?")} <Link to="/waitlist" className="font-semibold text-brand-soft hover:underline">{t("Join the waitlist")}</Link></p>
          ) : (
            <p>{t("New here?")} <Link to={`/signup${back !== "/" ? `?returnUrl=${encodeURIComponent(back)}` : ""}`} className="font-semibold text-brand-soft hover:underline">{t("Create an account")}</Link></p>
          )}
          {signup?.mode === "invite" && <p className="mt-1 text-xs">{t("No invite code yet?")} <Link to="/waitlist" className="font-semibold text-brand-soft hover:underline">{t("Join the waitlist")}</Link></p>}
          <p className="mt-2 text-xs text-faint">{t("You can watch everything without an account.")}</p>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label={t("Email")}>
          <input className={INPUT} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </Field>
        <Field label={t("Password")}>
          <div className="relative">
            <input className={`${INPUT} pr-10`} type={show ? "text" : "password"} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <button type="button" onClick={() => setShow(!show)} aria-label={show ? t("Hide password") : t("Show password")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-faint hover:text-ink">
              {show ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </Field>
        {needsCode && (
          <Field label={t("Code from your authenticator app")}>
            <input className={INPUT} inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required />
          </Field>
        )}
        {error && <ErrorNote>{error}</ErrorNote>}
        <Btn type="submit" tone="brand" size="lg" className="w-full" disabled={login.isPending}>{login.isPending ? t("Signing in…") : t("Sign in")}</Btn>
      </form>
    </AuthShell>
  )
}

export function SignupPage() {
  const t = useT("auth")
  useTitle(t("Create account"))
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const setAuth = useAuthStore((s) => s.setAuth)
  const state = useSignupState().data
  const back = safeReturn(params.get("returnUrl"))
  const [form, setForm] = useState({ name: "", email: "", password: "", birthDate: "", country: "IN", language: "en", creator: false, handle: "", channelName: "", invite: params.get("invite")?.trim() ?? "" })
  const [check, setCheck] = useState<{ code: string; valid: boolean; role: string | null } | null>(null)
  const [handleTouched, setHandleTouched] = useState(false)
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  const today = new Date().toISOString().slice(0, 10)
  const creatorMode = state?.creator ?? "open"
  const inviteMode = state?.mode === "invite"
  const needCreatorCode = form.creator && creatorMode === "invite"
  const showInvite = inviteMode || needCreatorCode || Boolean(params.get("invite"))
  const code = form.invite.trim()

  useEffect(() => {
    if (!showInvite || code.length < 4) return
    let live = true
    const timer = window.setTimeout(() => {
      api.post<{ valid: boolean; role: string | null }>("/api/video/invites/check", { code })
        .then((r) => live && setCheck({ code, ...r.data }))
        .catch(() => undefined)
    }, 500)
    return () => {
      live = false
      window.clearTimeout(timer)
    }
  }, [code, showInvite])

  const checked = check && check.code === code ? check : null
  const inviteNote = !checked || code.length < 4
    ? null
    : !checked.valid
      ? { ok: false, text: t("That invite code is not valid, used up or expired.") }
      : needCreatorCode && checked.role !== "creator"
        ? { ok: false, text: t("This is a viewer invite. Opening a channel needs a creator invite code.") }
        : { ok: true, text: checked.role === "creator" ? t("Creator invite code accepted.") : t("Invite code accepted.") }

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => {
      const next = { ...f, [key]: value }
      if (key === "name" && !handleTouched) next.handle = suggestHandle(String(value))
      return next
    })
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError("")
    const age = ageOn(form.birthDate)
    const needed = minimumAge(form.country)
    if (age === null || age < needed) {
      setError(t("You need to be at least {age} to open an account in this country. You can still watch without one.", { age: needed }))
      return
    }
    setPending(true)
    try {
      const { data } = await api.post<{ access_token: string; user: UserInfo }>("/api/auth/signup", {
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
        birth_date: form.birthDate,
        country: countryCode(form.country),
        language: form.language,
        handle: form.creator && form.handle.trim() ? form.handle.trim().toLowerCase() : null,
        channel_name: form.creator ? form.channelName.trim() || form.name.trim() : null,
        invite: code || null,
      })
      setAuth(data.access_token, data.user)
      qc.clear()
      navigate(back, { replace: true })
    } catch (err) {
      setError(errStatus(err) === 403 ? errText(err, t("Sign-up needs an invite code right now.")) : errText(err, t("That account could not be created.")))
    } finally {
      setPending(false)
    }
  }

  if (state?.mode === "closed") {
    return (
      <AuthShell
        title={t("Sign-ups are closed for now")}
        subtitle={t("Klygenix Play isn't taking new accounts right now. Join the waitlist and we'll invite you when there's room.")}
        footer={<Link to="/" className="font-semibold text-brand-soft hover:underline">{t("Keep watching without an account")}</Link>}
      >
        <WaitlistForm defaultRole={params.get("role")} />
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title={t("Create your Klygenix Play account")}
      subtitle={t("Free. Ask videos, follow channels, send danmaku.")}
      footer={<p>{t("Already have an account?")} <Link to={`/login${back !== "/" ? `?returnUrl=${encodeURIComponent(back)}` : ""}`} className="font-semibold text-brand-soft hover:underline">{t("Sign in")}</Link></p>}
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label={t("Your name")}>
          <input className={INPUT} value={form.name} onChange={(e) => set("name", e.target.value)} required autoComplete="name" maxLength={80} />
        </Field>
        <Field label={t("Email")}>
          <input className={INPUT} type="email" value={form.email} onChange={(e) => set("email", e.target.value)} required autoComplete="email" />
        </Field>
        <Field label={t("Password")} hint={t("8 or more characters")}>
          <input className={INPUT} type="password" value={form.password} onChange={(e) => set("password", e.target.value)} required minLength={8} autoComplete="new-password" />
        </Field>
        <Field label={t("Date of birth")}>
          <input className={INPUT} type="date" value={form.birthDate} max={today} onChange={(e) => set("birthDate", e.target.value)} required autoComplete="bday" />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t("Country")}>
            <select className={INPUT} value={form.country} onChange={(e) => set("country", e.target.value)}>
              {PLAY_COUNTRIES.map((c) => <option key={c} value={c}>{t(COUNTRY_NAMES[c])}</option>)}
            </select>
          </Field>
          <Field label={t("Language")}>
            <select className={INPUT} value={form.language} onChange={(e) => set("language", e.target.value)}>
              {PLAY_LANGUAGES.map((l) => <option key={l} value={l}>{LANG_NAMES[l]}</option>)}
            </select>
          </Field>
        </div>
        <p className="rounded-xl bg-white/[0.04] px-3 py-2 text-xs text-muted">{t("18+ in India (16+ in Germany), 13+ elsewhere. You can still watch without an account.")}</p>
        {creatorMode === "closed" ? (
          <div className="rounded-xl border border-line p-3">
            <p className="text-sm font-semibold">{t("Creator channels open soon")}</p>
            <p className="mt-0.5 text-xs text-muted">{rich(t("New channels aren't open yet. {link} and we'll invite you."), { link: <Link to="/waitlist?role=creator" className="font-semibold text-brand-soft hover:underline">{t("Join the waitlist as a creator")}</Link> })}</p>
          </div>
        ) : (
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3 hover:border-brand/50">
            <input type="checkbox" checked={form.creator} onChange={(e) => set("creator", e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#A21CAF]" />
            <span>
              <span className="block text-sm font-semibold">{t("Open a creator channel")}</span>
              <span className="block text-xs text-muted">
                {t("Upload videos and reels under your own handle. You can also do this later in Studio.")}
                {creatorMode === "invite" && ` ${t("Opening a channel needs a creator invite code for now.")}`}
              </span>
            </span>
          </label>
        )}
        {form.creator && (
          <div className="space-y-4 rounded-xl border border-brand/30 bg-brand/[0.06] p-3">
            <Field label={t("Channel handle")} hint={t("3 to 40 letters, numbers or hyphens")}>
              <div className="flex items-center gap-1.5">
                <span className="text-sm text-muted">@</span>
                <input
                  className={INPUT}
                  value={form.handle}
                  pattern={HANDLE_PATTERN}
                  title={t("3 to 40 letters, numbers or hyphens")}
                  onChange={(e) => {
                    setHandleTouched(true)
                    set("handle", e.target.value)
                  }}
                  required
                />
              </div>
            </Field>
            <Field label={t("Channel name")}>
              <input className={INPUT} value={form.channelName} placeholder={form.name || t("Your channel")} onChange={(e) => set("channelName", e.target.value)} maxLength={80} />
            </Field>
          </div>
        )}
        {showInvite && (
          <div className="space-y-1.5">
            <Field label={needCreatorCode ? t("Creator invite code") : t("Invite code")} hint={inviteMode || needCreatorCode ? undefined : t("Optional")}>
              <input
                className={`${INPUT} font-mono uppercase tracking-wider`}
                value={form.invite}
                onChange={(e) => set("invite", e.target.value)}
                required={inviteMode || needCreatorCode}
                minLength={4}
                maxLength={40}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                aria-describedby="invite-note"
              />
            </Field>
            <p id="invite-note" aria-live="polite" className={`text-xs ${inviteNote ? (inviteNote.ok ? "text-[#4ade80]" : "text-[#fca5a5]") : "text-faint"}`}>
              {inviteNote?.text ?? (inviteMode ? t("Klygenix Play is invite-only for now.") : "")}
            </p>
            {(inviteMode || needCreatorCode) && (
              <p className="text-xs text-muted">{t("No code?")} <Link to={`/waitlist${needCreatorCode ? "?role=creator" : ""}`} className="font-semibold text-brand-soft hover:underline">{t("Join the waitlist")}</Link></p>
            )}
          </div>
        )}
        {error && <ErrorNote>{error}</ErrorNote>}
        <Btn type="submit" tone="brand" size="lg" className="w-full" disabled={pending}>{pending ? t("Creating…") : t("Create account")}</Btn>
        <p className="text-center text-[11px] leading-relaxed text-faint">
          {rich(t("By creating an account you agree to the {terms}, {privacy} and {guidelines}."), {
            terms: <Link to="/legal/terms" className="underline hover:text-ink">{t("Terms")}</Link>,
            privacy: <Link to="/legal/privacy" className="underline hover:text-ink">{t("Privacy notice")}</Link>,
            guidelines: <Link to="/legal/guidelines" className="underline hover:text-ink">{t("Community guidelines")}</Link>,
          })}
        </p>
      </form>
    </AuthShell>
  )
}
