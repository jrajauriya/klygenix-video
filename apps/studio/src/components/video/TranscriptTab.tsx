import { useEffect, useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Save, Undo2 } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { Badge, Button, Card, EmptyState, Spinner, cn } from "@klygenixvideo/ui"
import { STUDIO } from "../../lib/hooks"
import { clock, detail } from "../../lib/format"
import type { StudioVideoDetail, TranscriptOut } from "../../lib/types"
import { PlayerBox } from "./PlayerBox"
import type { Seek } from "../VideoPreview"
import { useT } from "../../i18n"

export function TranscriptTab({ video }: { video: StudioVideoDetail }) {
  const t = useT()
  const qc = useQueryClient()
  const key = ["studio-transcript", video.id]
  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: async () => (await api.get<TranscriptOut>(`${STUDIO}/videos/${video.id}/transcript`)).data,
  })
  const [edits, setEdits] = useState<Record<number, string>>({})
  const [saving, setSaving] = useState(false)
  const [seek, setSeek] = useState<Seek | null>(null)
  const [now, setNow] = useState(0)

  useEffect(() => setEdits({}), [data])

  const changed = useMemo(
    () => (data?.segments ?? []).filter((s) => edits[s.idx] !== undefined && edits[s.idx].trim() !== s.text),
    [data, edits],
  )

  async function save() {
    if (changed.some((s) => !edits[s.idx].trim())) {
      toast.error(t("A line cannot be empty"))
      return
    }
    setSaving(true)
    try {
      const { data: next } = await api.put<TranscriptOut>(`${STUDIO}/videos/${video.id}/transcript`, {
        segments: changed.map((s) => ({ idx: s.idx, text: edits[s.idx].trim() })),
      })
      qc.setQueryData(key, next)
      qc.invalidateQueries({ queryKey: ["studio-video", String(video.id)] })
      toast.success(t("Transcript saved. Summary, chapters and search update shortly."))
    } catch (err) {
      toast.error(detail(err, t("Could not save the transcript")))
    } finally {
      setSaving(false)
    }
  }

  if (isLoading) return <Spinner />
  if (!data?.transcript) {
    return (
      <EmptyState
        title={t("No transcript yet")}
        hint={video.source === "embed"
          ? t("Linked videos get a transcript from captions you upload. Add them in the Captions tab.")
          : t("The transcript appears here once the video has been transcribed.")}
      />
    )
  }

  return (
    <div className="grid gap-5 lg:grid-cols-5 [&>*]:min-w-0">
      <div className="lg:col-span-2">
        <div className="lg:sticky lg:top-4">
          <PlayerBox playback={video.playback} poster={video.thumbnail} seek={seek} onTime={setNow} vertical={video.kind === "reel"} />
          <p className="mt-2 text-xs text-slate-500">{t("Click a time to jump the preview there.")}</p>
        </div>
      </div>
      <Card className="p-0 lg:col-span-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-semibold text-navy">{data.segments.length === 1 ? t("1 line") : t("{n} lines", { n: data.segments.length })}</span>
            <Badge color="slate">{data.transcript.language.toUpperCase()}</Badge>
            {data.transcript.edited && <Badge color="blue">{t("Edited")}</Badge>}
            {data.transcript.source === "creator" && <Badge color="purple">{t("From your captions")}</Badge>}
          </div>
          <div className="flex gap-2">
            {changed.length > 0 && (
              <Button size="sm" variant="ghost" onClick={() => setEdits({})}><Undo2 size={13} /> {t("Undo")}</Button>
            )}
            <Button size="sm" onClick={save} disabled={saving || changed.length === 0}>
              <Save size={13} /> {saving ? t("Saving…") : changed.length ? (changed.length === 1 ? t("Save 1 change") : t("Save {n} changes", { n: changed.length })) : t("Saved")}
            </Button>
          </div>
        </div>
        <ul className="max-h-[70vh] divide-y divide-slate-100 overflow-y-auto">
          {data.segments.map((s) => {
            const playing = now >= s.start_ms && now < s.end_ms
            const value = edits[s.idx] ?? s.text
            return (
              <li key={s.idx} className={cn("flex gap-3 px-4 py-2", playing && "bg-brand-50")}>
                <button
                  type="button"
                  onClick={() => setSeek({ ms: s.start_ms, n: Date.now() })}
                  className="w-24 shrink-0 pt-1.5 text-left font-num text-xs text-brand hover:underline"
                >
                  {clock(s.start_ms)} – {clock(s.end_ms)}
                </button>
                <textarea
                  value={value}
                  rows={Math.max(1, Math.ceil(value.length / 70))}
                  onChange={(e) => setEdits((m) => ({ ...m, [s.idx]: e.target.value }))}
                  aria-label={t("Line at {time}", { time: clock(s.start_ms) })}
                  className={cn(
                    "min-w-0 flex-1 resize-y rounded-md border bg-transparent px-2 py-1 text-sm leading-relaxed text-slate-800",
                    value.trim() !== s.text ? "border-amber-400" : "border-transparent hover:border-slate-200 focus:border-brand",
                  )}
                />
              </li>
            )
          })}
        </ul>
      </Card>
    </div>
  )
}
