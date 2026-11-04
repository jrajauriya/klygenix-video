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

const COUNTRY_NAMES: Record<string, string> = {
  IN: "India", US: "United States", GB: "United Kingdom", AE: "United Arab Emirates", SG: "Singapore",
  CA: "Canada", AU: "Australia", DE: "Germany", other: "Somewhere else",
}

function safeReturn(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/login") || raw.startsWith("/signup")) return "/"
  return raw
}

export function LoginPage() {
  useTitle("Sign in")
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
        setError(needsCode ? "That code is not right." : "")
        return
      }
      setError(errText(err, "Invalid email or password."))
    }
  }

  return (
    <AuthShell
      title="Sign in to Klygenix Play"
      subtitle="Ask videos, send danmaku and pick up where you left off."
      footer={
        <>
          {signup?.mode === "closed" ? (
            <p>New here? <Link to="/waitlist" className="font-semibold text-brand-soft hover:underline">Join the waitlist</Link></p>
          ) : (
            <p>New here? <Link to={`/signup${back !== "/" ? `?returnUrl=${encodeURIComponent(back)}` : ""}`} className="font-semibold text-brand-soft hover:underline">Create an account</Link></p>
          )}
          {signup?.mode === "invite" && <p className="mt-1 text-xs">No invite code yet? <Link to="/waitlist" className="font-semibold text-brand-soft hover:underline">Join the waitlist</Link></p>}
          <p className="mt-2 text-xs text-faint">You can watch everything without an account.</p>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email">
          <input className={INPUT} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </Field>
        <Field label="Password">
          <div className="relative">
            <input className={`${INPUT} pr-10`} type={show ? "text" : "password"} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <button type="button" onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-faint hover:text-ink">
              {show ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </Field>
        {needsCode && (
          <Field label="Code from your authenticator app">
            <input className={INPUT} inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required />
          </Field>
        )}
        {error && <ErrorNote>{error}</ErrorNote>}
        <Btn type="submit" tone="brand" size="lg" className="w-full" disabled={login.isPending}>{login.isPending ? "Signing in…" : "Sign in"}</Btn>
      </form>
    </AuthShell>
  )
}

export function SignupPage() {
  useTitle("Create account")
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
    const t = window.setTimeout(() => {
      api.post<{ valid: boolean; role: string | null }>("/api/video/invites/check", { code })
        .then((r) => live && setCheck({ code, ...r.data }))
        .catch(() => undefined)
    }, 500)
    return () => {
      live = false
      window.clearTimeout(t)
    }
  }, [code, showInvite])

  const checked = check && check.code === code ? check : null
  const inviteNote = !checked || code.length < 4
    ? null
    : !checked.valid
      ? { ok: false, text: "That invite code is not valid, used up or expired." }
      : needCreatorCode && checked.role !== "creator"
        ? { ok: false, text: "This is a viewer invite. Opening a channel needs a creator invite code." }
        : { ok: true, text: checked.role === "creator" ? "Creator invite code accepted." : "Invite code accepted." }

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
      setError(`You need to be at least ${needed} to open an account in this country. You can still watch without one.`)
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
      setError(errStatus(err) === 403 ? errText(err, "Sign-up needs an invite code right now.") : errText(err, "That account could not be created."))
    } finally {
      setPending(false)
    }
  }

  if (state?.mode === "closed") {
    return (
      <AuthShell
        title="Sign-ups are closed for now"
        subtitle="Klygenix Play isn't taking new accounts right now. Join the waitlist and we'll invite you when there's room."
        footer={<Link to="/" className="font-semibold text-brand-soft hover:underline">Keep watching without an account</Link>}
      >
        <WaitlistForm defaultRole={params.get("role")} />
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="Create your Klygenix Play account"
      subtitle="Free. Ask videos, follow channels, send danmaku."
      footer={<p>Already have an account? <Link to={`/login${back !== "/" ? `?returnUrl=${encodeURIComponent(back)}` : ""}`} className="font-semibold text-brand-soft hover:underline">Sign in</Link></p>}
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Your name">
          <input className={INPUT} value={form.name} onChange={(e) => set("name", e.target.value)} required autoComplete="name" maxLength={80} />
        </Field>
        <Field label="Email">
          <input className={INPUT} type="email" value={form.email} onChange={(e) => set("email", e.target.value)} required autoComplete="email" />
        </Field>
        <Field label="Password" hint="8 or more characters">
          <input className={INPUT} type="password" value={form.password} onChange={(e) => set("password", e.target.value)} required minLength={8} autoComplete="new-password" />
        </Field>
        <Field label="Date of birth">
          <input className={INPUT} type="date" value={form.birthDate} max={today} onChange={(e) => set("birthDate", e.target.value)} required autoComplete="bday" />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Country">
            <select className={INPUT} value={form.country} onChange={(e) => set("country", e.target.value)}>
              {PLAY_COUNTRIES.map((c) => <option key={c} value={c}>{COUNTRY_NAMES[c]}</option>)}
            </select>
          </Field>
          <Field label="Language">
            <select className={INPUT} value={form.language} onChange={(e) => set("language", e.target.value)}>
              {PLAY_LANGUAGES.map((l) => <option key={l} value={l}>{LANG_NAMES[l]}</option>)}
            </select>
          </Field>
        </div>
        <p className="rounded-xl bg-white/[0.04] px-3 py-2 text-xs text-muted">18+ in India (16+ in Germany), 13+ elsewhere. You can still watch without an account.</p>
        {creatorMode === "closed" ? (
          <div className="rounded-xl border border-line p-3">
            <p className="text-sm font-semibold">Creator channels open soon</p>
            <p className="mt-0.5 text-xs text-muted">New channels aren't open yet. <Link to="/waitlist?role=creator" className="font-semibold text-brand-soft hover:underline">Join the waitlist as a creator</Link> and we'll invite you.</p>
          </div>
        ) : (
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3 hover:border-brand/50">
            <input type="checkbox" checked={form.creator} onChange={(e) => set("creator", e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#A21CAF]" />
            <span>
              <span className="block text-sm font-semibold">Open a creator channel</span>
              <span className="block text-xs text-muted">
                Upload videos and reels under your own handle. You can also do this later in Studio.
                {creatorMode === "invite" && " Opening a channel needs a creator invite code for now."}
              </span>
            </span>
          </label>
        )}
        {form.creator && (
          <div className="space-y-4 rounded-xl border border-brand/30 bg-brand/[0.06] p-3">
            <Field label="Channel handle" hint="3 to 40 letters, numbers or hyphens">
              <div className="flex items-center gap-1.5">
                <span className="text-sm text-muted">@</span>
                <input
                  className={INPUT}
                  value={form.handle}
                  pattern={HANDLE_PATTERN}
                  title="3 to 40 letters, numbers or hyphens"
                  onChange={(e) => {
                    setHandleTouched(true)
                    set("handle", e.target.value)
                  }}
                  required
                />
              </div>
            </Field>
            <Field label="Channel name">
              <input className={INPUT} value={form.channelName} placeholder={form.name || "Your channel"} onChange={(e) => set("channelName", e.target.value)} maxLength={80} />
            </Field>
          </div>
        )}
        {showInvite && (
          <div className="space-y-1.5">
            <Field label={needCreatorCode ? "Creator invite code" : "Invite code"} hint={inviteMode || needCreatorCode ? undefined : "Optional"}>
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
              {inviteNote?.text ?? (inviteMode ? "Klygenix Play is invite-only for now." : "")}
            </p>
            {(inviteMode || needCreatorCode) && (
              <p className="text-xs text-muted">No code? <Link to={`/waitlist${needCreatorCode ? "?role=creator" : ""}`} className="font-semibold text-brand-soft hover:underline">Join the waitlist</Link></p>
            )}
          </div>
        )}
        {error && <ErrorNote>{error}</ErrorNote>}
        <Btn type="submit" tone="brand" size="lg" className="w-full" disabled={pending}>{pending ? "Creating…" : "Create account"}</Btn>
        <p className="text-center text-[11px] leading-relaxed text-faint">
          By creating an account you agree to the <Link to="/legal/terms" className="underline hover:text-ink">Terms</Link>, <Link to="/legal/privacy" className="underline hover:text-ink">Privacy notice</Link> and <Link to="/legal/guidelines" className="underline hover:text-ink">Community guidelines</Link>.
        </p>
      </form>
    </AuthShell>
  )
}
