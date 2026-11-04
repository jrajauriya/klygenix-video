import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Languages, Trash2 } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { Button, Card, Select, Spinner, StatusPill, ToggleField, useConfirm } from "@klygenixvideo/ui"
import { useHasPermission } from "@klygenixvideo/client"
import { STUDIO } from "../../lib/hooks"
import { detail, languageName } from "../../lib/format"
import type { Dub, StudioVideoDetail } from "../../lib/types"
import { useT } from "../../i18n"

const DUB_LANGS = ["en", "hi", "mr", "bn", "ta", "te"]

const STATUS: Record<string, { label: string; hex: string }> = {
  queued: { label: "Making it", hex: "#1d4ed8" },
  ready: { label: "Ready", hex: "#166534" },
  failed: { label: "Failed", hex: "#b91c1c" },
}

export function DubbingTab({ video }: { video: StudioVideoDetail }) {
  const t = useT()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const canEdit = useHasPermission("video.uploads", "full")
  const key = ["studio-video-dubs", video.id]
  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: async () => (await api.get<{ dubbing_allowed: boolean; dubs: Dub[] }>(`${STUDIO}/videos/${video.id}/dubs`)).data,
    refetchInterval: (q) => ((q.state.data?.dubs ?? []).some((d) => d.status === "queued") ? 3000 : false),
  })
  const [language, setLanguage] = useState("")
  const [busy, setBusy] = useState<string | null>(null)

  if (isLoading || !data) return <Spinner />

  const embed = video.source === "embed"
  const allowed = data.dubbing_allowed
  const aiReady = video.status === "published" && video.ai_status === "ready"
  const taken = new Set(data.dubs.map((d) => d.language))
  const options = DUB_LANGS.filter((l) => l !== video.language && !taken.has(l)).map((l) => ({ value: l, label: languageName(l) }))
  const refresh = () => {
    qc.invalidateQueries({ queryKey: key })
    qc.invalidateQueries({ queryKey: ["studio-video", String(video.id)] })
  }

  async function consent(next: boolean) {
    if (!next) {
      const ok = await confirm({
        title: t("Stop AI dubbing?"),
        message: t("Viewers stop hearing the dubbed voices straight away. The dubs you made are kept, so you can turn it back on later."),
        confirmLabel: t("Stop dubbing"),
        variant: "destructive",
      })
      if (!ok) return
    }
    setBusy("consent")
    try {
      await api.put(`${STUDIO}/videos/${video.id}/dubbing`, { allowed: next })
      toast.success(next ? t("AI dubbing allowed for this video") : t("AI dubbing stopped"))
      refresh()
    } catch (err) {
      toast.error(detail(err, t("Could not change dubbing")))
    } finally {
      setBusy(null)
    }
  }

  async function request(lang: string) {
    setBusy(`add-${lang}`)
    try {
      await api.post(`${STUDIO}/videos/${video.id}/dubs`, { language: lang })
      toast.success(t("Making a {language} dub. It takes a minute or two.", { language: languageName(lang) }))
      setLanguage("")
      refresh()
    } catch (err) {
      toast.error(detail(err, t("Could not start the dub")))
    } finally {
      setBusy(null)
    }
  }

  async function remove(d: Dub) {
    const ok = await confirm({ title: t("Delete the {name} dub?", { name: d.name }), message: t("Viewers can no longer pick this language."), confirmLabel: t("Delete"), variant: "destructive" })
    if (!ok) return
    setBusy(`del-${d.language}`)
    try {
      await api.delete(`${STUDIO}/videos/${video.id}/dubs/${d.language}`)
      toast.success(t("Dub deleted"))
      refresh()
    } catch (err) {
      toast.error(detail(err, t("Could not delete the dub")))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-5 [&>*]:min-w-0">
      <Card className="space-y-4 p-5 lg:col-span-3">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-bold text-navy"><Languages size={15} className="text-brand" aria-hidden="true" /> {t("AI dubbing")}</h2>
          <p className="mt-1 text-sm text-slate-600">
            {t("AI translates what is said and reads it in a synthetic voice, so viewers can listen in another language. Viewers always see the dub labelled “AI-dubbed” and can switch back to your own voice.")}
          </p>
        </div>
        {embed ? (
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-700">
            {t("This video plays from {platform}, so it cannot be dubbed here.", { platform: video.embed_platform === "bilibili" ? "Bilibili" : "YouTube" })}
          </p>
        ) : (
          <ToggleField
            label={t("Allow AI-dubbed versions of this video")}
            hint={t("Your consent. Turn it off at any time and viewers stop hearing the dubs.")}
            checked={allowed}
            onChange={consent}
            disabled={!canEdit || busy !== null}
          />
        )}
        {allowed && !embed && !aiReady && (
          <p className="text-sm text-amber-800">{t("Dubs can be made once the video is published and its AI transcript is ready.")}</p>
        )}
        {allowed && !embed && canEdit && aiReady && (
          options.length ? (
            <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
              <Select value={language} onChange={setLanguage} options={options} placeholder={t("Pick a language")} className="w-56" aria-label={t("Dub language")} />
              <Button onClick={() => request(language)} disabled={!language || busy !== null}>
                {busy?.startsWith("add-") ? t("Starting…") : t("Make dub")}
              </Button>
            </div>
          ) : (
            <p className="border-t border-slate-100 pt-4 text-sm text-slate-500">{t("Every available language has a dub.")}</p>
          )
        )}
      </Card>

      <Card className="p-0 lg:col-span-2">
        <h2 className="border-b border-slate-100 px-5 py-3 text-sm font-bold text-navy">{t("Dubs")}</h2>
        {data.dubs.length === 0 ? (
          <p className="px-5 py-6 text-sm text-slate-500">{t("No dubs yet.")}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.dubs.map((d) => {
              const s = STATUS[d.status] ?? { label: d.status, hex: "#475569" }
              return (
                <li key={d.language} className="px-5 py-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-800">{d.name}</span>
                    <StatusPill label={t(s.label)} hex={s.hex} />
                    <span className="ml-auto flex items-center gap-1">
                      {canEdit && d.status === "failed" && allowed && aiReady && (
                        <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => request(d.language)}>{t("Try again")}</Button>
                      )}
                      {canEdit && d.status !== "queued" && (
                        <Button size="icon" variant="ghost" aria-label={t("Delete the {name} dub", { name: d.name })} disabled={busy !== null} onClick={() => remove(d)}>
                          <Trash2 size={15} />
                        </Button>
                      )}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {d.label}{d.voice ? <> · {t("voice {name}", { name: d.voice })}</> : ""}{d.model ? ` · ${d.model}` : ""}
                  </p>
                  {d.error && <p className="mt-0.5 text-xs text-red-700">{d.error}</p>}
                </li>
              )
            })}
          </ul>
        )}
        {!allowed && data.dubs.length > 0 && <p className="border-t border-slate-100 px-5 py-2 text-xs text-slate-500">{t("Dubbing is off, so viewers do not hear these.")}</p>}
      </Card>
    </div>
  )
}
