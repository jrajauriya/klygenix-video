import { useEffect, useState, type ReactNode } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import companyLockup from "./brand/klygenix-lockup-company-light.svg"
import { api } from "./api"
import { useSignupOpen } from "./hooks"
import { useAuthStore } from "./store"
import type { UserInfo } from "@klygenixvideo/types"
import { useAuthText } from "./text"
import { HANDLE_PATTERN, PLAY_COUNTRIES, PLAY_LANGUAGES, ageOn, countryCode, minimumAge, suggestHandle } from "./signup"

const INPUT =
  "w-full h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 placeholder:text-gray-400 outline-none transition-colors focus:border-[#632B4F] focus:ring-1 focus:ring-[#632B4F]"
const BUTTON =
  "inline-flex h-10 w-full items-center justify-center rounded-lg bg-gradient-to-r from-[#632B4F] to-[#B44A32] text-sm font-semibold text-white transition-colors hover:from-[#552444] hover:to-[#9E3F2B] disabled:cursor-not-allowed disabled:opacity-50"

function detail(err: unknown, fallback: string): string {
  return (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? fallback
}

function Shell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  const { t, aside } = useAuthText()
  return (
    <main className="min-h-screen flex items-center justify-center bg-[#F4F6FB] p-4">
      <div className="w-full max-w-[420px]">
        {aside && <div className="mb-4 flex justify-end">{aside}</div>}
        <div className="flex items-center justify-center mb-8">
          <img src={companyLockup} alt="Klygenix Technologies" style={{ height: 56, width: "auto" }} />
        </div>
        <div className="bg-white border border-gray-200 rounded-2xl p-8 shadow-sm">
          <div className="text-center mb-6">
            <h1 className="text-lg font-semibold text-gray-900">{title}</h1>
            {subtitle && <p className="text-sm text-gray-500 mt-1">{subtitle}</p>}
          </div>
          {children}
        </div>
        <p className="text-center text-xs text-gray-500 mt-6">
          <a href="/login" className="text-[#632B4F] hover:underline">{t("shell.back")}</a>
        </p>
      </div>
    </main>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-sm text-gray-600">{label}</span>
      {children}
    </label>
  )
}

function Notice({ tone, children }: { tone: "error" | "ok"; children: ReactNode }) {
  const colours = tone === "error" ? "text-red-600 bg-red-50 border-red-200" : "text-green-700 bg-green-50 border-green-200"
  return <div className={`text-sm border rounded-lg px-3 py-2 ${colours}`}>{children}</div>
}

