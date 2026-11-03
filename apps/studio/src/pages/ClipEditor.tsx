import { useEffect, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Download, Film, Loader2, Minus, Plus, Save, Send, Trash2, Wand2 } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import {
  Button, Card, EmptyState, Field, Input, Modal, PageHeader, Spinner, Tabs, Textarea, useConfirm,
} from "@klygenixvideo/ui"
import { STUDIO, useMe } from "../lib/hooks"
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

const WORKING = ["queued", "rendering"]

const savedTrack = (c: Clip): Keyframe[] => (c.reframe && ["manual", "track"].includes(c.reframe.mode ?? "") ? c.reframe.track ?? [] : [])
const savedMusic = (c: Clip): ClipMusic | null =>
  c.music && "track_id" in c.music && c.music.track_id ? { track_id: c.music.track_id, volume: c.music.volume ?? 0.25, duck: c.music.duck ?? true } : null
const sameMusic = (a: ClipMusic | null, b: ClipMusic | null) =>
  a === b || (a !== null && b !== null && a.track_id === b.track_id && Math.abs(a.volume - b.volume) < 0.001 && a.duck === b.duck)

export default function ClipEditor() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { data: me } = useMe()

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
  if (isError || !clip) return <EmptyState title="This clip could not be found" />

  const duration = source?.duration_ms ?? clip.end_ms
  const sourceRatio = source?.width && source?.height ? source.width / source.height : 16 / 9
  const locked = WORKING.includes(clip.status) || clip.status === "published" || clip.status === "processing"
  const length = end - start
  const problem =
    end <= start ? "The end must come after the start."
      : length > CLIP_MAX_MS ? `Clips can be up to ${CLIP_MAX_MS / 1000} seconds.`
        : end > duration + 500 ? "The end is past the end of the video."
          : !title.trim() ? "Give the clip a title." : null
  const tracking = clip.reframe?.status === "tracking"
  const trackDirty = !sameTrack(keyframes, savedTrack(clip))
  const centerDirty = keyframes.length === 0 && Math.abs(centerX - (clip.reframe?.center_x ?? 0.5)) > 0.001
  const musicDirty = !sameMusic(music, savedMusic(clip))
  const dirty =
    title.trim() !== clip.title || start !== clip.start_ms || end !== clip.end_ms || aspect !== clip.aspect ||
    style !== clip.caption_style || trackDirty || centerDirty || musicDirty
  const frameX = keyframes.length ? cxAt(keyframes, playhead) : centerX
  const watermark = clip.watermark || Boolean(me?.plans.creator.limits?.watermark)

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
      toast.success("Clip saved")
    } catch (err) {
      toast.error(detail(err, "Could not save the clip"))
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
      toast.success("Rendering. This usually takes under a minute.")
    } catch (err) {
      if (httpStatus(err) === 402) {
        setQuotaHit(detail(err, "You have used this month's clip renders."))
      } else {
        toast.error(detail(err, "Could not start the render"))
      }
    } finally {
      setBusy(null)
    }
  }

  async function trackFaces() {
    if (keyframes.length) {
      const ok = await confirm({
        title: "Replace your keyframes?",
        message: "Face tracking finds the speaker and sets new keyframes. The ones you placed are replaced.",
        confirmLabel: "Track faces",
      })
      if (!ok) return
    }
    setBusy("track")
    try {
      await persist()
      const { data } = await api.post<Clip>(`${STUDIO}/clips/${clip!.id}/track`)
      refresh(data)
      toast.success("Looking for faces. This takes a few seconds.")
    } catch (err) {
      toast.error(detail(err, "Could not start face tracking"))
    } finally {
      setBusy(null)
    }
  }

  async function remove() {
    const ok = await confirm({
      title: "Delete this clip?",
      message: clip!.status === "published" ? "The reel already published from it stays on your channel." : "The clip and its rendered file are removed.",
      confirmLabel: "Delete clip",
      variant: "destructive",
    })
    if (!ok) return
    setBusy("delete")
    try {
      await api.delete(`${STUDIO}/clips/${clip!.id}`)
      qc.invalidateQueries({ queryKey: ["studio-clips"] })
      toast.success("Clip deleted")
      navigate("/clips")
    } catch (err) {
      toast.error(detail(err, "Could not delete the clip"))
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
              <Button variant="outline" size="sm" aria-label="Source video" onClick={() => navigate(`/videos/${source.id}?tab=clips`)}>
                <Film size={14} /> <span className="hidden sm:inline">Source video</span>
              </Button>
            )}
            <Button variant="ghost" size="sm" className="text-red-600" aria-label="Delete clip" onClick={remove} disabled={busy !== null || WORKING.includes(clip.status)}>
              <Trash2 size={14} /> <span className="hidden sm:inline">Delete</span>
            </Button>
          </div>
        }
      />
      <div className="-mt-1 mb-3 flex pl-10 flex-wrap items-center gap-2 text-sm text-slate-500">
        <ClipStatusPill status={clip.status} />
        {source && <span className="truncate">From “{source.title}”</span>}
      </div>

      {clip.status === "failed" && clip.error && (
        <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">The render failed: {clip.error}</p>
      )}
      {quotaHit && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span>{quotaHit}</span>
          <Link to="/billing" className="font-semibold underline">See plans</Link>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-5 [&>*]:min-w-0">
        <div className="space-y-3 lg:col-span-3">
          {rendered && (
            <Tabs
              tabs={[{ key: "rendered", label: "Rendered clip" }, { key: "source", label: "Edit on source" }]}
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
                  <Download size={15} /> Download MP4
                </a>
                {clip.status === "rendered" && (
                  <Button onClick={() => setPublishing(true)}><Send size={15} /> Publish as reel</Button>
                )}
                {clip.status === "published" && clip.output_video_id && (
                  <Button variant="outline" onClick={() => navigate(`/videos/${clip.output_video_id}`)}>Open the reel</Button>
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
                The preview loops the selected moment. The white frame shows what ends up in the clip; captions are a sample of the style.
              </p>
            </>
          )}

          <Card className="space-y-4 p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-navy">Moment</h3>
              <span className={length > CLIP_MAX_MS || length <= 0 ? "font-num text-sm font-semibold text-red-600" : "font-num text-sm text-slate-600"}>
                {seconds(Math.max(0, length))} s · {clock(start)} – {clock(end)}
              </span>
            </div>
            <RangeBar durationMs={duration} startMs={start} endMs={end} playheadMs={playhead} disabled={locked} onChange={setRange} />
            <div className="grid gap-4 sm:grid-cols-2">
              <EdgeInput label="Start (seconds)" value={start} disabled={locked}
                onChange={(ms) => setRange(ms, end)} onNow={() => setRange(playhead, end)} />
              <EdgeInput label="End (seconds)" value={end} disabled={locked}
                onChange={(ms) => setRange(start, ms)} onNow={() => setRange(start, playhead)} />
            </div>
          </Card>

          <Card className="space-y-3 p-4">
            <h3 className="text-sm font-bold text-navy">Framing</h3>
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
            <Field label="Title" required>
              <Input value={title} maxLength={160} disabled={locked} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field label="Shape">
              <AspectPicker value={aspect} onChange={setAspect} disabled={locked} />
            </Field>
            <Field label="Captions">
              <StylePicker value={style} onChange={setStyle} disabled={locked} />
            </Field>
          </Card>

          <Card className="space-y-3 p-4">
            <h3 className="text-sm font-bold text-navy">Music</h3>
            <Music value={music} onChange={setMusic} disabled={locked} />
          </Card>

          {watermark && (
            <p className="rounded-lg border border-brand-100 bg-brand-50 px-3 py-2 text-sm text-slate-700">
              On the free plan, rendered clips carry a small Klygenix Play watermark.{" "}
              <Link to="/billing" className="font-semibold text-brand underline">Upgrade to remove it</Link>
            </p>
          )}

          {problem && !locked && <p className="text-sm text-red-600">{problem}</p>}
          {WORKING.includes(clip.status) && (
            <p className="flex items-center gap-2 text-sm text-slate-600"><Loader2 size={15} className="animate-spin text-brand" /> Rendering your clip…</p>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={save} disabled={locked || !dirty || Boolean(problem) || busy !== null}>
              <Save size={14} /> {busy === "save" ? "Saving…" : "Save"}
            </Button>
            <Button onClick={render} disabled={locked || tracking || Boolean(problem) || busy !== null}>
              <Wand2 size={14} /> {busy === "render" ? "Starting…" : clip.status === "rendered" ? "Render again" : "Render clip"}
            </Button>
          </div>
        </div>
      </div>

      {rendered && (
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
        <Button size="icon" variant="outline" aria-label="Back half a second" disabled={disabled} onClick={() => onChange(Math.max(0, value - 500))}>
          <Minus size={14} />
        </Button>
        <Input type="number" step="0.1" min="0" value={text} disabled={disabled} className="text-center font-num" aria-label={label}
          onChange={(e) => setText(e.target.value)} onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit()
          }} />
        <Button size="icon" variant="outline" aria-label="Forward half a second" disabled={disabled} onClick={() => onChange(value + 500)}>
          <Plus size={14} />
        </Button>
        <Button size="sm" variant="ghost" disabled={disabled} onClick={onNow} title="Use the preview's current time">Now</Button>
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
      toast.success("Your reel is on its way. It shows on your channel once processed.")
    } catch (err) {
      toast.error(detail(err, "Could not publish the clip"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={made ? "Reel created" : "Publish as a reel"}
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>{made ? "Close" : "Cancel"}</Button>
          {made ? (
            <Button onClick={() => navigate(`/videos/${made.video_id}`)}>Open the new reel</Button>
          ) : (
            <Button onClick={publish} disabled={busy || !title.trim()}><Send size={14} /> {busy ? "Publishing…" : "Publish"}</Button>
          )}
        </div>
      }
    >
      {made ? (
        <p className="text-sm text-slate-600">The reel is being processed and appears on your channel shortly. You can edit its details from its page.</p>
      ) : (
        <div className="space-y-4">
          <Field label="Title" required>
            <Input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Description" hint="Leave empty to say which video it was clipped from.">
            <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <Field label="Visibility">
            <VisibilityField schedule={false} value={visibility} publishAt="" onChange={setVisibility} onPublishAt={() => undefined} />
          </Field>
        </div>
      )}
    </Modal>
  )
}
