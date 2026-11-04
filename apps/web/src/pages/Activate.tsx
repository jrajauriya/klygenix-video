import { useEffect, useRef, useState, type FormEvent } from "react"
import { Link, Navigate, useSearchParams } from "react-router-dom"
import { CheckCircle2, Loader2, Tv, XCircle } from "lucide-react"
import { api, useAuthStore } from "@klygenixvideo/auth"
import { AuthShell, ErrorNote } from "../components/AuthShell"
import { rich } from "../i18n/rich"
import { Btn, Field, INPUT } from "../components/bits"
import { errStatus, errText, loginPath, useSignedIn } from "../lib/api"
import { useTitle } from "../lib/title"
import { locale } from "../lib/format"
import { useT } from "../i18n"

interface DeviceRequest {
  user_code: string
  client: string
  status: string
  expires_in: number
  name?: string
  requested_at?: string
}

const CLIENTS: Record<string, string> = { tv: "TV", android_tv: "Android TV", fire_tv: "Fire TV", console: "Games console" }

function tidy(raw: string): string {
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8)
  return s.length > 4 ? `${s.slice(0, 4)}-${s.slice(4)}` : s
}

function when(iso: string | undefined): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  const today = new Date().toDateString() === d.toDateString()
  return today ? d.toLocaleTimeString(locale(), { hour: "numeric", minute: "2-digit" }) : d.toLocaleString(locale(), { dateStyle: "medium", timeStyle: "short" })
}

export default function ActivatePage() {
  const t = useT("account")
  useTitle("Sign in on your TV")
  const signedIn = useSignedIn()
  const user = useAuthStore((s) => s.user)
  const [params] = useSearchParams()
  const [code, setCode] = useState(tidy(params.get("code") ?? ""))
  const [request, setRequest] = useState<DeviceRequest | null>(null)
  const [busy, setBusy] = useState<"look" | "approve" | "deny" | null>(null)
  const [error, setError] = useState("")
  const [outcome, setOutcome] = useState<"approved" | "denied" | null>(null)
  const auto = useRef(false)

  async function look(value = code) {
    setError("")
    setBusy("look")
    try {
      const { data } = await api.get<DeviceRequest>(`/api/auth/device/${encodeURIComponent(value)}`)
      setRequest(data)
      if (data.status !== "pending") setError(t("That code was already used. Start again on your TV."))
    } catch (err) {
      setRequest(null)
      setError(errStatus(err) === 404 ? errText(err, t("That code is not valid or has expired. Start again on your TV.")) : errText(err, t("We could not check that code. Try again.")))
    } finally {
      setBusy(null)
    }
  }

  useEffect(() => {
    if (!signedIn || auto.current || code.replace("-", "").length !== 8) return
    auto.current = true
    void look(code)
  }, [signedIn])

  async function decide(kind: "approve" | "deny") {
    if (!request) return
    setError("")
    setBusy(kind)
    try {
      await api.post(`/api/auth/device/${kind}`, { user_code: request.user_code })
      setOutcome(kind === "approve" ? "approved" : "denied")
    } catch (err) {
      const status = errStatus(err)
      setError(status === 409 ? errText(err, t("That code was already used.")) : status === 404 ? errText(err, t("That code has expired. Start again on your TV.")) : errText(err, t("That did not work. Try again.")))
    } finally {
      setBusy(null)
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    setRequest(null)
    setOutcome(null)
    void look()
  }

  if (!signedIn) {
    const back = `/activate${code ? `?code=${encodeURIComponent(code)}` : ""}`
    return <Navigate to={loginPath(back)} replace />
  }

  const device = request?.name || (request ? t(CLIENTS[request.client] ?? "TV") : t("TV"))

  if (outcome) {
    return (
      <AuthShell title={outcome === "approved" ? t("Your {device} is signing in", { device }) : t("Sign-in request denied")} footer={<Link to="/" className="font-semibold text-brand-soft hover:underline">{t("Back to Klygenix Play")}</Link>}>
        <div role="status" className="space-y-3 text-center">
          {outcome === "approved" ? (
            <>
              <CheckCircle2 size={44} className="mx-auto text-[#4ade80]" aria-hidden="true" />
              <p className="text-sm text-muted">{rich(t("Look at your {device} — it will finish signing in as {email} in a few seconds. You can close this page.", { device }), { email: <span className="font-semibold text-ink">{user?.email}</span> })}</p>
            </>
          ) : (
            <>
              <XCircle size={44} className="mx-auto text-[#f87171]" aria-hidden="true" />
              <p className="text-sm text-muted">{t("The {device} was not signed in. If you didn't start this, you don't need to do anything else.", { device })}</p>
            </>
          )}
        </div>
      </AuthShell>
    )
  }

  const pending = request?.status === "pending"
  return (
    <AuthShell
      title={t("Sign in on your TV")}
      subtitle={t("Enter the code shown on your TV screen.")}
      footer={<p className="text-xs text-faint">{t("Only approve a code you see on your own screen. Approving lets that device use your account until you sign it out.")}</p>}
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label={t("TV code")} hint={t("8 letters and numbers, like ABCD-2345")}>
          <input
            className={`${INPUT} h-12 text-center font-mono text-xl font-semibold uppercase tracking-[0.3em]`}
            value={code}
            onChange={(e) => {
              setCode(tidy(e.target.value))
              setRequest(null)
              setError("")
            }}
            required
            minLength={9}
            maxLength={9}
            autoComplete="one-time-code"
            autoCapitalize="characters"
            spellCheck={false}
            inputMode="text"
          />
        </Field>
        {!request && (
          <Btn type="submit" tone="brand" size="lg" className="w-full" disabled={busy !== null || code.length !== 9}>
            {busy === "look" ? <><Loader2 size={16} className="animate-spin" aria-hidden="true" /> {t("Checking…")}</> : t("Continue")}
          </Btn>
        )}
      </form>

      {error && <div className="mt-4"><ErrorNote>{error}</ErrorNote></div>}

      {request && pending && (
        <div className="mt-5 space-y-4 rounded-2xl border border-brand/40 bg-brand/[0.08] p-4">
          <div className="flex items-start gap-3">
            <Tv size={22} className="mt-0.5 shrink-0 text-brand-soft" aria-hidden="true" />
            <div className="text-sm">
              <h2 className="text-base font-bold">{t("Sign in on {device}?", { device })}</h2>
              <p className="mt-1">{rich(t("{device} wants to sign in to Klygenix Play as {email}.", { device }), { email: <span className="font-semibold">{user?.email}</span> })}</p>
              <p className="mt-1 text-xs text-muted">
                {request.requested_at ? `${t("Requested at {time}", { time: when(request.requested_at) })} · ` : ""}
                {t("Code {code} · expires in {n} min", { code: request.user_code, n: Math.max(1, Math.round(request.expires_in / 60)) })}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Btn tone="ghost" className="flex-1" disabled={busy !== null} onClick={() => decide("deny")}>{busy === "deny" ? t("Denying…") : t("Deny")}</Btn>
            <Btn tone="brand" className="flex-1" disabled={busy !== null} onClick={() => decide("approve")}>{busy === "approve" ? t("Approving…") : t("Approve")}</Btn>
          </div>
        </div>
      )}
    </AuthShell>
  )
}