export function SignupPage({ afterSignup = "/" }: { afterSignup?: string } = {}) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const back = params.get("returnUrl") ?? ""
  const destination = back.startsWith("/") && !back.startsWith("//") ? back : afterSignup
  const setAuth = useAuthStore((s) => s.setAuth)
  const { t } = useAuthText()
  const [form, setForm] = useState({
    name: "", email: "", password: "", birthDate: "", country: "IN", language: "en", creator: false, handle: "", channelName: "",
  })
  const [handleTouched, setHandleTouched] = useState(false)
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  const open = useSignupOpen()
  const today = new Date().toISOString().slice(0, 10)

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => {
      const next = { ...f, [key]: value }
      if (key === "name" && !handleTouched) next.handle = suggestHandle(String(value))
      return next
    })
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    const age = ageOn(form.birthDate)
    const needed = minimumAge(form.country)
    if (age === null || age < needed) {
      setError(t("signup.tooYoung", { age: String(needed) }))
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
      navigate(destination, { replace: true })
    } catch (err) {
      setError(detail(err, t("signup.failed")))
    } finally {
      setPending(false)
    }
  }

  if (open === false) {
    return (
      <Shell title={t("signup.closedTitle")}>
        <p className="text-sm text-gray-700">{t("signup.closedBody")}</p>
      </Shell>
    )
  }

  return (
    <Shell title={t("signup.title")} subtitle={t("signup.subtitle")}>
      <form onSubmit={submit} className="space-y-4">
        <Field label={t("signup.name")}>
          <input className={INPUT} value={form.name} onChange={(e) => set("name", e.target.value)} required autoComplete="name" />
        </Field>
        <Field label={t("signup.email")}>
          <input className={INPUT} type="email" value={form.email} onChange={(e) => set("email", e.target.value)} required autoComplete="email" />
        </Field>
        <Field label={t("signup.password")}>
          <input className={INPUT} type="password" value={form.password} onChange={(e) => set("password", e.target.value)} required minLength={8} autoComplete="new-password" />
        </Field>
        <Field label={t("signup.birthDate")}>
          <input className={INPUT} type="date" value={form.birthDate} max={today} onChange={(e) => set("birthDate", e.target.value)} required autoComplete="bday" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("signup.country")}>
            <select className={INPUT} value={form.country} onChange={(e) => set("country", e.target.value)}>
              {PLAY_COUNTRIES.map((code) => <option key={code} value={code}>{code === "other" ? t("country.other") : t(`country.${code}`)}</option>)}
            </select>
          </Field>
          <Field label={t("signup.language")}>
            <select className={INPUT} value={form.language} onChange={(e) => set("language", e.target.value)}>
              {PLAY_LANGUAGES.map((code) => <option key={code} value={code}>{t(`language.${code}`)}</option>)}
            </select>
          </Field>
        </div>
        <p className="text-xs text-gray-500">{t("signup.ageRule")}</p>
        <label className="flex items-start gap-3 rounded-lg border border-gray-200 p-3">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#A21CAF]" checked={form.creator} onChange={(e) => set("creator", e.target.checked)} />
          <span>
            <span className="block text-sm font-medium text-gray-900">{t("signup.creator")}</span>
            <span className="block text-xs text-gray-500">{t("signup.creatorHint")}</span>
          </span>
        </label>
        {form.creator && (
          <>
            <Field label={t("signup.handle")}>
              <div className="flex items-center gap-1">
                <span className="text-sm text-gray-500">@</span>
                <input
                  className={INPUT}
                  value={form.handle}
                  pattern={HANDLE_PATTERN}
                  title={t("signup.handleHint")}
                  onChange={(e) => {
                    setHandleTouched(true)
                    set("handle", e.target.value)
                  }}
                  required
                />
              </div>
              <span className="block text-xs text-gray-500">{t("signup.handleHint")}</span>
            </Field>
            <Field label={t("signup.channelName")}>
              <input className={INPUT} value={form.channelName} placeholder={form.name} onChange={(e) => set("channelName", e.target.value)} maxLength={80} />
            </Field>
          </>
        )}
        {error && <Notice tone="error">{error}</Notice>}
        <button type="submit" className={BUTTON} disabled={pending}>{pending ? t("signup.creating") : t("signup.submit")}</button>
      </form>
    </Shell>
  )
}

export function VerifyPage() {
  const [params] = useSearchParams()
  const token = params.get("token") ?? ""
  const { token: session, user, setAuth } = useAuthStore()
  const { t } = useAuthText()
  const [state, setState] = useState<{ tone: "ok" | "error"; text: string } | null>(null)

  useEffect(() => {
    if (!token) {
      setState({ tone: "error", text: t("verify.noToken") })
      return
    }
    api
      .post<{ message: string }>("/api/auth/verify", { token })
      .then(async ({ data }) => {
        setState({ tone: "ok", text: data.message })
        if (session && user) {
          try {
            const me = await api.get<UserInfo>("/api/auth/me")
            setAuth(session, me.data)
          } catch {
            return
          }
        }
      })
      .catch((err) => setState({ tone: "error", text: detail(err, t("verify.failed")) }))
  }, [token])

  return (
    <Shell title={t("verify.title")}>
      {state ? <Notice tone={state.tone}>{state.text}</Notice> : <p className="text-sm text-gray-500 text-center">{t("verify.wait")}</p>}
      {state?.tone === "ok" && (
        <a href={session ? "/" : "/login"} className={`${BUTTON} mt-4`}>{session ? t("verify.dashboard") : t("verify.signIn")}</a>
      )}
    </Shell>
  )
}

