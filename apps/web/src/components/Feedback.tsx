import { useState } from "react"
import { useLocation } from "react-router-dom"
import { CheckCircle2, ImagePlus, X } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { cn } from "@klygenixvideo/ui"
import { Sheet } from "./Sheet"
import { Btn, Field, INPUT, TEXTAREA } from "./bits"
import { errStatus, errText, useSignedIn } from "../lib/api"
import { APP_VERSION } from "../lib/beta"
import { useT } from "../i18n"

const KINDS = [
  { key: "bug", label: "Something's broken" },
  { key: "idea", label: "An idea" },
  { key: "other", label: "Something else" },
] as const

const MAX_BYTES = 1.5 * 1024 * 1024

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}

export default function FeedbackDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT("home")
  const signedIn = useSignedIn()
  const location = useLocation()
  const [kind, setKind] = useState<string>("bug")
  const [body, setBody] = useState("")
  const [email, setEmail] = useState("")
  const [shot, setShot] = useState<{ name: string; data: string } | null>(null)
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  const [reference, setReference] = useState<string | null>(null)

  function close() {
    setBody("")
    setShot(null)
    setError("")
    setReference(null)
    setKind("bug")
    onClose()
  }

  async function pick(file: File | undefined) {
    setError("")
    if (!file) return
    if (file.type !== "image/png" && file.type !== "image/jpeg") {
      setError(t("The screenshot must be a PNG or JPEG image."))
      return
    }
    if (file.size > MAX_BYTES) {
      setError(t("The screenshot is too large. Keep it under 1.5 MB."))
      return
    }
    try {
      setShot({ name: file.name, data: await readDataUrl(file) })
    } catch {
      setError(t("That image could not be read."))
    }
  }

  async function submit() {
    const text = body.trim()
    if (text.length < 3) {
      setError(t("Tell us a little more (at least 3 characters)."))
      return
    }
    setError("")
    setPending(true)
    try {
      const { data } = await api.post<{ id: number; reference: string }>("/api/video/feedback", {
        kind, body: text, page: location.pathname, app: "web", app_version: APP_VERSION,
        email: !signedIn && email.trim() ? email.trim() : null,
        screenshot: shot?.data ?? null,
      })
      setReference(data.reference)
    } catch (err) {
      setError(errStatus(err) === 429 ? t("You've sent a lot of feedback just now. Try again in a little while.") : errText(err, t("Your feedback could not be sent. Try again.")))
    } finally {
      setPending(false)
    }
  }

  return (
    <Sheet
      open={open}
      onClose={close}
      title={reference ? t("Thanks for your feedback") : t("Send feedback")}
      footer={reference ? (
        <Btn tone="brand" onClick={close}>{t("Done")}</Btn>
      ) : (
        <>
          <Btn tone="ghost" onClick={close}>{t("Cancel")}</Btn>
          <Btn tone="brand" disabled={pending || body.trim().length < 3} onClick={submit}>{pending ? t("Sending…") : t("Send feedback")}</Btn>
        </>
      )}
    >
      {reference ? (
        <div role="status" className="space-y-3 py-2 text-center">
          <CheckCircle2 size={36} className="mx-auto text-[#4ade80]" aria-hidden="true" />
          <p className="text-sm">{t("Your reference is")} <span className="rounded-md bg-white/10 px-2 py-0.5 font-mono font-semibold">{reference}</span>.</p>
          <p className="text-sm text-muted">{t("Our team reads every message. Quote the reference if you write to us about it.")}</p>
        </div>
      ) : (
        <div className="space-y-4">
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-muted">{t("What is it about?")}</legend>
            <div className="flex flex-wrap gap-1.5">
              {KINDS.map((k) => (
                <label
                  key={k.key}
                  className={cn(
                    "cursor-pointer rounded-full px-3.5 py-1.5 text-sm font-medium has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand",
                    kind === k.key ? "bg-snow text-black" : "bg-white/[0.08] text-ink hover:bg-white/15",
                  )}
                >
                  <input type="radio" name="feedback-kind" value={k.key} checked={kind === k.key} onChange={() => setKind(k.key)} className="sr-only" />
                  {t(k.label)}
                </label>
              ))}
            </div>
          </fieldset>
          <Field label={kind === "bug" ? t("What went wrong?") : kind === "idea" ? t("What's your idea?") : t("Your message")} hint={t("If it's about a video, include its link or title.")}>
            <textarea className={TEXTAREA} rows={5} value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} required />
          </Field>
          {!signedIn && (
            <Field label={t("Your email (optional)")} hint={t("So we can reply and send you the reference.")}>
              <input className={INPUT} type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} autoComplete="email" />
            </Field>
          )}
          <div>
            {shot ? (
              <div className="flex items-center gap-3 rounded-xl border border-line bg-panel-2 p-2">
                <img src={shot.data} alt={t("Screenshot preview")} className="h-12 w-16 shrink-0 rounded-md object-cover" />
                <span className="min-w-0 flex-1 truncate text-sm">{shot.name}</span>
                <button type="button" onClick={() => setShot(null)} aria-label={t("Remove screenshot")} className="rounded-full p-1.5 text-muted hover:bg-white/10 hover:text-ink">
                  <X size={16} aria-hidden="true" />
                </button>
              </div>
            ) : (
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-white/[0.08] px-3.5 py-2 text-sm font-medium hover:bg-white/15 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand">
                <input
                  type="file"
                  accept="image/png,image/jpeg"
                  className="sr-only"
                  onChange={(e) => {
                    void pick(e.target.files?.[0])
                    e.target.value = ""
                  }}
                />
                <ImagePlus size={16} aria-hidden="true" /> {t("Add a screenshot")} <span className="text-xs text-muted">{t("(optional, PNG or JPEG, up to 1.5 MB)")}</span>
              </label>
            )}
          </div>
          {error && <p role="alert" className="rounded-xl border border-[#7f1d1d] bg-[#450a0a]/60 px-3 py-2 text-sm text-[#fecaca]">{error}</p>}
          <p className="text-xs text-faint">{t("We attach the page you're on and your browser version so we can reproduce problems.")}</p>
        </div>
      )}
    </Sheet>
  )
}
