import { useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Check, Film, ImageUp, Sparkles, Wand2 } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { Badge, Button, Card, cn } from "@klygenixvideo/ui"
import { MULTIPART, STUDIO } from "../../lib/hooks"
import { useHasPermission } from "../../lib/team"
import { clock, detail, status } from "../../lib/format"
import type { StudioVideoDetail, ThumbnailIdea } from "../../lib/types"
import { useT } from "../../i18n"

const BUSY = ["uploading", "processing", "scanning"]

export function ThumbnailCard({ video }: { video: StudioVideoDetail }) {
  const t = useT()
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const canEdit = useHasPermission("video.uploads", "full")
  const [busy, setBusy] = useState<string | null>(null)
  const [quotaNote, setQuotaNote] = useState<string | null>(null)
  const [usage, setUsage] = useState<{ used: number; limit: number | null } | null>(null)
  const ideas = video.thumbnail_ideas ?? []
  const custom = Boolean(video.thumbnail_custom)
  const picked = ideas.find((i) => i.chosen)

  async function run(tag: string, action: () => Promise<unknown>, ok: string, fallback: string) {
    setBusy(tag)
    try {
      await action()
      toast.success(ok)
      await qc.invalidateQueries({ queryKey: ["studio-video", String(video.id)] })
      qc.invalidateQueries({ queryKey: ["studio-videos"] })
    } catch (err) {
      toast.error(detail(err, fallback))
    } finally {
      setBusy(null)
    }
  }

  function upload(file: File) {
    const body = new FormData()
    body.append("file", file)
    run("upload", () => api.post(`${STUDIO}/videos/${video.id}/thumbnail`, body, MULTIPART), t("Thumbnail updated"), t("That image could not be used"))
  }

  const pick = (idea: ThumbnailIdea) =>
    run(idea.key, () => api.post(`${STUDIO}/videos/${video.id}/thumbnail/pick`, { key: idea.key }), t("Thumbnail updated"), t("Could not use that frame"))

  async function generate() {
    setBusy("ai")
    setQuotaNote(null)
    try {
      const { data } = await api.post<{ ideas: ThumbnailIdea[]; usage?: { used: number; limit: number | null } }>(
        `${STUDIO}/videos/${video.id}/thumbnails/ai`,
      )
      setUsage(data.usage ?? null)
      toast.success(data.ideas.length === 1 ? t("1 AI thumbnail is ready") : t("{n} AI thumbnails are ready", { n: data.ideas.length }))
      await qc.invalidateQueries({ queryKey: ["studio-video", String(video.id)] })
    } catch (err) {
      const text = detail(err, t("AI thumbnails could not be made"))
      if (status(err) === 402) setQuotaNote(text)
      else toast.error(text)
    } finally {
      setBusy(null)
    }
  }

  const reset = () =>
    run("reset", () => api.delete(`${STUDIO}/videos/${video.id}/thumbnail`), t("Back to the default frame"), t("Could not reset the thumbnail"))

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-navy">{t("Thumbnail")}</h3>
        <Badge color={video.thumbnail_ai ? "purple" : custom ? "brand" : "slate"}>
          {video.thumbnail_ai ? t("AI-made thumbnail") : picked ? t("Chosen frame") : custom ? t("Your upload") : t("Default frame")}
        </Badge>
      </div>
      <div className="flex gap-3">
        <div className="aspect-video w-36 shrink-0 overflow-hidden rounded-md bg-slate-200 sm:w-44">
          {video.thumbnail && <img src={video.thumbnail} alt={t("Current thumbnail")} className="h-full w-full object-cover" />}
        </div>
        {canEdit && <div className="flex min-w-0 flex-1 flex-col justify-center gap-2">
          <p className="text-xs text-slate-500">{t("JPG or PNG, 1280 × 720 works best.")}</p>
          <input ref={fileRef} type="file" accept="image/*" className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) upload(f)
              e.target.value = ""
            }} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => fileRef.current?.click()}>
              <ImageUp size={14} /> {busy === "upload" ? t("Uploading…") : t("Upload your own")}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy !== null || !custom} onClick={reset}>
              <Film size={14} /> {busy === "reset" ? t("Resetting…") : t("Use the default frame")}
            </Button>
          </div>
        </div>}
      </div>
      {canEdit && <div className="space-y-2 rounded-lg border border-slate-200 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-slate-600">{t("Let AI design thumbnails with your title on a strong frame. Each one uses your monthly AI image allowance.")}</p>
          <Button size="sm" variant="outline" disabled={busy !== null || video.status !== "published"} onClick={generate}>
            <Wand2 size={14} /> {busy === "ai" ? t("Designing…") : t("Generate AI thumbnails")}
          </Button>
        </div>
        {video.status !== "published" && <p className="text-xs text-slate-500">{t("Available once the video is published.")}</p>}
        {usage && usage.limit !== null && (
          <p className="text-xs text-slate-500">{t("AI images this month: {used} of {limit}", { used: usage.used, limit: usage.limit })}</p>
        )}
        {quotaNote && (
          <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
            {quotaNote}
          </p>
        )}
      </div>}
      <div>
        <p className="mb-1.5 flex items-center gap-1 text-xs font-semibold text-slate-500"><Sparkles size={13} className="text-brand" /> {canEdit ? t("AI ideas · click one to use it") : t("AI ideas")}</p>
        {ideas.length === 0 ? (
          <p className="text-sm text-slate-500">
            {BUSY.includes(video.status)
              ? t("Ideas appear here once processing finishes.")
              : t("No thumbnail ideas for this video. Videos processed from now on get up to four frames to choose from.")}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {ideas.map((idea) => (
              <button
                key={idea.key}
                type="button"
                title={idea.reason || undefined}
                aria-label={idea.ai
                  ? (idea.reason ? t("Use the AI thumbnail at {time}: {reason}", { time: clock(idea.at_ms), reason: idea.reason }) : t("Use the AI thumbnail at {time}", { time: clock(idea.at_ms) }))
                  : (idea.reason ? t("Use the frame at {time}: {reason}", { time: clock(idea.at_ms), reason: idea.reason }) : t("Use the frame at {time}", { time: clock(idea.at_ms) }))}
                aria-pressed={idea.chosen}
                disabled={!canEdit || busy !== null || idea.chosen}
                onClick={() => pick(idea)}
                className={cn(
                  "group relative aspect-video overflow-hidden rounded-md border-2 bg-slate-100 disabled:cursor-default",
                  idea.chosen ? "border-brand" : "border-transparent hover:border-brand-100",
                )}
              >
                <img src={idea.url} alt="" className="h-full w-full object-cover" loading="lazy" />
                <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1 font-num text-[10px] text-white">{clock(idea.at_ms)}</span>
                {idea.ai && <span className="absolute left-1 top-1 rounded bg-[#6d28d9] px-1 text-[10px] font-bold text-white">AI</span>}
                {idea.chosen && (
                  <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-brand text-white"><Check size={13} /></span>
                )}
                {busy === idea.key && <span className="absolute inset-0 flex items-center justify-center bg-white/70 text-xs font-semibold text-navy">{t("Saving…")}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </Card>
  )
}
