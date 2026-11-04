import { useEffect, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Download, Film, Loader2, Minus, Plus, Save, Send, Trash2, Wand2 } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import {
  Button, Card, EmptyState, Field, Input, Modal, PageHeader, Spinner, Tabs, Textarea, useConfirm,
} from "@klygenixvideo/ui"
import { STUDIO } from "../lib/hooks"
import { useHasPermission, useStudioPlan } from "../lib/team"
import { ViewOnly } from "../components/team/ViewOnly"
import { clock, detail, seconds, status as httpStatus } from "../lib/format"
import { CLIP_MAX_MS, cxAt, sameTrack } from "../lib/clips"
import type { Aspect, CaptionStyle, Clip, ClipMusic, Keyframe, StudioVideoDetail } from "../lib/types"
import { VideoPreview, type Seek } from "../components/VideoPreview"
import { ClipStatusPill } from "../components/StatusChips"
import { RangeBar } from "../components/clips/RangeBar"
import { AspectPicker, FrameOverlay, StylePicker } from "../components/clips/ClipLook"
import { VisibilityField } from "../components/VisibilityField"
import { Reframe } from "../components/clips/Reframe"
import { Music } from "../components/clips/Music"
import { PublishTargets } from "../components/clips/PublishTargets"
import type { Visibility } from "../lib/types"
import { useT } from "../i18n"

const WORKING = ["queued", "rendering"]

const savedTrack = (c: Clip): Keyframe[] => (c.reframe && ["manual", "track"].includes(c.reframe.mode ?? "") ? c.reframe.track ?? [] : [])
const savedMusic = (c: Clip): ClipMusic | null =>
  c.music && "track_id" in c.music && c.music.track_id ? { track_id: c.music.track_id, volume: c.music.volume ?? 0.25, duck: c.music.duck ?? true } : null
const sameMusic = (a: ClipMusic | null, b: ClipMusic | null) =>
  a === b || (a !== null && b !== null && a.track_id === b.track_id && Math.abs(a.volume - b.volume) < 0.001 && a.duck === b.duck)

