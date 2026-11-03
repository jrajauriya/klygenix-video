import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { ExternalLink, ImageUp, Instagram, Link2, RefreshCw, Save, ShieldCheck, Unplug, Youtube } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import {
  Badge, Button, Card, Field, Input, PageHeader, Select, Spinner, Tabs, Textarea, useConfirm,
} from "@klygenixvideo/ui"
import { MULTIPART, STUDIO, useChannel } from "../lib/hooks"
import { LANGUAGES, channelUrl, detail, when } from "../lib/format"
import type { Channel, Connected, StudioVideo } from "../lib/types"
import { ChannelAvatar } from "../components/ChannelAvatar"
import { Playlists } from "../components/channel/Playlists"

const TABS = [
  { key: "profile", label: "Profile" },
  { key: "playlists", label: "Playlists" },
]

export default function ChannelPage() {
  const { data: channel, isLoading } = useChannel()
  const [params, setParams] = useSearchParams()
  const tab = params.get("tab") === "playlists" ? "playlists" : "profile"
  const handled = useRef(false)

  useEffect(() => {
    const flag = params.get("connected")
    if (!flag || handled.current) return
    handled.current = true
    const ig = connectingPlatform() === "instagram"
    const name = ig ? "Instagram" : "YouTube"
    if (flag === "1") toast.success(ig ? "Instagram is connected. You can publish clips to Instagram Reels." : "YouTube is connected. Your videos are being linked now.")
    else if (flag === "taken") toast.error(`That ${name} account is already connected to another Klygenix Play account.`)
    else toast.error(`${name} was not connected.`)
    setParams({}, { replace: true })
  }, [params, setParams])

  if (isLoading || !channel) return <Spinner />

  return (
    <div className="pb-8">
      <PageHeader
        title="Channel"
        subtitle="Your public profile, your playlists, and the other platforms your videos live on."
        actions={
          <a href={channelUrl(channel.handle)} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:border-brand hover:text-brand">
            <ExternalLink size={14} /> @{channel.handle}
          </a>
        }
      />
      <Tabs tabs={TABS} active={tab} onChange={(k) => setParams(k === "playlists" ? { tab: k } : {}, { replace: true })} />
      {tab === "playlists" ? (
        <Playlists />
      ) : (
        <div className="grid gap-5 xl:grid-cols-2 [&>*]:min-w-0">
          <Profile channel={channel} />
          <div className="space-y-5">
            <Rule />
            <ConnectedAccounts />
            <AddByLink />
          </div>
        </div>
      )}
    </div>
  )
}

const CONNECTING = "kv-studio-connecting"

function connectingPlatform(): string | null {
  try {
    const v = sessionStorage.getItem(CONNECTING)
    sessionStorage.removeItem(CONNECTING)
    return v
  } catch {
    return null
  }
}

function rememberConnecting(platform: string) {
  try {
    sessionStorage.setItem(CONNECTING, platform)
  } catch {
    return
  }
}

