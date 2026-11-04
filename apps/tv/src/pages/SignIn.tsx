import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { useAuthStore } from "@klygenixvideo/auth"
import type { UserInfo } from "@klygenixvideo/types"
import { api, errText } from "../lib/api"
import { host } from "../lib/format"
import { deviceName } from "../lib/device"
import { slot, useT } from "../lib/i18n"
import type { DeviceStart } from "../lib/types"
import { Qr } from "../components/Qr"

type State = "starting" | "waiting" | "denied" | "expired" | "error"

export default function SignIn() {
  const setAuth = useAuthStore((s) => s.setAuth)
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [round, setRound] = useState(0)
  const [start, setStart] = useState<DeviceStart | null>(null)
  const [state, setState] = useState<State>("starting")
  const [problem, setProblem] = useState("")
  const t = useT()

  useEffect(() => {
    let alive = true
    let timer = 0
    setState("starting")
    setStart(null)
    api.post<DeviceStart>("/api/auth/device/start", { client: "tv", name: deviceName() })
      .then(({ data }) => {
        if (!alive) return
        setStart(data)
        setState("waiting")
        let wait = Math.max(1, data.interval) * 1000
        const deadline = Date.now() + data.expires_in * 1000
        const poll = async () => {
          if (!alive) return
          if (Date.now() > deadline) {
            setState("expired")
            return
          }
          try {
            const { data: tok } = await api.post<{ access_token: string; user: UserInfo }>("/api/auth/device/poll", { device_code: data.device_code })
            if (!alive) return
            setAuth(tok.access_token, tok.user)
            qc.clear()
            navigate("/", { replace: true })
            return
          } catch (err) {
            if (!alive) return
            const code = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
            if (code === "access_denied") {
              setState("denied")
              return
            }
            if (code === "expired_token") {
              setState("expired")
              return
            }
            if (code === "slow_down") wait += 5000
          }
          timer = window.setTimeout(poll, wait)
        }
        timer = window.setTimeout(poll, wait)
      })
      .catch((err) => {
        if (!alive) return
        setProblem(errText(err, t("A sign-in code could not be made. Try again.")))
        setState("error")
      })
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [round])

  const message = {
    starting: t("Getting a code…"),
    waiting: t("Waiting for you to approve on your phone…"),
    denied: t("Sign-in was declined on your phone."),
    expired: t("This code has expired."),
    error: problem,
  }[state]

  return (
    <div className="safe-x">
      <h1 className="text-5xl font-bold">{t("Sign in with your phone")}</h1>
      <div className="mt-10 flex items-start gap-16">
        <div className="max-w-[60rem] flex-1">
          <ol className="list-decimal space-y-6 pl-10 text-3xl leading-snug">
            <li>
              {slot(t("On your phone or computer, open {site}"), "site", <strong className="text-brand-soft">{start ? host(start.verification_uri) : "…"}</strong>)}
            </li>
            <li>
              {t("Enter this code:")}
              <span className="mt-4 block font-mono text-[6rem] font-extrabold leading-none tracking-[0.2em]" aria-label={start ? start.user_code.split("").join(" ") : t("Code loading")}>
                {start?.user_code ?? "····-····"}
              </span>
            </li>
            <li>{t("Approve the TV. This screen moves on by itself.")}</li>
          </ol>
          <p role="status" className={`mt-8 text-2xl ${state === "waiting" || state === "starting" ? "text-muted" : "text-[#fda4af]"}`}>{message}</p>
          <div className="mt-8 flex gap-6" data-focus-group>
            <button type="button" data-autofocus onClick={() => setRound(round + 1)} className={`rounded-full px-10 py-4 text-2xl font-semibold ${state === "waiting" || state === "starting" ? "bg-panel-3 text-ink" : "bg-brand text-white"}`}>
              {t("Get a new code")}
            </button>
          </div>
        </div>
        {start && (
          <figure className="flex flex-col items-center gap-4">
            <Qr text={start.verification_uri_complete} label={t("QR code that opens the sign-in page with this code filled in")} />
            <figcaption className="text-xl text-muted">{t("Or scan with your phone camera")}</figcaption>
          </figure>
        )}
      </div>
    </div>
  )
}
