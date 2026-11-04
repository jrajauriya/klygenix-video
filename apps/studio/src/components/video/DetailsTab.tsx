import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { RefreshCw, Save, Sparkles, Trash2 } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { Button, Card, Field, Input, Select, Textarea, ToggleField, useConfirm } from "@klygenixvideo/ui"
import { STUDIO } from "../../lib/hooks"
import { useHasPermission } from "../../lib/team"
import { ViewOnly } from "../team/ViewOnly"
import { LANGUAGES, clock, detail, fromLocalInput, splitTags, toLocalInput } from "../../lib/format"
import type { StudioVideoDetail, Visibility } from "../../lib/types"
import { VisibilityField } from "../VisibilityField"
import { categoryLabel } from "../../lib/market"
import { PlayerBox } from "./PlayerBox"
import { ThumbnailCard } from "./ThumbnailCard"
import type { Seek } from "../VideoPreview"
import { useT } from "../../i18n"

export function DetailsTab({ video }: { video: StudioVideoDetail }) {
  const t = useT()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const canEdit = useHasPermission("video.uploads", "full")
  const [title, setTitle] = useState(video.title)
  const [description, setDescription] = useState(video.description)
  const [tags, setTags] = useState(video.tags.join(", "))
  const [language, setLanguage] = useState(video.language)
  const [visibility, setVisibility] = useState<Visibility>(video.visibility)
  const [publishAt, setPublishAt] = useState(toLocalInput(video.publish_at))
  const [aiGenerated, setAiGenerated] = useState(video.ai_generated)
  const [madeForKids, setMadeForKids] = useState(Boolean(video.made_for_kids))
  const [saving, setSaving] = useState(false)
  const [rerunning, setRerunning] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [seek, setSeek] = useState<Seek | null>(null)
  const insight = video.insight

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["studio-video", String(video.id)] })
    qc.invalidateQueries({ queryKey: ["studio-videos"] })
  }

  async function save() {
    const at = visibility === "scheduled" ? fromLocalInput(publishAt) : null
    if (visibility === "scheduled" && !at) {
      toast.error(t("Pick a date and time to publish"))
      return
    }
    setSaving(true)
    try {
      await api.patch(`${STUDIO}/videos/${video.id}`, {
        title: title.trim(),
        description,
        tags: splitTags(tags),
        language,
        visibility,
        publish_at: at,
        ai_generated: aiGenerated,
        made_for_kids: madeForKids,
      })
      toast.success(t("Saved"))
      refresh()
    } catch (err) {
      toast.error(detail(err, t("Could not save the changes")))
    } finally {
      setSaving(false)
    }
  }

  async function rerun() {
    setRerunning(true)
    try {
      await api.post(`${STUDIO}/videos/${video.id}/reprocess`)
      toast.success(t("AI is running again. New drafts appear here in a minute or two."))
      refresh()
    } catch (err) {
      toast.error(detail(err, t("Could not start the AI again")))
    } finally {
      setRerunning(false)
    }
  }

  async function remove() {
    const ok = await confirm({
      title: t("Delete this video?"),
      message: t("The video, its transcript, comments and danmaku are removed for everyone. Clips already published as reels stay."),
      confirmLabel: t("Delete video"),
      variant: "destructive",
    })
    if (!ok) return
    setDeleting(true)
    try {
      await api.delete(`${STUDIO}/videos/${video.id}`)
      toast.success(t("Video deleted"))
      qc.invalidateQueries({ queryKey: ["studio-videos"] })
      navigate("/videos")
    } catch (err) {
      toast.error(detail(err, t("Could not delete the video")))
      setDeleting(false)
    }
  }

  const addTag = (tag: string) => {
    const list = splitTags(tags)
    const clean = tag.replace(/^#/, "")
    if (!list.includes(clean)) setTags([...list, clean].join(", "))
  }

  return (
    <div className="grid gap-5 lg:grid-cols-5 [&>*]:min-w-0">
      <div className="space-y-4 lg:col-span-2">
        <PlayerBox playback={video.playback} poster={video.thumbnail} seek={seek} vertical={video.kind === "reel"} />
        {video.source !== "embed" && <ThumbnailCard video={video} />}

        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-1.5 text-sm font-bold text-navy"><Sparkles size={15} className="text-brand" /> {t("AI drafts")}</h3>
            {canEdit && (
              <Button size="sm" variant="outline" onClick={rerun} disabled={rerunning || !["published", "in_review"].includes(video.status)}>
                <RefreshCw size={13} /> {rerunning ? t("Starting…") : t("Re-run AI")}
              </Button>
            )}
          </div>
          {!insight ? (
            <p className="text-sm text-slate-500">
              {video.ai_status === "no_captions"
                ? t("AI needs captions for this video. Upload them in the Captions tab.")
                : t("Title ideas, hashtags, a summary and chapters appear here once the AI step is ready.")}
            </p>
          ) : (
            <div className="space-y-4 text-sm">
              {insight.title_ideas?.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-semibold text-slate-500">{canEdit ? t("Title ideas · click to use") : t("Title ideas")}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {insight.title_ideas.map((idea) => (
                      <button key={idea} type="button" disabled={!canEdit} onClick={() => setTitle(idea.slice(0, 200))}
                        className="rounded-full border border-brand-100 bg-brand-50 px-2.5 py-1 text-left text-xs font-medium text-brand hover:border-brand">
                        {idea}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {insight.hashtags?.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-semibold text-slate-500">{canEdit ? t("Hashtags · click to add as a tag") : t("Hashtags")}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {insight.hashtags.map((h) => (
                      <button key={h} type="button" disabled={!canEdit} onClick={() => addTag(h)}
                        className="rounded-full border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:border-brand hover:text-brand">
                        {h}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {insight.summary && (
                <div>
                  <p className="mb-1 text-xs font-semibold text-slate-500">{t("Summary")}</p>
                  <p className="leading-relaxed text-slate-700">{insight.summary}</p>
                </div>
              )}
              {insight.chapters?.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-semibold text-slate-500">{t("Chapters")}</p>
                  <ul className="space-y-1">
                    {insight.chapters.map((c) => (
                      <li key={c.start_ms}>
                        <button type="button" onClick={() => setSeek({ ms: c.start_ms, n: Date.now() })}
                          className="flex gap-2 text-left hover:text-brand">
                          <span className="font-num text-xs text-brand">{clock(c.start_ms)}</span>
                          <span className="text-slate-700">{c.title}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      <Card className="p-5 lg:col-span-3">
        {!canEdit && <ViewOnly className="mb-4" />}
        <fieldset disabled={!canEdit} className="m-0 min-w-0 space-y-4 border-0 p-0">
        <Field label={t("Title")} required>
          <Input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label={t("Description")}>
          <Textarea rows={6} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("Tags")} hint={t("Separate with commas, up to 12")}>
            <Input value={tags} onChange={(e) => setTags(e.target.value)} />
          </Field>
          <Field label={t("Language spoken")}>
            <Select value={language} onChange={setLanguage} options={LANGUAGES} />
          </Field>
        </div>
        <Field label={t("Visibility")}>
          <VisibilityField value={visibility} publishAt={publishAt} onChange={setVisibility} onPublishAt={setPublishAt} />
        </Field>
        <ToggleField
          label={t("AI-generated content")}
          hint={t("Viewers see an AI-generated label on this video.")}
          checked={aiGenerated}
          onChange={setAiGenerated}
        />
        <div>
          <ToggleField
            label={t("Made for kids")}
            hint={t("Turn this on if the video is made for children. Kids videos never show ads, whatever your channel's ad setting.")}
            checked={madeForKids}
            onChange={setMadeForKids}
          />
          {(video.safety_labels?.length ?? 0) > 0 && (
            <p className="mt-1 text-xs text-slate-500">
              {t("Topics found by the safety check: {topics}. Brands can choose not to show their ads on some topics.", { topics: video.safety_labels!.map(categoryLabel).join(", ") })}
            </p>
          )}
        </div>
        </fieldset>
        {canEdit && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-4">
            <Button variant="outline" className="text-red-600" onClick={remove} disabled={deleting}>
              <Trash2 size={14} /> {deleting ? t("Deleting…") : t("Delete video")}
            </Button>
            <Button onClick={save} disabled={saving || !title.trim()}>
              <Save size={14} /> {saving ? t("Saving…") : t("Save changes")}
            </Button>
          </div>
        )}
      </Card>
    </div>
  )
}
