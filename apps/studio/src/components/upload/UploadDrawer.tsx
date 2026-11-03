import { useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Upload } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import {
  Drawer, DrawerFooter, Field, FileDropzone, Input, ProgressBar, Select, Textarea, ToggleField, useConfirm,
} from "@klygenixvideo/ui"
import { STUDIO } from "../../lib/hooks"
import { LANGUAGES, detail, fromLocalInput, splitTags } from "../../lib/format"
import { sendFile, type Transfer } from "../../lib/upload"
import type { StudioVideo, UploadTicket, Visibility } from "../../lib/types"
import { VisibilityField } from "../VisibilityField"
import { AiStatusBadge } from "../StatusChips"
import { Pipeline } from "./Pipeline"

const FINAL = ["published", "in_review", "blocked", "failed"]
const RIGHTS = "I own or have licensed everything in this video, including music"

const titleFrom = (name: string) => name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim().slice(0, 200)

export function UploadDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const confirm = useConfirm()
  const qc = useQueryClient()
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [language, setLanguage] = useState("en")
  const [visibility, setVisibility] = useState<Visibility>("public")
  const [publishAt, setPublishAt] = useState("")
  const [tags, setTags] = useState("")
  const [aiGenerated, setAiGenerated] = useState(false)
  const [rights, setRights] = useState(false)
  const [videoId, setVideoId] = useState<number | null>(null)
  const [progress, setProgress] = useState(0)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const transfer = useRef<Transfer | null>(null)

  const { data: live } = useQuery({
    queryKey: ["studio-video-poll", videoId],
    queryFn: async () => (await api.get<StudioVideo>(`${STUDIO}/videos/${videoId}`)).data,
    enabled: videoId !== null && !sending,
    refetchInterval: (q) => {
      const v = q.state.data
      return v && FINAL.includes(v.status) && v.ai_status !== "running" && v.ai_status !== "pending" ? false : 2000
    },
  })

  useEffect(() => {
    if (live && FINAL.includes(live.status)) qc.invalidateQueries({ queryKey: ["studio-videos"] })
  }, [live?.status, qc])

  function reset() {
    setFile(null)
    setTitle("")
    setDescription("")
    setLanguage("en")
    setVisibility("public")
    setPublishAt("")
    setTags("")
    setAiGenerated(false)
    setRights(false)
    setVideoId(null)
    setProgress(0)
    setSending(false)
    setError(null)
    transfer.current = null
  }

  async function close() {
    if (sending) {
      const ok = await confirm({
        title: "Stop this upload?",
        message: "The file has not finished uploading. Stopping now discards what was sent.",
        confirmLabel: "Stop upload",
        cancelLabel: "Keep uploading",
        variant: "destructive",
      })
      if (!ok) return
      transfer.current?.abort()
    }
    reset()
    onClose()
  }

  async function start() {
    if (!file) return
    const at = visibility === "scheduled" ? fromLocalInput(publishAt) : null
    if (visibility === "scheduled" && !at) {
      toast.error("Pick a date and time to publish")
      return
    }
    setError(null)
    setSending(true)
    try {
      const { data } = await api.post<{ video: StudioVideo; upload: UploadTicket }>(`${STUDIO}/videos`, {
        title: title.trim(),
        description,
        language,
        visibility: visibility === "scheduled" ? "public" : visibility,
        publish_at: at,
        rights_declared: true,
        ai_generated: aiGenerated,
        tags: splitTags(tags),
        filename: file.name,
        size_bytes: file.size,
      })
      setVideoId(data.video.id)
      transfer.current = sendFile(file, data.upload, setProgress)
      await transfer.current.done
      await api.post(`${STUDIO}/videos/${data.video.id}/uploaded`)
      qc.invalidateQueries({ queryKey: ["studio-videos"] })
      setSending(false)
    } catch (err) {
      const msg = err instanceof Error && !("response" in (err as object)) ? err.message : detail(err, "The upload could not start")
      setError(msg)
      setSending(false)
      if (msg !== "Upload cancelled") toast.error(msg)
    }
  }

  const started = videoId !== null
  const finished = live && FINAL.includes(live.status)
  const canStart = Boolean(file && title.trim() && rights && !sending)

  return (
    <Drawer
      open={open}
      onClose={close}
      width="lg"
      title={started ? title || "Uploading" : "Upload a video"}
      subtitle={started ? "You can close this panel; processing carries on." : "Long videos and vertical reels up to 90 seconds."}
      footer={
        started ? (
          <DrawerFooter
            secondary={finished ? [{ label: "Upload another", onClick: reset }] : undefined}
            onCancel={close}
            cancelLabel={sending ? "Stop upload" : "Close"}
            save={{
              label: "Open video",
              disabled: sending,
              onClick: () => {
                const id = videoId
                reset()
                onClose()
                navigate(`/videos/${id}`)
              },
            }}
          />
        ) : (
          <DrawerFooter onCancel={close} save={{ label: "Upload", icon: <Upload size={15} />, disabled: !canStart, onClick: start }} />
        )
      }
    >
      {started ? (
        <div className="space-y-5">
          {sending && <ProgressBar value={Math.round(progress * 100)} max={100} showLabel />}
          <Pipeline status={live?.status ?? (sending ? null : "uploading")} uploading={sending} progress={progress} />
          {live?.status_note && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{live.status_note}</p>}
          {live && (
            <p className="flex items-center gap-2 text-sm text-slate-600">
              AI: <AiStatusBadge value={live.ai_status} />
            </p>
          )}
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          {finished && live?.status === "published" && (
            <p className="text-sm text-slate-600">Your video is live. The transcript, chapters and clip ideas appear on its page once the AI step is ready.</p>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <FileDropzone
            accept="video/*"
            maxSizeMB={4096}
            file={file}
            onFileSelect={(f) => {
              setFile(f)
              if (!title) setTitle(titleFrom(f.name))
            }}
            onRemove={() => setFile(null)}
            title="Drop a video file here, or click to choose"
            hint="MP4, MOV or WebM, up to 4 GB"
          />
          <Field label="Title" required>
            <Input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Description">
            <Textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Language spoken">
              <Select value={language} onChange={setLanguage} options={LANGUAGES} />
            </Field>
            <Field label="Tags" hint="Separate with commas, up to 12">
              <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="git, coding, tips" />
            </Field>
          </div>
          <Field label="Visibility">
            <VisibilityField value={visibility} publishAt={publishAt} onChange={setVisibility} onPublishAt={setPublishAt} />
          </Field>
          <ToggleField
            label="AI-generated content"
            hint="Turn on if realistic people, places or events in this video were made or changed with AI. Viewers see a label."
            checked={aiGenerated}
            onChange={setAiGenerated}
          />
          <label className="flex items-start gap-2 rounded-lg border border-slate-200 p-3 text-sm">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#A21CAF]" checked={rights} onChange={(e) => setRights(e.target.checked)} />
            <span>
              <span className="font-semibold text-slate-800">{RIGHTS}</span>
              <span className="mt-0.5 block text-xs text-slate-500">Required. Videos with music or clips you do not have rights to are taken down and can earn a strike.</span>
            </span>
          </label>
        </div>
      )}
    </Drawer>
  )
}
