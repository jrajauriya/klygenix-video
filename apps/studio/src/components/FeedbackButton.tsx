import { useState } from "react"
import { useLocation } from "react-router-dom"
import { toast } from "sonner"
import { MessageSquarePlus } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { Button, Field, Modal, Select, Textarea } from "@klygenixvideo/ui"
import { detail } from "../lib/format"

const APP_VERSION = (import.meta.env.VITE_APP_VERSION as string | undefined) ?? "0.0.1"
const MAX_BYTES = 1_500_000

const KINDS = [
  { value: "bug", label: "Something is broken" },
  { value: "idea", label: "An idea" },
  { value: "other", label: "Something else" },
]

function readImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error("The screenshot could not be read"))
    reader.readAsDataURL(file)
  })
}

export function FeedbackButton({ app, label = "Feedback" }: { app: "studio" | "admin"; label?: string }) {
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState("bug")
  const [body, setBody] = useState("")
  const [shot, setShot] = useState<File | null>(null)
  const [shotError, setShotError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)

  function close() {
    setOpen(false)
    setBody("")
    setShot(null)
    setShotError(undefined)
    setKind("bug")
  }

  function pick(file: File | null) {
    setShotError(undefined)
    if (file && !["image/png", "image/jpeg"].includes(file.type)) {
      setShotError("A PNG or JPEG image.")
      setShot(null)
      return
    }
    if (file && file.size > MAX_BYTES) {
      setShotError("At most 1.5 MB.")
      setShot(null)
      return
    }
    setShot(file)
  }

  async function send() {
    setBusy(true)
    try {
      const screenshot = shot ? await readImage(shot) : undefined
      const { data } = await api.post<{ reference: string }>("/api/video/feedback", {
        kind,
        body: body.trim(),
        page: (location.pathname + location.search).slice(0, 300),
        app,
        app_version: APP_VERSION,
        screenshot,
      })
      toast.success(`Thanks. Your reference is ${data.reference}.`)
      close()
    } catch (err) {
      toast.error(err instanceof Error && !("response" in err) ? err.message : detail(err, "Your feedback could not be sent"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm font-semibold text-slate-700 hover:border-brand hover:text-brand"
      >
        <MessageSquarePlus size={15} aria-hidden="true" /> <span className="hidden sm:inline">{label}</span>
        <span className="sr-only sm:hidden">{label}</span>
      </button>
      {open && (
        <Modal
          open
          onClose={close}
          title="Send feedback"
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={close} disabled={busy}>Cancel</Button>
              <Button onClick={send} disabled={busy || body.trim().length < 3 || Boolean(shotError)}>{busy ? "Sending…" : "Send"}</Button>
            </div>
          }
        >
          <div className="space-y-4">
            <Field label="What is it about?">
              <Select value={kind} onChange={setKind} options={KINDS} />
            </Field>
            <Field label="Tell us" required hint="What you did, what you expected, what happened. We read every message.">
              <Textarea rows={5} value={body} maxLength={5000} onChange={(e) => setBody(e.target.value)} autoFocus />
            </Field>
            <Field label="Screenshot" error={shotError} hint="Optional. PNG or JPEG, up to 1.5 MB.">
              <input
                type="file"
                accept="image/png,image/jpeg"
                onChange={(e) => pick(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-slate-700"
              />
            </Field>
            <p className="text-xs text-slate-500">We also send the page you are on ({location.pathname}) and the app version.</p>
          </div>
        </Modal>
      )}
    </>
  )
}
