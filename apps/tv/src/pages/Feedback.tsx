import { useState } from "react"
import { useLocation } from "react-router-dom"
import { TV_VERSION, api, errText } from "../lib/api"
import { Keyboard, TypedText } from "../components/Keyboard"
import { useT } from "../lib/i18n"

const KINDS = [
  { key: "bug", label: "Something is broken" },
  { key: "idea", label: "An idea" },
  { key: "other", label: "Something else" },
] as const

export default function Feedback() {
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? "/feedback"
  const [kind, setKind] = useState<(typeof KINDS)[number]["key"]>("bug")
  const [body, setBody] = useState("")
  const [sending, setSending] = useState(false)
  const [note, setNote] = useState("")
  const [reference, setReference] = useState("")
  const t = useT()

  async function send() {
    if (sending) return
    if (body.trim().length < 3) {
      setNote(t("Write at least three characters."))
      return
    }
    setSending(true)
    setNote("")
    try {
      const { data } = await api.post<{ reference: string }>("/api/video/feedback", { kind, body: body.trim(), page: from, app: "tv", app_version: TV_VERSION })
      setReference(data.reference)
      setBody("")
    } catch (err) {
      setNote(errText(err, t("Your feedback could not be sent. Try again.")))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="safe-x grid grid-cols-[1fr_60rem] gap-14">
      <div>
        <h1 className="text-5xl font-bold">{t("Send feedback")}</h1>
        <p className="mt-4 text-2xl leading-snug text-muted">{t("Tell us what went wrong or what would make Play better on your TV.")}</p>
        <div role="group" aria-label={t("Kind of feedback")} className="mt-8 flex flex-col gap-4" data-focus-group>
          {KINDS.map((k) => (
            <button key={k.key} type="button" aria-pressed={kind === k.key} onClick={() => setKind(k.key)}
              className={`rounded-xl px-6 py-4 text-left text-2xl font-semibold ${kind === k.key ? "bg-brand text-white" : "bg-panel-3 text-ink"}`}>
              {t(k.label)}
            </button>
          ))}
        </div>
        {reference && <p role="status" className="mt-8 text-2xl text-[#86efac]">{t("Thank you. Your reference is {ref}.", { ref: reference })}</p>}
        {note && <p role="alert" className="mt-8 text-2xl text-[#fda4af]">{note}</p>}
      </div>
      <div>
        <TypedText id="feedback" label={t("Your feedback")} value={body} placeholder={t("Type with the keys below")} />
        <div className="mt-6">
          <Keyboard label={t("On-screen keyboard")} value={body} onChange={setBody} onSubmit={send} submitLabel={sending ? t("Sending…") : t("Send")} max={2000} auto />
        </div>
      </div>
    </div>
  )
}
