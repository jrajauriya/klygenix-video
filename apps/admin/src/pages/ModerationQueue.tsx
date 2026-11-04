import { useEffect, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { Badge, DataTable, PageHeader } from "@klygenixvideo/ui"
import { usePagedList } from "@klygenixvideo/client"
import { VIDEO_ADMIN, humanise, reasonLabel, relative } from "../lib/shared"
import type { QueueItem } from "../lib/types"
import { ModerationTabs } from "../components/moderation/ModerationTabs"
import { QueueDrawer } from "../components/moderation/QueueDrawer"

export const QUEUE_KEY = "admin-video-queue"

function targetLabel(q: QueueItem): string {
  const t = q.target
  if (t.missing) return `#${q.target_id} (gone)`
  if (q.target_type === "video") return t.title ?? `Video #${q.target_id}`
  if (q.target_type === "channel") return t.name ? `${t.name} (@${t.handle})` : `Channel #${q.target_id}`
  if (q.target_type === "live") return t.title ?? `Live stream #${q.target_id}`
  if (q.target_type === "live_message") return `${t.author ? `${t.author}: ` : ""}${t.text ?? `#${q.target_id}`}`
  return t.text ?? `#${q.target_id}`
}

export default function ModerationQueue() {
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const [open, setOpen] = useState<QueueItem | null>(null)
  const list = usePagedList<QueueItem>(QUEUE_KEY, `${VIDEO_ADMIN}/queue`, {}, 50)

  useEffect(() => {
    const wanted = params.get("open")
    if (!wanted || open) return
    const hit = list.rows.find((r) => `${r.target_type}:${r.target_id}` === wanted)
    if (hit) setOpen(hit)
  }, [params, list.rows, open])

  function close() {
    setOpen(null)
    if (params.has("open")) {
      params.delete("open")
      setParams(params, { replace: true })
    }
  }

  function acted() {
    qc.invalidateQueries({ queryKey: [QUEUE_KEY] })
    qc.invalidateQueries({ queryKey: ["admin-video-stats"] })
    qc.invalidateQueries({ queryKey: ["admin-video-actions"] })
    close()
  }

  return (
    <>
      <PageHeader title="Moderation" subtitle="Videos held by the scan and everything viewers have reported" />
      <ModerationTabs active="/moderation" />
      <DataTable
        label="Moderation queue"
        loading={list.isLoading}
        rows={list.rows}
        rowKey={(r) => `${r.target_type}:${r.target_id}`}
        serverTotal={list.total}
        onServerPage={list.onServerPage}
        pageSize={list.pageSize}
        pageSizeOptions={[25, 50, 100, 200]}
        unitLabel="items"
        emptyTitle="The queue is clear"
        emptyDescription="Held videos and reported items show here."
        onRowClick={(r) => setOpen(r)}
        columns={[
          {
            key: "why",
            header: "Why",
            render: (r) => <Badge color={r.why === "held" ? "amber" : "red"}>{r.why === "held" ? "Held" : "Reported"}</Badge>,
          },
          { key: "type", header: "Type", render: (r) => humanise(r.target_type) },
          {
            key: "target",
            header: "Item",
            render: (r) => (
              <div className="flex min-w-0 items-center gap-3">
                {r.target_type === "video" && r.target.thumbnail && (
                  <img src={r.target.thumbnail} alt="" className="h-9 w-16 shrink-0 rounded bg-slate-100 object-cover" />
                )}
                <div className="min-w-0">
                  <p className="max-w-md truncate font-medium text-navy">{targetLabel(r)}</p>
                  {r.target_type === "video" && r.target.channel && (
                    <p className="truncate text-xs text-slate-500">@{r.target.channel}</p>
                  )}
                  {(r.target_type === "comment" || r.target_type === "danmaku") && r.target.video_title && (
                    <p className="truncate text-xs text-slate-500">on {r.target.video_title}</p>
                  )}
                  {r.target_type === "live" && r.target.channel && (
                    <p className="truncate text-xs text-slate-500">@{r.target.channel}</p>
                  )}
                  {r.target_type === "live_message" && r.target.live_title && (
                    <p className="truncate text-xs text-slate-500">in {r.target.live_title}</p>
                  )}
                </div>
              </div>
            ),
          },
          { key: "reports", header: "Reports", align: "right", render: (r) => <span className="font-num">{r.reports}</span> },
          {
            key: "labels",
            header: "Labels",
            render: (r) => (
              <div className="flex flex-wrap gap-1">
                {r.labels.slice(0, 3).map((l) => (
                  <Badge key={l} color="slate">
                    {reasonLabel(l)}
                  </Badge>
                ))}
              </div>
            ),
          },
          { key: "since", header: "Since", render: (r) => <span className="text-slate-500">{relative(r.since)}</span> },
        ]}
      />
      <QueueDrawer item={open} onClose={close} onActed={acted} />
    </>
  )
}