export default function ClipEditor() {
  const t = useT()
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { plan, theirs } = useStudioPlan()
  const canEdit = useHasPermission("video.clips", "full")

  const { data: clip, isLoading, isError } = useQuery({
    queryKey: ["studio-clip", id],
    queryFn: async () => (await api.get<Clip>(`${STUDIO}/clips/${id}`)).data,
    refetchInterval: (q) => (q.state.data && (WORKING.includes(q.state.data.status) || q.state.data.reframe?.status === "tracking") ? 2000 : false),
  })
  const { data: source } = useQuery({
    queryKey: ["studio-video", String(clip?.source_video_id)],
    queryFn: async () => (await api.get<StudioVideoDetail>(`${STUDIO}/videos/${clip!.source_video_id}`)).data,
    enabled: Boolean(clip),
  })

  const [title, setTitle] = useState("")
  const [start, setStart] = useState(0)
  const [end, setEnd] = useState(0)
  const [aspect, setAspect] = useState<Aspect>("9:16")
  const [style, setStyle] = useState<CaptionStyle>("bold")
  const [centerX, setCenterX] = useState(0.5)
  const [keyframes, setKeyframes] = useState<Keyframe[]>([])
  const [music, setMusic] = useState<ClipMusic | null>(null)
  const [playhead, setPlayhead] = useState(0)
  const [seek, setSeek] = useState<Seek | null>(null)
  const [view, setView] = useState("source")
  const [busy, setBusy] = useState<"save" | "render" | "delete" | "track" | null>(null)
  const [quotaHit, setQuotaHit] = useState<string | null>(null)
  const [publishing, setPublishing] = useState(false)

  useEffect(() => {
    if (!clip) return
    setTitle(clip.title)
    setStart(clip.start_ms)
    setEnd(clip.end_ms)
    setAspect(clip.aspect)
    setStyle(clip.caption_style)
    setCenterX(clip.reframe?.center_x ?? 0.5)
    setKeyframes(savedTrack(clip))
    setMusic(savedMusic(clip))
  }, [clip?.id, clip?.updated_at, clip?.reframe?.status])

  useEffect(() => {
    if (clip?.status === "rendered") setView("rendered")
  }, [clip?.status])

  if (isLoading) return <Spinner />
  if (isError || !clip) return <EmptyState title={t("This clip could not be found")} />

  const duration = source?.duration_ms ?? clip.end_ms
  const sourceRatio = source?.width && source?.height ? source.width / source.height : 16 / 9
  const locked = !canEdit || WORKING.includes(clip.status) || clip.status === "published" || clip.status === "processing"
  const length = end - start
  const problem =
    end <= start ? t("The end must come after the start.")
      : length > CLIP_MAX_MS ? t("Clips can be up to {n} seconds.", { n: CLIP_MAX_MS / 1000 })
        : end > duration + 500 ? t("The end is past the end of the video.")
          : !title.trim() ? t("Give the clip a title.") : null
  const tracking = clip.reframe?.status === "tracking"
  const trackDirty = !sameTrack(keyframes, savedTrack(clip))
  const centerDirty = keyframes.length === 0 && Math.abs(centerX - (clip.reframe?.center_x ?? 0.5)) > 0.001
  const musicDirty = !sameMusic(music, savedMusic(clip))
  const dirty =
    title.trim() !== clip.title || start !== clip.start_ms || end !== clip.end_ms || aspect !== clip.aspect ||
    style !== clip.caption_style || trackDirty || centerDirty || musicDirty
  const frameX = keyframes.length ? cxAt(keyframes, playhead) : centerX
  const watermark = clip.watermark || Boolean(plan?.limits?.watermark)

  const setRange = (s: number, e: number) => {
    const ns = Math.max(0, Math.round(s))
    const ne = Math.min(Math.round(e), duration)
    if (ns !== start) setSeek({ ms: ns, n: Date.now() })
    else if (ne !== end) setSeek({ ms: Math.max(ns, ne - 1500), n: Date.now() })
    setStart(ns)
    setEnd(ne)
  }

  const refresh = (next?: Clip) => {
    if (next) qc.setQueryData(["studio-clip", id], next)
    qc.invalidateQueries({ queryKey: ["studio-clips"] })
  }

  async function persist(): Promise<boolean> {
    if (!dirty) return true
    const body: Record<string, unknown> = { title: title.trim(), start_ms: start, end_ms: end, aspect, caption_style: style }
    if (keyframes.length && trackDirty) body.keyframes = keyframes.map((k) => ({ t_ms: k.t_ms, cx: Math.round(k.cx * 1000) / 1000 }))
    if (!keyframes.length && (trackDirty || centerDirty)) body.center_x = Math.round(centerX * 1000) / 1000
    if (musicDirty) body.music = music ?? { track_id: null }
    const { data } = await api.patch<Clip>(`${STUDIO}/clips/${clip!.id}`, body)
    refresh(data)
    return true
  }

  async function save() {
    setBusy("save")
    try {
      await persist()
      toast.success(t("Clip saved"))
    } catch (err) {
      toast.error(detail(err, t("Could not save the clip")))
    } finally {
      setBusy(null)
    }
  }

  async function render() {
    setBusy("render")
    setQuotaHit(null)
    try {
      await persist()
      const { data } = await api.post<Clip>(`${STUDIO}/clips/${clip!.id}/render`)
      refresh(data)
      qc.invalidateQueries({ queryKey: ["video-me"] })
      toast.success(t("Rendering. This usually takes under a minute."))
    } catch (err) {
      if (httpStatus(err) === 402) {
        setQuotaHit(detail(err, t("You have used this month's clip renders.")))
      } else {
        toast.error(detail(err, t("Could not start the render")))
      }
    } finally {
      setBusy(null)
    }
  }

  async function trackFaces() {
    if (keyframes.length) {
      const ok = await confirm({
        title: t("Replace your keyframes?"),
        message: t("Face tracking finds the speaker and sets new keyframes. The ones you placed are replaced."),
        confirmLabel: t("Track faces"),
      })
      if (!ok) return
    }
    setBusy("track")
    try {
      await persist()
      const { data } = await api.post<Clip>(`${STUDIO}/clips/${clip!.id}/track`)
      refresh(data)
      toast.success(t("Looking for faces. This takes a few seconds."))
    } catch (err) {
      toast.error(detail(err, t("Could not start face tracking")))
    } finally {
      setBusy(null)
    }
  }

  async function remove() {
    const ok = await confirm({
      title: t("Delete this clip?"),
      message: clip!.status === "published" ? t("The reel already published from it stays on your channel.") : t("The clip and its rendered file are removed."),
      confirmLabel: t("Delete clip"),
      variant: "destructive",
    })
    if (!ok) return
    setBusy("delete")
    try {
      await api.delete(`${STUDIO}/clips/${clip!.id}`)
      qc.invalidateQueries({ queryKey: ["studio-clips"] })
      toast.success(t("Clip deleted"))
      navigate("/clips")
    } catch (err) {
      toast.error(detail(err, t("Could not delete the clip")))
      setBusy(null)
    }
  }

  const rendered = clip.download_url && ["rendered", "published"].includes(clip.status)
  const renderedRatio = clip.aspect === "9:16" ? "9 / 16" : clip.aspect === "1:1" ? "1 / 1" : "16 / 9"

  return (
    <div className="pb-8">
      <PageHeader
        title={clip.title}
        onBack={() => navigate("/clips")}
        actions={
          <div className="flex flex-wrap gap-2">
            {source && (
              <Button variant="outline" size="sm" aria-label={t("Source video")} onClick={() => navigate(`/videos/${source.id}?tab=clips`)}>
                <Film size={14} /> <span className="hidden sm:inline">{t("Source video")}</span>
              </Button>
            )}
            {canEdit && (
              <Button variant="ghost" size="sm" className="text-red-600" aria-label={t("Delete clip")} onClick={remove} disabled={busy !== null || WORKING.includes(clip.status)}>
                <Trash2 size={14} /> <span className="hidden sm:inline">{t("Delete")}</span>
              </Button>
            )}
          </div>
        }
      />
      <div className="-mt-1 mb-3 flex pl-10 flex-wrap items-center gap-2 text-sm text-slate-500">
        <ClipStatusPill status={clip.status} />
        {source && <span className="truncate">{t("From “{title}”", { title: source.title })}</span>}
      </div>

      {!canEdit && <ViewOnly className="mb-3" what={t("Your role can watch and download this clip but not edit, render or publish it.")} />}
      {clip.status === "failed" && clip.error && (
        <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{t("The render failed: {error}", { error: clip.error })}</p>
      )}
      {quotaHit && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span>{quotaHit}</span>
          {!theirs && <Link to="/billing" className="font-semibold underline">{t("See plans")}</Link>}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-5 [&>*]:min-w-0">
        <div className="space-y-3 lg:col-span-3">
          {rendered && (
            <Tabs
              tabs={[{ key: "rendered", label: t("Rendered clip") }, { key: "source", label: t("Edit on source") }]}
              active={view}
              onChange={setView}
            />
          )}
          {rendered && view === "rendered" ? (
            <div className="space-y-3">
              <VideoPreview
                key={clip.download_url}
                src={clip.download_url}
                aspect={renderedRatio}
                className={clip.aspect === "16:9" ? undefined : "mx-auto w-full max-w-[280px]"}
              />
              <div className="flex flex-wrap justify-center gap-2">
                <a href={clip.download_url!} download={`clip-${clip.id}.mp4`}
                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                  <Download size={15} /> {t("Download MP4")}
                </a>
                {canEdit && clip.status === "rendered" && (
                  <Button onClick={() => setPublishing(true)}><Send size={15} /> {t("Publish as reel")}</Button>
                )}
                {clip.status === "published" && clip.output_video_id && (
                  <Button variant="outline" onClick={() => navigate(`/videos/${clip.output_video_id}`)}>{t("Open the reel")}</Button>
                )}
              </div>
            </div>
          ) : (
            <>
              <VideoPreview
                src={source?.playback?.type === "hls" ? source.playback.url : null}
                poster={source?.thumbnail}
                startMs={start}
                endMs={end}
                seek={seek}
                onTime={setPlayhead}
                aspect={`${sourceRatio}`}
              >
                <FrameOverlay aspect={aspect} sourceRatio={sourceRatio} centerX={frameX} style={style} />
              </VideoPreview>
              <p className="text-xs text-slate-500">
                {t("The preview loops the selected moment. The white frame shows what ends up in the clip; captions are a sample of the style.")}
              </p>
            </>
          )}

          <Card className="space-y-4 p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-navy">{t("Moment")}</h3>
              <span className={length > CLIP_MAX_MS || length <= 0 ? "font-num text-sm font-semibold text-red-600" : "font-num text-sm text-slate-600"}>
                {t("{n} s", { n: seconds(Math.max(0, length)) })} · {clock(start)} – {clock(end)}
              </span>
            </div>
            <RangeBar durationMs={duration} startMs={start} endMs={end} playheadMs={playhead} disabled={locked} onChange={setRange} />
            <div className="grid gap-4 sm:grid-cols-2">
              <EdgeInput label={t("Start (seconds)")} value={start} disabled={locked}
                onChange={(ms) => setRange(ms, end)} onNow={() => setRange(playhead, end)} />
              <EdgeInput label={t("End (seconds)")} value={end} disabled={locked}
                onChange={(ms) => setRange(start, ms)} onNow={() => setRange(start, playhead)} />
            </div>
          </Card>

          <Card className="space-y-3 p-4">
            <h3 className="text-sm font-bold text-navy">{t("Framing")}</h3>
            <Reframe
              info={clip.reframe}
              keyframes={keyframes}
              onKeyframes={setKeyframes}
              startMs={start}
              endMs={end}
              playheadMs={playhead}
              centerX={centerX}
              onCenterX={setCenterX}
              disabled={locked || busy !== null}
              wide={aspect === "16:9"}
              tracking={tracking || busy === "track"}
              onTrack={trackFaces}
              onSeek={(ms) => setSeek({ ms: Math.round(ms), n: Date.now() })}
            />
          </Card>
        </div>

        <div className="space-y-4 lg:col-span-2">
          <Card className="space-y-4 p-4">
            <Field label={t("Title")} required>
              <Input value={title} maxLength={160} disabled={locked} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field label={t("Shape")}>
              <AspectPicker value={aspect} onChange={setAspect} disabled={locked} />
            </Field>
            <Field label={t("Captions")}>
              <StylePicker value={style} onChange={setStyle} disabled={locked} />
            </Field>
          </Card>

          <Card className="space-y-3 p-4">
            <h3 className="text-sm font-bold text-navy">{t("Music")}</h3>
            <Music value={music} onChange={setMusic} disabled={locked} />
          </Card>

          {watermark && (
            <p className="rounded-lg border border-brand-100 bg-brand-50 px-3 py-2 text-sm text-slate-700">
              {t("On the free plan, rendered clips carry a small Klygenix Play watermark.")}{" "}
              {!theirs && <Link to="/billing" className="font-semibold text-brand underline">{t("Upgrade to remove it")}</Link>}
            </p>
          )}

          {problem && !locked && <p className="text-sm text-red-600">{problem}</p>}
          {WORKING.includes(clip.status) && (
            <p className="flex items-center gap-2 text-sm text-slate-600"><Loader2 size={15} className="animate-spin text-brand" /> {t("Rendering your clip…")}</p>
          )}

          {canEdit && <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={save} disabled={locked || !dirty || Boolean(problem) || busy !== null}>
              <Save size={14} /> {busy === "save" ? t("Saving…") : t("Save")}
            </Button>
            <Button onClick={render} disabled={locked || tracking || Boolean(problem) || busy !== null}>
              <Wand2 size={14} /> {busy === "render" ? t("Starting…") : clip.status === "rendered" ? t("Render again") : t("Render clip")}
            </Button>
          </div>}
        </div>
      </div>

      {rendered && canEdit && (
        <div className="mt-5 lg:w-3/5">
          <PublishTargets clip={clip} />
        </div>
      )}

      {publishing && (
        <PublishModal clip={clip} defaultTitle={title} onClose={() => setPublishing(false)} onDone={(c) => refresh(c)} />
      )}
    </div>
  )
}

function EdgeInput({
  label, value, disabled, onChange, onNow,
}: {
  label: string
  value: number
  disabled?: boolean
  onChange: (ms: number) => void
  onNow: () => void
}) {
  const t = useT()
  const [text, setText] = useState(seconds(value))
  useEffect(() => setText(seconds(value)), [value])
  const commit = () => {
    const n = Number(text)
    if (Number.isFinite(n) && n >= 0) onChange(Math.round(n * 1000))
    else setText(seconds(value))
  }
  return (
    <Field label={label}>
      <div className="flex items-center gap-1">
        <Button size="icon" variant="outline" aria-label={t("Back half a second")} disabled={disabled} onClick={() => onChange(Math.max(0, value - 500))}>
          <Minus size={14} />
        </Button>
        <Input type="number" step="0.1" min="0" value={text} disabled={disabled} className="text-center font-num" aria-label={label}
          onChange={(e) => setText(e.target.value)} onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit()
          }} />
        <Button size="icon" variant="outline" aria-label={t("Forward half a second")} disabled={disabled} onClick={() => onChange(value + 500)}>
          <Plus size={14} />
        </Button>
        <Button size="sm" variant="ghost" disabled={disabled} onClick={onNow} title={t("Use the preview's current time")}>{t("Now")}</Button>
      </div>
    </Field>
  )
}

