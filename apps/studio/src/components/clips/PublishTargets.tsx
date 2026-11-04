import { useState } from "react"
import { Link } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { CalendarClock, ExternalLink, Link2, Send, X } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { Button, Card, Field, Input, StatusPill, Textarea, ToggleField, useConfirm } from "@klygenixvideo/ui"
import { STUDIO } from "../../lib/hooks"
import { detail, fromLocalInput, status, when } from "../../lib/format"
import type { Clip, Connected, PublishTarget } from "../../lib/types"
import { useT } from "../../i18n"

const PLATFORMS: { key: "youtube" | "instagram"; label: string; button: string; account: string }[] = [
  { key: "youtube", label: "YouTube Shorts", button: "Publish to YouTube Shorts", account: "YouTube" },
  { key: "instagram", label: "Instagram Reels", button: "Publish to Instagram Reels", account: "Instagram" },
]

const STATUS: Record<string, { label: string; hex: string }> = {
  scheduled: { label: "Scheduled", hex: "#92400e" },
  cancelled: { label: "Cancelled", hex: "#475569" },
  queued: { label: "Queued", hex: "#1d4ed8" },
  publishing: { label: "Publishing", hex: "#6d28d9" },
  published: { label: "Published", hex: "#166534" },
  failed: { label: "Failed", hex: "#b91c1c" },
}

export function PublishTargets({ clip }: { clip: Clip }) {
  const t = useT()
  const qc = useQueryClient()
  const [caption, setCaption] = useState(clip.title)
  const [busy, setBusy] = useState<string | null>(null)
  const [later, setLater] = useState(false)
  const [at, setAt] = useState("")
  const confirm = useConfirm()
  const key = ["studio-clip-targets", clip.id]
  const { data } = useQuery({
    queryKey: key,
    queryFn: async () => (await api.get<PublishTarget[]>(`${STUDIO}/clips/${clip.id}/targets`)).data,
    refetchInterval: (q) => ((q.state.data ?? []).some((x) => x.status === "queued" || x.status === "publishing") ? 2500 : false),
  })
  const by = new Map((data ?? []).map((x) => [x.platform, x]))
  const [refused, setRefused] = useState<Record<string, string>>({})
  const { data: accounts } = useQuery({
    queryKey: ["studio-connected"],
    queryFn: async () => (await api.get<Connected[]>(`${STUDIO}/connected`)).data,
    retry: false,
  })
  const linked = (platform: string) =>
    accounts === undefined ? true : accounts.some((a) => a.platform === platform && a.status === "active")

  async function send(platform: "youtube" | "instagram", label: string) {
    const scheduled = later ? fromLocalInput(at) : null
    if (later && (!scheduled || new Date(scheduled).getTime() <= Date.now())) {
      toast.error(t("Pick a time in the future."))
      return
    }
    setBusy(platform)
    try {
      await api.post(`${STUDIO}/clips/${clip.id}/targets`, { platform, caption: caption.trim(), scheduled_at: scheduled })
      toast.success(scheduled ? t("Scheduled for {where} on {when}", { where: label, when: when(scheduled, true) }) : t("Sending to {where}", { where: label }))
      qc.invalidateQueries({ queryKey: ["studio-calendar"] })
      setRefused((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== platform)))
      qc.invalidateQueries({ queryKey: key })
    } catch (err) {
      const text = detail(err, t("Could not publish to {where}", { where: label }))
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

  async function unschedule(target: PublishTarget, label: string) {
    if (!target.id) return
    const ok = await confirm({
      title: t("Cancel this post?"),
      message: t("The clip will not be posted to {where}. You can send it again afterwards.", { where: label }),
      confirmLabel: t("Cancel post"),
      variant: "destructive",
    })
    if (!ok) return
    setBusy(target.platform)
    try {
      await api.patch(`${STUDIO}/calendar/targets/${target.id}`, { cancel: true })
      toast.success(t("Post cancelled"))
      qc.invalidateQueries({ queryKey: key })
      qc.invalidateQueries({ queryKey: ["studio-calendar"] })
    } catch (err) {
      toast.error(detail(err, t("Could not cancel the post")))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card className="space-y-3 p-4">
      <div>
        <h3 className="text-sm font-bold text-navy">{t("Publish elsewhere")}</h3>
        <p className="text-xs text-slate-500">{t("Post the rendered clip to your connected accounts. The caption goes with it.")}</p>
      </div>
      <Field label={t("Caption")} hint={t("Up to 2,200 characters")}>
        <Textarea rows={2} value={caption} maxLength={2200} onChange={(e) => setCaption(e.target.value)} />
      </Field>
      <ToggleField
        label={t("Post later")}
        hint={t("Pick a time and the clip posts itself. Scheduled posts show in the calendar.")}
        checked={later}
        onChange={setLater}
      />
      {later && (
        <Field label={t("Post at")} hint={t("Your device's time zone.")}>
          <Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} className="sm:w-64" />
        </Field>
      )}
      <ul className="space-y-2">
        {PLATFORMS.map((p) => {
          const target = by.get(p.key)
          const s = target ? STATUS[target.status] ?? { label: target.status, hex: "#475569" } : null
          const active = target && ["scheduled", "queued", "publishing", "published"].includes(target.status)
          return (
            <li key={p.key} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 px-3 py-2">
              <span className="text-sm font-medium text-slate-800">{p.label}</span>
              {s && <StatusPill label={t(s.label)} hex={s.hex} />}
              {target?.external_url && (
                <a href={target.external_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline">
                  {t("Open")} <ExternalLink size={11} aria-hidden="true" />
                </a>
              )}
              {target?.status === "scheduled" && target.scheduled_at && (
                <span className="text-xs text-slate-600">{when(target.scheduled_at, true)}</span>
              )}
              <span className="ml-auto">
                {target?.status === "scheduled" && (
                  <span className="inline-flex gap-1">
                    <Link to="/calendar" className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-brand hover:underline">
                      <CalendarClock size={13} aria-hidden="true" /> {t("Reschedule")}
                    </Link>
                    <Button size="sm" variant="ghost" className="text-red-700" disabled={busy !== null} onClick={() => unschedule(target, p.label)}>
                      <X size={13} /> {t("Cancel")}
                    </Button>
                  </span>
                )}
                {!active && (
                  <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => send(p.key, p.label)}>
                    <Send size={13} /> {busy === p.key ? t("Sending…") : target?.status === "failed" ? t("Try again") : later ? t("Schedule for {where}", { where: p.label }) : t(p.button)}
                  </Button>
                )}
              </span>
              {target?.error && <p className="w-full text-xs text-red-700">{target.error}</p>}
              {!active && (refused[p.key] || !linked(p.key)) && (
                <p className="w-full text-xs text-amber-800">
                  {refused[p.key] ?? t("Connect your {account} account first.", { account: p.account })}{" "}
                  <Link to="/channel" className="inline-flex items-center gap-1 font-semibold text-brand hover:underline">
                    <Link2 size={11} aria-hidden="true" /> {t("Connect {account}", { account: p.account })}
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
