import { useState } from "react"
import { Navigate, useNavigate, useSearchParams } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Tv } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { Button, Card, Field, Input, Select, Spinner, Textarea } from "@klygenixvideo/ui"
import { STUDIO, useChannel } from "../lib/hooks"
import { LANGUAGES, detail, status } from "../lib/format"

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
  const [params] = useSearchParams()
  const [invite, setInvite] = useState(params.get("invite") ?? "")
  const [refused, setRefused] = useState<string | null>(null)
  const { data: beta, isLoading: betaLoading } = useQuery({
    queryKey: ["video-beta"],
    queryFn: async () => (await api.get<{ signup: string; creator: "open" | "invite" | "closed" }>("/api/video/beta")).data,
    staleTime: 60_000,
  })

  if (isLoading || betaLoading) return <Spinner />
  if (channel) return <Navigate to="/" replace />

  const shownHandle = touched ? handle : slug(name)
  const handleOk = !shownHandle || /^[a-z0-9][a-z0-9-]{2,39}$/.test(shownHandle)
  const mode = beta?.creator ?? "open"
  const needsInvite = mode === "invite"

  async function open() {
    setBusy(true)
    try {
      const { data } = await api.post(`${STUDIO}/channel`, {
        name: name.trim(),
        handle: shownHandle || null,
        about: about.trim(),
        language,
        invite: needsInvite ? invite.trim() || null : undefined,
      })
      qc.setQueryData(["studio-channel"], data)
      qc.invalidateQueries({ queryKey: ["video-me"] })
      toast.success("Your channel is open")
      navigate("/", { replace: true })
    } catch (err) {
      const message = detail(err, "The channel could not be opened")
      if (status(err) === 403) setRefused(message)
      toast.error(message)
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
      {mode === "closed" && (
        <p role="status" className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900">
          New channels are paused during the beta. You can still watch, follow and comment. We will email you when channels open again.
        </p>
      )}
      {refused && (
        <p role="alert" className="mb-4 rounded-lg border border-red-300 bg-red-50 px-3.5 py-2.5 text-sm text-red-800">{refused}</p>
      )}
      <Card className="space-y-4 p-5">
        {needsInvite && (
          <Field label="Creator invite code" required hint="Channels are invite-only during the beta. The code is in your invite email.">
            <Input value={invite} maxLength={40} autoComplete="off" onChange={(e) => { setInvite(e.target.value.toUpperCase()); setRefused(null) }}
              placeholder="XXXX-XXXX-XXXX" />
          </Field>
        )}
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
          <Button onClick={open} disabled={busy || !name.trim() || !handleOk || mode === "closed" || (needsInvite && invite.trim().length < 4)}>
            {busy ? "Opening…" : "Open my channel"}
          </Button>
        </div>
      </Card>
    </div>
  )
}