function PublishModal({ clip, defaultTitle, onClose, onDone }: {
  clip: Clip
  defaultTitle: string
  onClose: () => void
  onDone: (c: Clip) => void
}) {
  const t = useT()
  const navigate = useNavigate()
  const [title, setTitle] = useState(defaultTitle)
  const [description, setDescription] = useState("")
  const [visibility, setVisibility] = useState<Visibility>("public")
  const [busy, setBusy] = useState(false)
  const [made, setMade] = useState<{ video_id: number; public_id: string } | null>(null)

  async function publish() {
    setBusy(true)
    try {
      const { data } = await api.post<{ clip: Clip; video_id: number; public_id: string }>(`${STUDIO}/clips/${clip.id}/publish`, {
        title: title.trim() || null,
        description,
        visibility,
      })
      onDone(data.clip)
      setMade({ video_id: data.video_id, public_id: data.public_id })
      toast.success(t("Your reel is on its way. It shows on your channel once processed."))
    } catch (err) {
      toast.error(detail(err, t("Could not publish the clip")))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={made ? t("Reel created") : t("Publish as a reel")}
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>{made ? t("Close") : t("Cancel")}</Button>
          {made ? (
            <Button onClick={() => navigate(`/videos/${made.video_id}`)}>{t("Open the new reel")}</Button>
          ) : (
            <Button onClick={publish} disabled={busy || !title.trim()}><Send size={14} /> {busy ? t("Publishing…") : t("Publish")}</Button>
          )}
        </div>
      }
    >
      {made ? (
        <p className="text-sm text-slate-600">{t("The reel is being processed and appears on your channel shortly. You can edit its details from its page.")}</p>
      ) : (
        <div className="space-y-4">
          <Field label={t("Title")} required>
            <Input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label={t("Description")} hint={t("Leave empty to say which video it was clipped from.")}>
            <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <Field label={t("Visibility")}>
            <VisibilityField schedule={false} value={visibility} publishAt="" onChange={setVisibility} onPublishAt={() => undefined} />
          </Field>
        </div>
      )}
    </Modal>
  )
}
