import { useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Download, ExternalLink, RotateCcw } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { Badge, Button, Card, Modal, ProgressBar, Spinner, StatusPill } from "@klygenixvideo/ui"
import { STUDIO } from "../../lib/hooks"
import { clock, detail, watchUrl, when } from "../../lib/format"
import type { Connected, ImportItem, ImportJob, RemoteVideo } from "../../lib/types"
import { useT } from "../../i18n"

const MAX = 200
const LIVE = ["queued", "running"]

const JOB_STATUS: Record<string, { label: string; hex: string }> = {
  queued: { label: "Queued", hex: "#92400e" },
  running: { label: "Importing", hex: "#1d4ed8" },
  done: { label: "Finished", hex: "#166534" },
  failed: { label: "Failed", hex: "#b91c1c" },
}

const ITEM_STATUS: Record<ImportItem["status"], { label: string; hex: string }> = {
  pending: { label: "Waiting", hex: "#475569" },
  done: { label: "Imported", hex: "#166534" },
  failed: { label: "Failed", hex: "#b91c1c" },
  skipped: { label: "Skipped", hex: "#475569" },
}

function JobPill({ status }: { status: string }) {
  const t = useT()
  const s = JOB_STATUS[status] ?? { label: status, hex: "#475569" }
  return <StatusPill label={t(s.label)} hex={s.hex} />
}

