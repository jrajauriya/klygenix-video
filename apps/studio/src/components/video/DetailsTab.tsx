import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { RefreshCw, Save, Sparkles, Trash2 } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { Button, Card, Field, Input, Select, Textarea, ToggleField, useConfirm } from "@klygenixvideo/ui"
import { STUDIO } from "../../lib/hooks"
import { LANGUAGES, clock, detail, fromLocalInput, splitTags, toLocalInput } from "../../lib/format"
import type { StudioVideoDetail, Visibility } from "../../lib/types"
import { VisibilityField } from "../VisibilityField"
import { PlayerBox } from "./PlayerBox"
import { ThumbnailCard } from "./ThumbnailCard"
import type { Seek } from "../VideoPreview"

export function DetailsTab({ video }: { video: StudioVideoDetail }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const [title, setTitle] = useState(video.title)
  const [description, setDescription] = useState(video.description)
  const [tags, setTags] = useState(video.tags.join(", "))
  const [language, setLanguage] = useState(video.language)
  const [visibility, setVisibility] = useState<Visibility>(video.visibility)
  const [publishAt, setPublishAt] = useState(toLocalInput(video.publish_at))
  const [aiGenerated, setAiGenerated] = useState(video.ai_generated)
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
      toast.error("Pick a date and time to publish")
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
      })
      toast.success("Saved")
      refresh()
    } catch (err) {
      toast.error(detail(err, "Could not save the changes"))
    } finally {
      setSaving(false)
    }
  }

  async function rerun() {
    setRerunning(true)
    try {
      await api.post(`${STUDIO}/videos/${video.id}/reprocess`)
      toast.success("AI is running again. New drafts appear here in a minute or two.")
      refresh()
    } catch (err) {
      toast.error(detail(err, "Could not start the AI again"))
    } finally {
      setRerunning(false)
    }
  }

  async function remove() {
    const ok = await confirm({
      title: "Delete this video?",
      message: "The video, its transcript, comments and danmaku are removed for everyone. Clips already published as reels stay.",
      confirmLabel: "Delete video",
      variant: "destructive",
    })
    if (!ok) return
    setDeleting(true)
    try {
      await api.delete(`${STUDIO}/videos/${video.id}`)
      toast.success("Video deleted")
      qc.invalidateQueries({ queryKey: ["studio-videos"] })
      navigate("/videos")
    } catch (err) {
      toast.error(detail(err, "Could not delete the video"))
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
            <h3 className="flex items-center gap-1.5 text-sm font-bold text-navy"><Sparkles size={15} className="text-brand" /> AI drafts</h3>
            <Button size="sm" variant="outline" onClick={rerun} disabled={rerunning || !["published", "in_review"].includes(video.status)}>
              <RefreshCw size={13} /> {rerunning ? "Starting…" : "Re-run AI"}
            </Button>
          </div>
          {!insight ? (
            <p className="text-sm text-slate-500">
              {video.ai_status === "no_captions"
                ? "AI needs captions for this video. Upload them in the Captions tab."
                : "Title ideas, hashtags, a summary and chapters appear here once the AI step is ready."}
            </p>
          ) : (
            <div className="space-y-4 text-sm">
              {insight.title_ideas?.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-semibold text-slate-500">Title ideas · click to use</p>
                  <div className="flex flex-wrap gap-1.5">
                    {insight.title_ideas.map((t) => (
                      <button key={t} type="button" onClick={() => setTitle(t.slice(0, 200))}
                        className="rounded-full border border-brand-100 bg-brand-50 px-2.5 py-1 text-left text-xs font-medium text-brand hover:border-brand">
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {insight.hashtags?.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-semibold text-slate-500">Hashtags · click to add as a tag</p>
                  <div className="flex flex-wrap gap-1.5">
                    {insight.hashtags.map((h) => (
                      <button key={h} type="button" onClick={() => addTag(h)}
                        className="rounded-full border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:border-brand hover:text-brand">
                        {h}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {insight.summary && (
                <div>
                  <p className="mb-1 text-xs font-semibold text-slate-500">Summary</p>
                  <p className="leading-relaxed text-slate-700">{insight.summary}</p>
                </div>
              )}
              {insight.chapters?.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-semibold text-slate-500">Chapters</p>
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

      <Card className="space-y-4 p-5 lg:col-span-3">
        <Field label="Title" required>
          <Input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Description">
          <Textarea rows={6} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tags" hint="Separate with commas, up to 12">
            <Input value={tags} onChange={(e) => setTags(e.target.value)} />
          </Field>
          <Field label="Language spoken">
            <Select value={language} onChange={setLanguage} options={LANGUAGES} />
          </Field>
        </div>
        <Field label="Visibility">
          <VisibilityField value={visibility} publishAt={publishAt} onChange={setVisibility} onPublishAt={setPublishAt} />
        </Field>
        <ToggleField
          label="AI-generated content"
          hint="Viewers see an AI-generated label on this video."
          checked={aiGenerated}
          onChange={setAiGenerated}
        />
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-4">
          <Button variant="outline" className="text-red-600" onClick={remove} disabled={deleting}>
            <Trash2 size={14} /> {deleting ? "Deleting…" : "Delete video"}
          </Button>
          <Button onClick={save} disabled={saving || !title.trim()}>
            <Save size={14} /> {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </Card>
    </div>
  )
}
