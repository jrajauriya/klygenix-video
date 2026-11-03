import { useState } from "react"
import { Link } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { ExternalLink, Link2, Send } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { Button, Card, Field, StatusPill, Textarea } from "@klygenixvideo/ui"
import { STUDIO } from "../../lib/hooks"
import { detail, status } from "../../lib/format"
import type { Clip, Connected, PublishTarget } from "../../lib/types"

const PLATFORMS: { key: "youtube" | "instagram"; label: string; button: string; account: string }[] = [
  { key: "youtube", label: "YouTube Shorts", button: "Publish to YouTube Shorts", account: "YouTube" },
  { key: "instagram", label: "Instagram Reels", button: "Publish to Instagram Reels", account: "Instagram" },
]

const STATUS: Record<string, { label: string; hex: string }> = {
  queued: { label: "Queued", hex: "#1d4ed8" },
  publishing: { label: "Publishing", hex: "#6d28d9" },
  published: { label: "Published", hex: "#166534" },
  failed: { label: "Failed", hex: "#b91c1c" },
}

export function PublishTargets({ clip }: { clip: Clip }) {
  const qc = useQueryClient()
  const [caption, setCaption] = useState(clip.title)
  const [busy, setBusy] = useState<string | null>(null)
  const key = ["studio-clip-targets", clip.id]
  const { data } = useQuery({
    queryKey: key,
    queryFn: async () => (await api.get<PublishTarget[]>(`${STUDIO}/clips/${clip.id}/targets`)).data,
    refetchInterval: (q) => ((q.state.data ?? []).some((t) => t.status === "queued" || t.status === "publishing") ? 2500 : false),
  })
  const by = new Map((data ?? []).map((t) => [t.platform, t]))
  const [refused, setRefused] = useState<Record<string, string>>({})
  const { data: accounts } = useQuery({
    queryKey: ["studio-connected"],
    queryFn: async () => (await api.get<Connected[]>(`${STUDIO}/connected`)).data,
    retry: false,
  })
  const linked = (platform: string) =>
    accounts === undefined ? true : accounts.some((a) => a.platform === platform && a.status === "active")

  async function send(platform: "youtube" | "instagram", label: string) {
    setBusy(platform)
    try {
      await api.post(`${STUDIO}/clips/${clip.id}/targets`, { platform, caption: caption.trim() })
      toast.success(`Sending to ${label}`)
      setRefused((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== platform)))
      qc.invalidateQueries({ queryKey: key })
    } catch (err) {
      const text = detail(err, `Could not publish to ${label}`)
      if (status(err) === 409) {
        const fresh = await qc.fetchQuery({
          queryKey: ["studio-connected"],
          queryFn: async () => (await api.get<Connected[]>(`${STUDIO}/connected`)).data,
        }).catch(() => undefined)
        if (!fresh || !fresh.some((a) => a.platform === platform && a.status === "active")) {
          setRefused((r) => ({ ...r, [platform]: text }))
          return
        }
      }
      toast.error(text)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card className="space-y-3 p-4">
      <div>
        <h3 className="text-sm font-bold text-navy">Publish elsewhere</h3>
        <p className="text-xs text-slate-500">Post the rendered clip to your connected accounts. The caption goes with it.</p>
      </div>
      <Field label="Caption" hint="Up to 2,200 characters">
        <Textarea rows={2} value={caption} maxLength={2200} onChange={(e) => setCaption(e.target.value)} />
      </Field>
      <ul className="space-y-2">
        {PLATFORMS.map((p) => {
          const t = by.get(p.key)
          const s = t ? STATUS[t.status] ?? { label: t.status, hex: "#475569" } : null
          const active = t && ["queued", "publishing", "published"].includes(t.status)
          return (
            <li key={p.key} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 px-3 py-2">
              <span className="text-sm font-medium text-slate-800">{p.label}</span>
              {s && <StatusPill label={s.label} hex={s.hex} />}
              {t?.external_url && (
                <a href={t.external_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline">
                  Open <ExternalLink size={11} aria-hidden="true" />
                </a>
              )}
              <span className="ml-auto">
                {!active && (
                  <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => send(p.key, p.label)}>
                    <Send size={13} /> {busy === p.key ? "Sending…" : t?.status === "failed" ? "Try again" : p.button}
                  </Button>
                )}
              </span>
              {t?.error && <p className="w-full text-xs text-red-700">{t.error}</p>}
              {!active && (refused[p.key] || !linked(p.key)) && (
                <p className="w-full text-xs text-amber-800">
                  {refused[p.key] ?? `Connect your ${p.account} account first.`}{" "}
                  <Link to="/channel" className="inline-flex items-center gap-1 font-semibold text-brand hover:underline">
                    <Link2 size={11} aria-hidden="true" /> Connect {p.account}
                  </Link>
                </p>
              )}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