export function ImportPicker({ connected, onClose, onStarted }: { connected: Connected; onClose: () => void; onStarted: (job: ImportJob) => void }) {
  const t = useT()
  const qc = useQueryClient()
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const allRef = useRef<HTMLInputElement>(null)
  const remote = useInfiniteQuery({
    queryKey: ["studio-yt-remote", connected.id],
    queryFn: async ({ pageParam }) =>
      (await api.get<{ items: RemoteVideo[]; next_page_token: string | null }>(`${STUDIO}/connected/${connected.id}/youtube/videos`, {
        params: pageParam ? { page_token: pageParam } : {},
      })).data,
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_page_token || undefined,
    staleTime: 0,
  })
  const items = useMemo(() => remote.data?.pages.flatMap((p) => p.items) ?? [], [remote.data])
  const open = items.filter((v) => !v.imported)
  const chosen = new Set(selected)
  const allChosen = open.length > 0 && open.every((v) => chosen.has(v.external_id))
  const someChosen = open.some((v) => chosen.has(v.external_id))

  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = someChosen && !allChosen
  }, [someChosen, allChosen])

  function toggle(id: string) {
    setSelected((list) => {
      if (list.includes(id)) return list.filter((x) => x !== id)
      if (list.length >= MAX) {
        toast.error(t("You can import up to {n} videos at a time.", { n: MAX }))
        return list
      }
      return [...list, id]
    })
  }

  function toggleAll() {
    if (allChosen) {
      setSelected([])
      return
    }
    const ids = open.map((v) => v.external_id)
    if (ids.length > MAX) toast(t("The first {n} are selected. Import them, then pick the rest.", { n: MAX }))
    setSelected(ids.slice(0, MAX))
  }

  async function start() {
    setBusy(true)
    try {
      const { data } = await api.post<ImportJob>(`${STUDIO}/connected/${connected.id}/imports`, { external_ids: selected })
      qc.invalidateQueries({ queryKey: ["studio-imports"] })
      toast.success(selected.length === 1 ? t("Importing 1 video") : t("Importing {n} videos", { n: selected.length }))
      onStarted(data)
    } catch (err) {
      toast.error(detail(err, t("The import could not be started")))
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={t("Import from {name}", { name: connected.title || "YouTube" })}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm text-slate-600" aria-live="polite">
            {selected.length === 1 ? t("1 video selected") : t("{n} videos selected", { n: selected.length })}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>{t("Cancel")}</Button>
            <Button onClick={start} disabled={busy || selected.length === 0}>
              <Download size={14} /> {busy ? t("Starting…") : selected.length === 1 ? t("Import 1 video") : t("Import {n} videos", { n: selected.length })}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-slate-600">
          {t("Pick the videos to bring over. They are linked, not copied: each plays from YouTube inside your channel, with its captions imported for AI features.")}
        </p>
        {remote.isLoading ? (
          <Spinner />
        ) : remote.isError ? (
          <p role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
            {detail(remote.error, t("Your YouTube videos could not be loaded"))}
          </p>
        ) : items.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-sm text-slate-500">{t("No videos found on this YouTube channel.")}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold text-slate-600">
                  <th className="w-10 px-3 py-2">
                    <input ref={allRef} type="checkbox" className="h-4 w-4 accent-[#A21CAF]" checked={allChosen} disabled={open.length === 0}
                      onChange={toggleAll} aria-label={t("Select all videos not yet imported")} />
                  </th>
                  <th className="px-3 py-2">{t("Video")}</th>
                  <th className="px-3 py-2">{t("Length")}</th>
                  <th className="px-3 py-2">{t("Published")}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((v) => (
                  <tr key={v.external_id} className="border-b border-slate-100 last:border-0">
                    <td className="px-3 py-2">
                      {v.imported ? null : (
                        <input type="checkbox" className="h-4 w-4 accent-[#A21CAF]" checked={chosen.has(v.external_id)}
                          onChange={() => toggle(v.external_id)} aria-label={t("Import {title}", { title: v.title || v.external_id })} />
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className="block max-w-md truncate font-medium text-slate-800">{v.title || v.external_id}</span>
                      {v.imported && (
                        <span className="mt-0.5 flex items-center gap-1.5 text-xs">
                          <Badge color="green">{t("Already imported")}</Badge>
                          {v.public_id && (
                            <a href={watchUrl(v.public_id)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 font-semibold text-brand hover:underline">
                              {t("Watch")} <ExternalLink size={11} aria-hidden="true" />
                            </a>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 font-num text-slate-600">{v.duration_ms ? clock(v.duration_ms) : "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-600">{v.published_at ? when(v.published_at) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {remote.hasNextPage && (
          <div className="flex justify-center">
            <Button variant="outline" size="sm" onClick={() => remote.fetchNextPage()} disabled={remote.isFetchingNextPage}>
              {remote.isFetchingNextPage ? t("Loading…") : t("Load more")}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  )
}

export function ImportJobModal({ jobId, onClose }: { jobId: number; onClose: () => void }) {
  const t = useT()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const { data: job, isLoading, isError } = useQuery({
    queryKey: ["studio-import", jobId],
    queryFn: async () => (await api.get<ImportJob>(`${STUDIO}/imports/${jobId}`)).data,
    refetchInterval: (q) => (q.state.data && LIVE.includes(q.state.data.status) ? 2000 : false),
  })
  const live = Boolean(job && LIVE.includes(job.status))
  const wasLive = useRef(false)

  useEffect(() => {
    if (live) wasLive.current = true
    else if (wasLive.current && job) {
      wasLive.current = false
      qc.invalidateQueries({ queryKey: ["studio-imports"] })
      qc.invalidateQueries({ queryKey: ["studio-videos"] })
      qc.invalidateQueries({ queryKey: ["studio-connected"] })
      qc.invalidateQueries({ queryKey: ["studio-yt-remote"] })
    }
  }, [live, job, qc])

  async function resume() {
    setBusy(true)
    try {
      await api.post(`${STUDIO}/imports/${jobId}/resume`)
      toast.success(t("Trying the failed videos again"))
      qc.invalidateQueries({ queryKey: ["studio-import", jobId] })
      qc.invalidateQueries({ queryKey: ["studio-imports"] })
    } catch (err) {
      toast.error(detail(err, t("Could not retry the import")))
    } finally {
      setBusy(false)
    }
  }

  const items = job?.items ?? []
  const settled = items.filter((i) => i.status !== "pending").length

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={t("YouTube import")}
      footer={
        <div className="flex justify-end gap-2">
          {job && job.failed > 0 && !live && (
            <Button variant="outline" onClick={resume} disabled={busy}>
              <RotateCcw size={14} /> {busy ? t("Starting…") : t("Retry failed ({n})", { n: job.failed })}
            </Button>
          )}
          <Button onClick={onClose}>{t("Close")}</Button>
        </div>
      }
    >
      {isLoading ? (
        <Spinner />
      ) : isError || !job ? (
        <p className="text-sm text-slate-500">{t("The import could not be loaded. Try again in a moment.")}</p>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-slate-600">{t("Started {when}", { when: when(job.created_at, true) })}</span>
            <JobPill status={job.status} />
          </div>
          <div aria-live="polite">
            <ProgressBar value={items.length ? settled : job.done + job.failed} max={job.total || 1}
              label={t("{done} of {total}", { done: items.length ? settled : job.done + job.failed, total: job.total })} />
            <p className="mt-1 text-xs text-slate-600">
              {t("{done} imported · {failed} failed", { done: items.length ? items.filter((i) => i.status === "done").length : job.done, failed: items.length ? items.filter((i) => i.status === "failed").length : job.failed })}
              {live && ` · ${t("This updates by itself. You can close it; the import carries on.")}`}
            </p>
          </div>
          <ul className="scrollbar-slim max-h-[50vh] divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
            {items.map((i) => {
              const s = ITEM_STATUS[i.status] ?? { label: i.status, hex: "#475569" }
              return (
                <li key={i.external_id} className="flex flex-wrap items-start gap-2 px-3 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    {i.status === "done" && i.video_id ? (
                      <Link to={`/videos/${i.video_id}`} onClick={onClose} className="block truncate font-medium text-brand hover:underline">
                        {i.title || i.external_id}
                      </Link>
                    ) : (
                      <span className="block truncate font-medium text-slate-800">{i.title || i.external_id}</span>
                    )}
                    {i.error && <span className="block text-xs text-red-700">{i.error}</span>}
                  </div>
                  <StatusPill label={t(s.label)} hex={s.hex} />
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </Modal>
  )
}

export function ImportsPanel({ onOpen }: { onOpen: (jobId: number) => void }) {
  const t = useT()
  const { data: jobs = [] } = useQuery({
    queryKey: ["studio-imports"],
    queryFn: async () => (await api.get<ImportJob[]>(`${STUDIO}/imports`)).data,
    refetchInterval: (q) => ((q.state.data ?? []).some((j) => LIVE.includes(j.status)) ? 3000 : false),
  })
  if (jobs.length === 0) return null

  return (
    <Card className="p-5">
      <h2 className="text-sm font-bold text-navy">{t("Imports from YouTube")}</h2>
      <p className="mt-0.5 text-sm text-slate-500">{t("Your recent bulk imports. Open one to see each video, or retry the ones that failed.")}</p>
      <ul className="mt-3 divide-y divide-slate-100">
        {jobs.map((j) => (
          <li key={j.id} className="flex flex-wrap items-center gap-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-800">
                {j.total === 1 ? t("1 video") : t("{n} videos", { n: j.total })}
                <JobPill status={j.status} />
              </p>
              <p className="text-xs text-slate-500">
                {when(j.created_at, true)}{!LIVE.includes(j.status) && ` · ${t("{done} imported · {failed} failed", { done: j.done, failed: j.failed })}`}
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={() => onOpen(j.id)} aria-label={t("Open the import of {when}", { when: when(j.created_at, true) })}>
              {t("Open")}
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  )
}
