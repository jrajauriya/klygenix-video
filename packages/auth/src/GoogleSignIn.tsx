import { useCallback, useState, type FormEvent } from "react"
import type { UserInfo } from "@klygenixvideo/types"
import { GoogleButton, googleClientId } from "./GoogleButton"
import { needsProfile, useGoogleComplete, useGoogleLogin, type GoogleNeedsProfile } from "./hooks"
import { PLAY_COUNTRIES, PLAY_LANGUAGES, ageOn, countryCode, minimumAge } from "./signup"
import { useAuthText } from "./text"

type Res = { status?: number; headers?: Record<string, string>; data?: { detail?: string } }

function res(err: unknown): Res | undefined {
  return (err as { response?: Res })?.response
}

export function useGoogleFlow(onSignedIn: (user: UserInfo) => void) {
  const login = useGoogleLogin()
  const complete = useGoogleComplete()
  const [credential, setCredential] = useState("")
  const [profile, setProfile] = useState<GoogleNeedsProfile | null>(null)
  const [needsCode, setNeedsCode] = useState(false)
  const [error, setError] = useState("")

  const send = useCallback(async (token: string, code?: string) => {
    setError("")
    try {
      const r = await login.mutateAsync({ token, code })
      if (needsProfile(r)) setProfile(r)
      else onSignedIn(r.user)
    } catch (err) {
      const r = res(err)
      if (r?.headers?.["x-totp-required"]) {
        setNeedsCode(true)
        if (code) setError(r.data?.detail ?? "")
        return
      }
      setError(r?.data?.detail ?? "")
      if (!r) setError("Google sign-in failed. Please try again.")
    }
  }, [login, onSignedIn])

  const onCredential = useCallback((token: string) => {
    setCredential(token)
    setNeedsCode(false)
    void send(token)
  }, [send])

  const submitCode = useCallback((code: string) => send(credential, code.trim()), [credential, send])

  const finish = useCallback(async (body: { birth_date: string; country: string; language: string; name?: string; invite?: string | null }) => {
    if (!profile) return
    setError("")
    try {
      const r = await complete.mutateAsync({ ticket: profile.ticket, ...body })
      onSignedIn(r.user)
    } catch (err) {
      const r = res(err)
      setError(r?.data?.detail ?? "That account could not be created.")
      if (r?.status === 401) setProfile(null)
    }
  }, [complete, onSignedIn, profile])

  const reset = useCallback(() => {
    setProfile(null)
    setNeedsCode(false)
    setError("")
  }, [])

  return { enabled: Boolean(googleClientId), onCredential, profile, needsCode, submitCode, finish, error, pending: login.isPending || complete.isPending, reset }
}

const INPUT =
  "w-full h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 placeholder:text-gray-400 outline-none transition-colors focus:border-[#632B4F] focus:ring-1 focus:ring-[#632B4F]"
const BUTTON =
  "inline-flex h-10 w-full items-center justify-center rounded-lg bg-gradient-to-r from-[#632B4F] to-[#B44A32] text-sm font-semibold text-white transition-colors hover:from-[#552444] hover:to-[#9E3F2B] disabled:cursor-not-allowed disabled:opacity-50"

function Divider({ label }: { label: string }) {
  return (
    <div className="relative my-5">
      <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-gray-200" /></div>
      <div className="relative flex justify-center text-xs uppercase"><span className="bg-white px-3 text-gray-500">{label}</span></div>
    </div>
  )
}

export function GoogleSignIn({ onSignedIn, children }: { onSignedIn: (user: UserInfo) => void; children: React.ReactNode }) {
  const { t } = useAuthText()
  const flow = useGoogleFlow(onSignedIn)
  const [code, setCode] = useState("")
  const [form, setForm] = useState({ birthDate: "", country: "IN", language: "en", invite: "" })
  const [local, setLocal] = useState("")
  const today = new Date().toISOString().slice(0, 10)

  if (!flow.enabled) return <>{children}</>

  if (flow.profile) {
    const p = flow.profile
    const submit = (e: FormEvent) => {
      e.preventDefault()
      setLocal("")
      const age = ageOn(form.birthDate)
      const needed = minimumAge(form.country)
      if (age === null || age < needed) {
        setLocal(t("signup.tooYoung", { age: String(needed) }))
        return
      }
      void flow.finish({ birth_date: form.birthDate, country: countryCode(form.country), language: form.language, invite: form.invite.trim() || null })
    }
    return (
      <form onSubmit={submit} className="space-y-4">
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
          <span className="block font-medium text-gray-900">{t("google.finishTitle")}</span>
          {t("google.signingUpAs", { email: p.email })}
        </div>
        <label className="block space-y-1.5">
          <span className="block text-sm text-gray-600">{t("signup.birthDate")}</span>
          <input className={INPUT} type="date" max={today} value={form.birthDate} onChange={(e) => setForm({ ...form, birthDate: e.target.value })} required autoComplete="bday" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1.5">
            <span className="block text-sm text-gray-600">{t("signup.country")}</span>
            <select className={INPUT} value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })}>
              {PLAY_COUNTRIES.map((c) => <option key={c} value={c}>{c === "other" ? t("country.other") : t(`country.${c}` as "country.IN")}</option>)}
            </select>
          </label>
          <label className="block space-y-1.5">
            <span className="block text-sm text-gray-600">{t("signup.language")}</span>
            <select className={INPUT} value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })}>
              {PLAY_LANGUAGES.map((l) => <option key={l} value={l}>{t(`language.${l}` as "language.en")}</option>)}
            </select>
          </label>
        </div>
        {p.invite_needed && (
          <label className="block space-y-1.5">
            <span className="block text-sm text-gray-600">{t("google.invite")}</span>
            <input className={`${INPUT} font-mono uppercase`} value={form.invite} onChange={(e) => setForm({ ...form, invite: e.target.value })} required minLength={4} maxLength={40} autoComplete="off" />
          </label>
        )}
        <p className="text-xs text-gray-500">{t("signup.ageRule")}</p>
        {(local || flow.error) && <div role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{local || flow.error}</div>}
        <button type="submit" className={BUTTON} disabled={flow.pending}>{flow.pending ? t("signup.creating") : t("signup.submit")}</button>
        <button type="button" onClick={flow.reset} className="w-full text-sm text-[#632B4F] hover:underline">{t("google.back")}</button>
      </form>
    )
  }

  return (
    <>
      <GoogleButton onCredential={flow.onCredential} />
      {flow.needsCode && (
        <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); void flow.submitCode(code) }}>
          <label className="block space-y-1.5">
            <span className="block text-sm text-gray-600">{t("login.code")}</span>
            <input className={`${INPUT} tracking-widest`} inputMode="numeric" autoComplete="one-time-code" autoFocus value={code} onChange={(e) => setCode(e.target.value)} required />
          </label>
          <button type="submit" className={BUTTON} disabled={flow.pending}>{t("login.submit")}</button>
        </form>
      )}
      {flow.error && <div role="alert" className="mt-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{flow.error}</div>}
      <Divider label={t("login.or")} />
      {children}
    </>
  )
}