export function ForgotPage() {
  const { t } = useAuthText()
  const [email, setEmail] = useState("")
  const [sent, setSent] = useState("")
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setPending(true)
    try {
      const { data } = await api.post<{ message: string }>("/api/auth/forgot", { email })
      setSent(data.message)
    } catch (err) {
      setError(detail(err, t("forgot.failed")))
    } finally {
      setPending(false)
    }
  }

  return (
    <Shell title={t("forgot.title")} subtitle={t("forgot.subtitle")}>
      {sent ? (
        <Notice tone="ok">{sent}</Notice>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label={t("forgot.email")}>
            <input className={INPUT} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          {error && <Notice tone="error">{error}</Notice>}
          <button type="submit" className={BUTTON} disabled={pending}>{pending ? t("forgot.sending") : t("forgot.submit")}</button>
        </form>
      )}
    </Shell>
  )
}

function PasswordForm({
  path,
  button,
  withName,
  onDone,
}: {
  path: string
  button: string
  withName?: boolean
  onDone: (data: unknown) => void
}) {
  const [params] = useSearchParams()
  const { t } = useAuthText()
  const token = params.get("token") ?? ""
  const [password, setPassword] = useState("")
  const [again, setAgain] = useState("")
  const [name, setName] = useState("")
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    if (password !== again) {
      setError(t("password.mismatch"))
      return
    }
    setPending(true)
    try {
      const chosenName = withName && name.trim() ? name.trim() : null
      const { data } = await api.post(path, { token, password, name: chosenName })
      onDone(data)
    } catch (err) {
      setError(detail(err, t("verify.failed")))
    } finally {
      setPending(false)
    }
  }

  if (!token) return <Notice tone="error">{t("verify.noToken")}</Notice>
  return (
    <form onSubmit={submit} className="space-y-4">
      {withName && (
        <Field label={t("password.name")}>
          <input className={INPUT} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
      )}
      <Field label={t("password.new")}>
        <input className={INPUT} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
      </Field>
      <Field label={t("password.again")}>
        <input className={INPUT} type="password" value={again} onChange={(e) => setAgain(e.target.value)} required minLength={8} />
      </Field>
      {error && <Notice tone="error">{error}</Notice>}
      <button type="submit" className={BUTTON} disabled={pending}>{pending ? t("password.saving") : button}</button>
    </form>
  )
}

export function ResetPage() {
  const [done, setDone] = useState("")
  const clearAuth = useAuthStore((s) => s.clearAuth)
  const { t } = useAuthText()
  return (
    <Shell title={t("reset.title")}>
      {done ? (
        <>
          <Notice tone="ok">{done}</Notice>
          <a href="/login" className={`${BUTTON} mt-4`}>{t("verify.signIn")}</a>
        </>
      ) : (
        <PasswordForm
          path="/api/auth/reset"
          button={t("reset.submit")}
          onDone={(data) => {
            clearAuth()
            setDone((data as { message: string }).message)
          }}
        />
      )}
    </Shell>
  )
}

export function InvitePage() {
  const navigate = useNavigate()
  const setAuth = useAuthStore((s) => s.setAuth)
  const { t } = useAuthText()
  return (
    <Shell title={t("invite.title")} subtitle={t("invite.subtitle")}>
      <PasswordForm
        path="/api/auth/invite/accept"
        button={t("invite.submit")}
        withName
        onDone={(data) => {
          const signed = data as { access_token: string; user: UserInfo }
          setAuth(signed.access_token, signed.user)
          navigate("/", { replace: true })
        }}
      />
    </Shell>
  )
}
