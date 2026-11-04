import { useEffect, useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { ArrowDown, ArrowUp, Eye, History, ListOrdered, Plus, RotateCcw, Save, Trash2 } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { Badge, Button, Card, EmptyState, Input, Modal, Spinner, useConfirm } from "@klygenixvideo/ui"
import { useHasPermission } from "../../lib/team"
import { ViewOnly } from "../team/ViewOnly"
import { STUDIO } from "../../lib/hooks"
import { clock, detail, parseClock, when } from "../../lib/format"
import type { ChapterRow, ChaptersOut, StudioVideoDetail } from "../../lib/types"
import { useT } from "../../i18n"

interface Row {
  key: number
  time: string
  title: string
}

const MIN_GAP_MS = 5000

let seq = 0
const toRows = (list: ChapterRow[]): Row[] => list.map((c) => ({ key: ++seq, time: clock(c.start_ms), title: c.title }))

export function ChaptersTab({ video }: { video: StudioVideoDetail }) {
  const t = useT()
  const qc = useQueryClient()
  const canEdit = useHasPermission("video.uploads", "full")
  const key = ["studio-chapters", video.id]
  const { data, isLoading, isError } = useQuery({
    queryKey: key,
    queryFn: async () => (await api.get<ChaptersOut>(`${STUDIO}/videos/${video.id}/chapters`)).data,
  })
  const [rows, setRows] = useState<Row[]>([])
  const [saving, setSaving] = useState(false)
  const [refused, setRefused] = useState<string | null>(null)
  const [viewing, setViewing] = useState<number | null>(null)
  const [restoring, setRestoring] = useState(false)
  const confirm = useConfirm()

  useEffect(() => {
    if (data) setRows(toRows(data.chapters))
  }, [data])

  const span = video.duration_ms || 0
  const problems = useMemo(() => {
    const out: Record<number, string> = {}
    let prev: number | null = null
    rows.forEach((r, i) => {
      const ms = parseClock(r.time)
      if (ms === null) out[r.key] = t("Use minutes and seconds, like 1:30.")
      else if (i === 0 && ms !== 0) out[r.key] = t("The first chapter must start at 0:00.")
      else if (span && ms >= span) out[r.key] = t("This is after the end of the video ({end}).", { end: clock(span) })
      else if (prev !== null && ms <= prev) out[r.key] = t("Times must go up from one chapter to the next.")
      else if (prev !== null && ms - prev < MIN_GAP_MS) out[r.key] = t("Chapters must be at least 5 seconds apart.")
      else if (!r.title.trim()) out[r.key] = t("Give the chapter a title.")
      if (ms !== null) prev = ms
    })
    return out
  }, [rows, span, t])

  if (isLoading) return <Spinner />
  if (isError || !data) return <EmptyState title={t("Chapters could not be loaded")} hint={t("Try again in a moment.")} />

  const saved = JSON.stringify(data.chapters.map((c) => [clock(c.start_ms), c.title]))
  const dirty = JSON.stringify(rows.map((r) => [r.time.trim(), r.title.trim()])) !== saved
  const invalid = Object.keys(problems).length > 0
  const sorted = rows.every((r, i) => i === 0 || (parseClock(r.time) ?? 0) > (parseClock(rows[i - 1].time) ?? 0))

  const update = (k: number, patch: Partial<Row>) => setRows((list) => list.map((r) => (r.key === k ? { ...r, ...patch } : r)))
  const move = (i: number, by: -1 | 1) =>
    setRows((list) => {
      const next = [...list]
      const j = i + by
      if (j < 0 || j >= next.length) return list
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  const add = () =>
    setRows((list) => {
      const last = list.length ? parseClock(list[list.length - 1].time) ?? 0 : null
      const at = last === null ? 0 : Math.min(last + 30_000, Math.max(0, span - MIN_GAP_MS))
      return [...list, { key: ++seq, time: clock(at), title: "" }]
    })
  const sortByTime = () =>
    setRows((list) => [...list].sort((a, b) => (parseClock(a.time) ?? 0) - (parseClock(b.time) ?? 0)))

  async function save() {
    setSaving(true)
    setRefused(null)
    try {
      const chapters = rows.map((r) => ({ start_ms: parseClock(r.time) ?? 0, title: r.title.trim() }))
      const { data: fresh } = await api.put<ChaptersOut>(`${STUDIO}/videos/${video.id}/chapters`, { chapters })
      qc.setQueryData(key, fresh)
      qc.invalidateQueries({ queryKey: ["studio-video", String(video.id)] })
      toast.success(t("Chapters saved"))
    } catch (err) {
      setRefused(detail(err, t("The chapters could not be saved")))
    } finally {
      setSaving(false)
    }
  }

  const shown = viewing === null ? null : data.history.find((h) => h.version === viewing) ?? null

  async function restore(version: number) {
    if (dirty) {
      const ok = await confirm({
        title: t("Discard your unsaved changes?"),
        message: t("Restoring version {n} replaces the chapters you are editing.", { n: version }),
        confirmLabel: t("Restore"),
        variant: "destructive",
      })
      if (!ok) return
    }
    setRestoring(true)
    try {
      const { data: fresh } = await api.post<ChaptersOut>(`${STUDIO}/videos/${video.id}/chapters/restore`, { version })
      qc.setQueryData(key, fresh)
      qc.invalidateQueries({ queryKey: ["studio-video", String(video.id)] })
      setViewing(null)
      setRefused(null)
      toast.success(t("Version {n} restored as version {m}", { n: version, m: fresh.version }))
    } catch (err) {
      toast.error(detail(err, t("That version could not be restored")))
    } finally {
      setRestoring(false)
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-3 [&>*]:min-w-0">
      <Card className="space-y-3 p-5 lg:col-span-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-navy">{t("Chapters")}</h2>
            <p className="text-sm text-slate-500">
              {t("Viewers see chapters on the progress bar and can jump between them. The first starts at 0:00; keep them at least 5 seconds apart.")}
            </p>
          </div>
          {data.version > 0 && <Badge color="slate">{t("Version {n}", { n: data.version })}</Badge>}
        </div>
        {!canEdit && <ViewOnly />}

        {rows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-sm text-slate-500">
            {t("No chapters yet. Add the first one at 0:00, or wait for AI to suggest them.")}
          </p>
        ) : (
          <ol className="space-y-2">
            {rows.map((r, i) => (
              <li key={r.key} className="rounded-lg border border-slate-200 p-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-6 text-center font-num text-xs text-slate-500" aria-hidden="true">{i + 1}</span>
                  <Input
                    aria-label={t("Start of chapter {n}", { n: i + 1 })}
                    value={r.time}
                    inputMode="numeric"
                    placeholder="0:00"
                    disabled={!canEdit}
                    onChange={(e) => update(r.key, { time: e.target.value })}
                    className="w-20 font-num"
                  />
                  <Input
                    aria-label={t("Title of chapter {n}", { n: i + 1 })}
                    value={r.title}
                    maxLength={120}
                    placeholder={t("Chapter title")}
                    disabled={!canEdit}
                    onChange={(e) => update(r.key, { title: e.target.value })}
                    className="min-w-40 flex-1"
                  />
                  {canEdit && (
                    <span className="flex items-center gap-0.5">
                      <Button size="sm" variant="ghost" aria-label={t("Move chapter {n} up", { n: i + 1 })} disabled={i === 0} onClick={() => move(i, -1)}>
                        <ArrowUp size={14} />
                      </Button>
                      <Button size="sm" variant="ghost" aria-label={t("Move chapter {n} down", { n: i + 1 })} disabled={i === rows.length - 1} onClick={() => move(i, 1)}>
                        <ArrowDown size={14} />
                      </Button>
                      <Button size="sm" variant="ghost" className="text-red-700" aria-label={t("Remove chapter {n}", { n: i + 1 })}
                        onClick={() => setRows((list) => list.filter((x) => x.key !== r.key))}>
                        <Trash2 size={14} />
                      </Button>
                    </span>
                  )}
                </div>
                {problems[r.key] && <p className="mt-1 pl-8 text-xs text-red-700">{problems[r.key]}</p>}
              </li>
            ))}
          </ol>
        )}

        {refused && (
          <p role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{refused}</p>
        )}

        {canEdit && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={add} disabled={rows.length >= 50}>
                <Plus size={14} /> {t("Add chapter")}
              </Button>
              {!sorted && (
                <Button size="sm" variant="outline" onClick={sortByTime}>
                  <ListOrdered size={14} /> {t("Sort by time")}
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => { setRows(toRows(data.chapters)); setRefused(null) }} disabled={!dirty}>
                <RotateCcw size={14} /> {t("Undo changes")}
              </Button>
            </div>
            <Button onClick={save} disabled={saving || !dirty || invalid}>
              <Save size={14} /> {saving ? t("Saving…") : t("Save chapters")}
            </Button>
          </div>
        )}
      </Card>

      <Card className="h-fit space-y-2 p-5">
        <h2 className="text-sm font-bold text-navy">{t("History")}</h2>
        {data.history.length === 0 ? (
          <p className="text-sm text-slate-500">{t("No versions yet.")}</p>
        ) : (
          <ul className="space-y-2">
            {data.history.map((h) => (
              <li key={h.version} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 font-medium text-slate-800">
                    {t("Version {n}", { n: h.version })}
                    {h.version === data.version && <span className="text-xs font-normal text-slate-500">({t("current")})</span>}
                  </span>
                  <span className="block text-xs text-slate-500">
                    {h.count === 1 ? t("1 chapter") : t("{n} chapters", { n: h.count })} · {when(h.created_at, true)}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <Badge color={h.by === "ai" ? "purple" : "blue"}>{h.by === "ai" ? t("AI") : t("Creator")}</Badge>
                  <Button size="sm" variant="ghost" onClick={() => setViewing(h.version)} aria-label={t("View version {n}", { n: h.version })}>
                    <Eye size={14} />
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal
        open={shown !== null}
        onClose={() => setViewing(null)}
        title={shown ? t("Version {n}", { n: shown.version }) : ""}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setViewing(null)}>{t("Close")}</Button>
            {canEdit && shown && shown.version !== data.version && shown.count > 0 && (
              <Button onClick={() => restore(shown.version)} disabled={restoring}>
                <History size={14} /> {restoring ? t("Restoring…") : t("Restore this version")}
              </Button>
            )}
          </div>
        }
      >
        {shown && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              {shown.by === "ai" ? t("Suggested by AI {when}.", { when: when(shown.created_at, true) }) : t("Edited by the creator {when}.", { when: when(shown.created_at, true) })}
              {shown.version !== data.version && " " + t("Restoring it saves a copy as a new version; nothing is lost.")}
            </p>
            {shown.chapters.length === 0 ? (
              <p className="text-sm text-slate-500">{t("This version has no chapters.")}</p>
            ) : (
              <ol className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {shown.chapters.map((c, i) => (
                  <li key={`${c.start_ms}-${i}`} className="flex gap-3 px-3 py-2 text-sm">
                    <span className="w-14 shrink-0 font-num text-slate-500">{clock(c.start_ms)}</span>
                    <span className="min-w-0 text-slate-800">{c.title}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
