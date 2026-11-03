import { useState } from "react"
import { Navigate, useNavigate } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Tv } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { Button, Card, Field, Input, Select, Spinner, Textarea } from "@klygenixvideo/ui"
import { STUDIO, useChannel } from "../lib/hooks"
import { LANGUAGES, detail } from "../lib/format"

const slug = (name: string) =>
  name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40)

export default function Onboarding() {
  const { data: channel, isLoading } = useChannel()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [name, setName] = useState("")
  const [handle, setHandle] = useState("")
  const [touched, setTouched] = useState(false)
  const [about, setAbout] = useState("")
  const [language, setLanguage] = useState("en")
  const [busy, setBusy] = useState(false)

  if (isLoading) return <Spinner />
  if (channel) return <Navigate to="/" replace />

  const shownHandle = touched ? handle : slug(name)
  const handleOk = !shownHandle || /^[a-z0-9][a-z0-9-]{2,39}$/.test(shownHandle)

  async function open() {
    setBusy(true)
    try {
      const { data } = await api.post(`${STUDIO}/channel`, {
        name: name.trim(),
        handle: shownHandle || null,
        about: about.trim(),
        language,
      })
      qc.setQueryData(["studio-channel"], data)
      qc.invalidateQueries({ queryKey: ["video-me"] })
      toast.success("Your channel is open")
      navigate("/", { replace: true })
    } catch (err) {
      toast.error(detail(err, "The channel could not be opened"))
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-xl py-6">
      <div className="mb-5 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-50 text-brand">
          <Tv size={22} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-navy">Open your channel</h1>
          <p className="text-sm text-slate-500">Your channel is where your videos and reels live. You can change these later.</p>
        </div>
      </div>
      <Card className="space-y-4 p-5">
        <Field label="Channel name" required>
          <Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Asha Codes" autoFocus />
        </Field>
        <Field
          label="Handle"
          hint="3 to 40 letters, numbers or hyphens. Your public page will be at /@handle."
          error={handleOk ? undefined : "Use 3 to 40 lowercase letters, numbers or hyphens"}
        >
          <div className="flex items-center gap-1">
            <span className="text-sm font-semibold text-slate-500">@</span>
            <Input
              value={shownHandle}
              maxLength={40}
              onChange={(e) => {
                setTouched(true)
                setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))
              }}
              placeholder="asha-codes"
            />
          </div>
        </Field>
        <Field label="About">
          <Textarea rows={3} value={about} maxLength={2000} onChange={(e) => setAbout(e.target.value)}
            placeholder="What your channel is about, in a line or two" />
        </Field>
        <Field label="Main language">
          <Select value={language} onChange={setLanguage} options={LANGUAGES} />
        </Field>
        <div className="flex justify-end">
          <Button onClick={open} disabled={busy || !name.trim() || !handleOk}>
            {busy ? "Opening…" : "Open my channel"}
          </Button>
        </div>
      </Card>
    </div>
  )
}