function Section({ title, hint, children, action }: { title: string; hint?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <Card className="p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-navy">{title}</h2>
          {hint && <p className="mt-0.5 text-sm text-slate-500">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </Card>
  )
}

function Profile({ channel }: { channel: Channel }) {
  const qc = useQueryClient()
  const [name, setName] = useState(channel.name)
  const [about, setAbout] = useState(channel.about)
  const [language, setLanguage] = useState(channel.language)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState<"avatar" | "banner" | null>(null)
  const avatarRef = useRef<HTMLInputElement>(null)
  const bannerRef = useRef<HTMLInputElement>(null)

  const update = (c: Channel) => {
    qc.setQueryData(["studio-channel"], c)
    qc.invalidateQueries({ queryKey: ["video-me"] })
  }

  async function save() {
    setSaving(true)
    try {
      const { data } = await api.patch<Channel>(`${STUDIO}/channel`, { name: name.trim(), about, language })
      update(data)
      toast.success("Channel saved")
    } catch (err) {
      toast.error(detail(err, "Could not save the channel"))
    } finally {
      setSaving(false)
    }
  }

  async function image(kind: "avatar" | "banner", file: File) {
    const body = new FormData()
    body.append("file", file)
    setUploading(kind)
    try {
      const { data } = await api.post<Channel>(`${STUDIO}/channel/${kind}`, body, MULTIPART)
      update(data)
      toast.success(kind === "avatar" ? "Picture updated" : "Banner updated")
    } catch (err) {
      toast.error(detail(err, "That image could not be used"))
    } finally {
      setUploading(null)
    }
  }

  const picker = (kind: "avatar" | "banner", ref: RefObject<HTMLInputElement | null>) => (
    <input ref={ref} type="file" accept="image/*" className="hidden"
      onChange={(e) => {
        const f = e.target.files?.[0]
        if (f) image(kind, f)
        e.target.value = ""
      }} />
  )

  return (
    <Section title="Profile" hint="What viewers see on your channel page.">
      <div className="relative mb-12">
        <div className="h-32 overflow-hidden rounded-lg bg-gradient-to-r from-brand to-fuchsia-400">
          {channel.banner && <img src={channel.banner} alt="Channel banner" className="h-full w-full object-cover" />}
        </div>
        <Button size="sm" variant="outline" className="absolute right-2 top-2 bg-white/90" disabled={uploading !== null}
          onClick={() => bannerRef.current?.click()}>
          <ImageUp size={14} /> {uploading === "banner" ? "Uploading…" : "Change banner"}
        </Button>
        <button type="button" onClick={() => avatarRef.current?.click()} disabled={uploading !== null}
          className="absolute -bottom-9 left-4 rounded-full border-4 border-white bg-white" aria-label="Change picture" title="Change picture">
          <ChannelAvatar channel={channel} size={72} />
        </button>
        <span className="absolute -bottom-7 left-24 text-xs text-slate-500">{uploading === "avatar" ? "Uploading…" : "Click the picture to change it"}</span>
        {picker("avatar", avatarRef)}
        {picker("banner", bannerRef)}
      </div>
      <div className="space-y-4">
        <Field label="Channel name" required>
          <Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Handle" hint="Handles cannot be changed yet.">
          <Input value={`@${channel.handle}`} disabled />
        </Field>
        <Field label="About">
          <Textarea rows={4} value={about} maxLength={2000} onChange={(e) => setAbout(e.target.value)} />
        </Field>
        <Field label="Main language">
          <Select value={language} onChange={setLanguage} options={LANGUAGES} />
        </Field>
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-slate-500">
            {channel.followers} followers · {channel.video_count} videos · opened {when(channel.created_at)}
            {channel.strike_count > 0 && <span className="ml-1 font-semibold text-red-600">· {channel.strike_count} active strike{channel.strike_count === 1 ? "" : "s"}</span>}
          </p>
          <Button onClick={save} disabled={saving || !name.trim()}><Save size={14} /> {saving ? "Saving…" : "Save"}</Button>
        </div>
      </div>
    </Section>
  )
}

function Rule() {
  return (
    <div className="flex gap-3 rounded-lg border border-brand-100 bg-brand-50 p-4 text-sm text-slate-700">
      <ShieldCheck size={20} className="mt-0.5 shrink-0 text-brand" />
      <p>
        <span className="font-semibold text-navy">How linked videos work.</span> We never download videos from YouTube or Bilibili.
        They play in the original player, credited and linked to the source, and nothing is drawn over them. AI features
        (transcript, summary, chapters, search) run only on captions you own and upload in the video's Captions tab.
      </p>
    </div>
  )
}

function ConnectedAccounts() {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [busy, setBusy] = useState<string | null>(null)
  const { data: rows, isLoading } = useQuery({
    queryKey: ["studio-connected"],
    queryFn: async () => (await api.get<Connected[]>(`${STUDIO}/connected`)).data,
  })
  const active = (rows ?? []).filter((r) => r.status !== "revoked")

  async function connect(platform: "youtube" | "instagram") {
    setBusy(`connect-${platform}`)
    try {
      const { data } = await api.get<{ url: string }>(`${STUDIO}/connected/${platform}/start`)
      rememberConnecting(platform)
      window.location.assign(data.url)
    } catch (err) {
      toast.error(detail(err, platform === "instagram" ? "Could not reach Instagram" : "Could not reach YouTube"))
      setBusy(null)
    }
  }

  const igConnected = active.some((r) => r.platform === "instagram" && r.status === "active")

  async function sync(row: Connected) {
    setBusy(`sync-${row.id}`)
    try {
      await api.post(`${STUDIO}/connected/${row.id}/sync`)
      toast.success("Syncing. New videos appear in your list in a minute or two.")
      qc.invalidateQueries({ queryKey: ["studio-connected"] })
    } catch (err) {
      toast.error(detail(err, "Could not start the sync"))
    } finally {
      setBusy(null)
    }
  }

  async function disconnect(row: Connected) {
    const ok = await confirm({
      title: `Disconnect ${row.title || "this channel"}?`,
      message: "Linked videos stay on your channel but lose their verified-owner mark. You can connect again at any time.",
      confirmLabel: "Disconnect",
      variant: "destructive",
    })
    if (!ok) return
    setBusy(`off-${row.id}`)
    try {
      await api.delete(`${STUDIO}/connected/${row.id}`)
      toast.success("Disconnected")
      qc.invalidateQueries({ queryKey: ["studio-connected"] })
    } catch (err) {
      toast.error(detail(err, "Could not disconnect"))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Section
      title="Connected accounts"
      hint="Connect YouTube to link your videos here with their captions. Connect Instagram to publish clips as Reels."
      action={
        <div className="flex flex-wrap justify-end gap-2">
          <Button size="sm" onClick={() => connect("youtube")} disabled={busy !== null}>
            <Youtube size={14} /> {busy === "connect-youtube" ? "Opening…" : "Connect YouTube"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => connect("instagram")} disabled={busy !== null}>
            <Instagram size={14} /> {busy === "connect-instagram" ? "Opening…" : igConnected ? "Reconnect Instagram" : "Connect Instagram"}
          </Button>
        </div>
      }
    >
      {isLoading ? (
        <Spinner />
      ) : active.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing connected yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {active.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 py-3">
              {r.platform === "instagram" ? <Instagram size={20} className="text-pink-600" /> : <Youtube size={20} className="text-red-600" />}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-800">
                  {r.title || r.external_channel_id} {r.sandbox && <Badge color="amber">Sandbox</Badge>}
                  {r.status !== "active" && <Badge color="red" className="ml-1">{r.status.replace(/_/g, " ")}</Badge>}
                </p>
                <p className="text-xs text-slate-500">
                  {r.platform === "instagram"
                    ? "Instagram · clips can be published as Reels"
                    : `${r.videos} linked videos · ${r.last_synced_at ? `last synced ${when(r.last_synced_at, true)}` : "not synced yet"}`}
                </p>
              </div>
              {r.platform === "youtube" && (
                <Button size="sm" variant="outline" onClick={() => sync(r)} disabled={busy !== null}>
                  <RefreshCw size={13} /> {busy === `sync-${r.id}` ? "Starting…" : "Sync now"}
                </Button>
              )}
              <Button size="sm" variant="ghost" className="text-red-600" onClick={() => disconnect(r)} disabled={busy !== null}>
                <Unplug size={13} /> Disconnect
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

function AddByLink() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [url, setUrl] = useState("")
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [rights, setRights] = useState(false)
  const [busy, setBusy] = useState(false)
  const looksRight = /(youtube\.com|youtu\.be|bilibili\.com|b23\.tv)/i.test(url)

  async function add() {
    setBusy(true)
    try {
      const { data } = await api.post<StudioVideo>(`${STUDIO}/embeds`, {
        url: url.trim(),
        title: title.trim(),
        description,
        rights_declared: true,
      })
      qc.invalidateQueries({ queryKey: ["studio-videos"] })
      toast.success("Added. Upload its captions to turn on AI features.")
      navigate(`/videos/${data.id}?tab=captions`)
    } catch (err) {
      toast.error(detail(err, "That link could not be added"))
      setBusy(false)
    }
  }

  return (
    <Section title="Add a YouTube or Bilibili video by link" hint="It plays from the original site, inside your channel.">
      <div className="space-y-4">
        <Field label="Video link" required error={url && !looksRight ? "Paste a youtube.com, youtu.be or bilibili.com link" : undefined}>
          <div className="flex items-center gap-2">
            <Link2 size={16} className="shrink-0 text-slate-400" />
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=…" />
          </div>
        </Field>
        <Field label="Title" required>
          <Input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Description">
          <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#A21CAF]" checked={rights} onChange={(e) => setRights(e.target.checked)} />
          <span className="text-slate-700">This is my own video, and I own or have licensed everything in it, including music.</span>
        </label>
        <p className="text-xs text-slate-500">
          AI features need captions. After adding, upload them in the video's Captions tab.
        </p>
        <div className="flex justify-end">
          <Button onClick={add} disabled={busy || !looksRight || !title.trim() || !rights}>{busy ? "Adding…" : "Add video"}</Button>
        </div>
      </div>
    </Section>
  )
}
