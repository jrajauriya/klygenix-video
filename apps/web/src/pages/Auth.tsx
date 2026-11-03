import { useState, type FormEvent, type ReactNode } from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { Eye, EyeOff } from "lucide-react"
import {
  HANDLE_PATTERN, PLAY_COUNTRIES, PLAY_LANGUAGES, ageOn, api, countryCode, minimumAge, suggestHandle,
  useAuthStore, useLogin, useSignupOpen,
} from "@klygenixvideo/auth"
import type { UserInfo } from "@klygenixvideo/types"
import { Logo } from "../components/Layout"
import { Btn, Field, INPUT } from "../components/bits"
import { errText } from "../lib/api"
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

function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="relative flex min-h-[calc(100dvh-3.5rem)] items-start justify-center overflow-hidden px-4 py-10 sm:items-center">
      <div className="pointer-events-none absolute -top-40 left-1/2 h-96 w-[42rem] -translate-x-1/2 rounded-full bg-brand/25 blur-[120px]" />
      <div className="relative w-full max-w-[440px]">
        <div className="mb-6 flex justify-center"><Logo /></div>
        <div className="rounded-3xl border border-line bg-panel/90 p-6 shadow-2xl backdrop-blur sm:p-8">
          <h1 className="text-center text-xl font-bold">{title}</h1>
          {subtitle && <p className="mt-1 text-center text-sm text-muted">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
        {footer && <div className="mt-5 text-center text-sm text-muted">{footer}</div>}
      </div>
    </div>
  )
}

function ErrorNote({ children }: { children: ReactNode }) {
  return <div role="alert" className="rounded-xl border border-[#7f1d1d] bg-[#450a0a]/60 px-3 py-2 text-sm text-[#fecaca]">{children}</div>
}

export function LoginPage() {
  useTitle("Sign in")
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const login = useLogin()
  const signupOpen = useSignupOpen()
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
          {signupOpen !== false && <p>New here? <Link to={`/signup${back !== "/" ? `?returnUrl=${encodeURIComponent(back)}` : ""}`} className="font-semibold text-brand-soft hover:underline">Create an account</Link></p>}
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
  const open = useSignupOpen()
  const back = safeReturn(params.get("returnUrl"))
  const [form, setForm] = useState({ name: "", email: "", password: "", birthDate: "", country: "IN", language: "en", creator: false, handle: "", channelName: "" })
  const [handleTouched, setHandleTouched] = useState(false)
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  const today = new Date().toISOString().slice(0, 10)

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
      })
      setAuth(data.access_token, data.user)
      qc.clear()
      navigate(back, { replace: true })
    } catch (err) {
      setError(errText(err, "That account could not be created."))
    } finally {
      setPending(false)
    }
  }

  if (open === false) {
    return (
      <AuthShell title="Sign-ups are closed for now" footer={<Link to="/" className="font-semibold text-brand-soft hover:underline">Keep watching</Link>}>
        <p className="text-center text-sm text-muted">Klygenix Play isn't taking new accounts right now. You can still watch everything without one.</p>
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
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3 hover:border-brand/50">
          <input type="checkbox" checked={form.creator} onChange={(e) => set("creator", e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#A21CAF]" />
          <span>
            <span className="block text-sm font-semibold">Open a creator channel</span>
            <span className="block text-xs text-muted">Upload videos and reels under your own handle. You can also do this later in Studio.</span>
          </span>
        </label>
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
        {error && <ErrorNote>{error}</ErrorNote>}
        <Btn type="submit" tone="brand" size="lg" className="w-full" disabled={pending}>{pending ? "Creating…" : "Create account"}</Btn>
        <p className="text-center text-[11px] leading-relaxed text-faint">
          By creating an account you agree to the <Link to="/legal/terms" className="underline hover:text-ink">Terms</Link>, <Link to="/legal/privacy" className="underline hover:text-ink">Privacy notice</Link> and <Link to="/legal/guidelines" className="underline hover:text-ink">Community guidelines</Link>.
        </p>
      </form>
    </AuthShell>
  )
}
