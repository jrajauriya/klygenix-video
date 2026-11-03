import { useEffect, useState } from "react"
import { ExternalLink } from "lucide-react"
import { Badge, DataTable, Drawer, Input, PageHeader, SectionHeading, Select } from "@klygenixvideo/ui"
import { usePagedList } from "@klygenixvideo/client"
import { Row, Status, VIDEO_ADMIN, VIDEO_STATUS, fmtDuration, humanise, num, useCanAct, watchUrl, when } from "../lib/shared"
import type { AdminVideo } from "../lib/types"
import { ActionForm } from "../components/moderation/ActionForm"

const STATUSES = [
  { value: "all", label: "Every status" },
  ...Object.entries(VIDEO_STATUS).map(([value, t]) => ({ value, label: t.label })),
]

function useDebounced(value: string, ms = 300) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

function VideoDrawer({ video, onClose }: { video: AdminVideo | null; onClose: () => void }) {
  const canAct = useCanAct("admin.moderation")
  if (!video) return null
  return (
    <Drawer open onClose={onClose} width="lg" title={video.title} subtitle={video.channel ? `@${video.channel}` : undefined}>
      <div className="space-y-6">
        {video.thumbnail && (
          <img
            src={video.thumbnail}
            alt=""
            className={`rounded-lg bg-slate-100 object-cover ${video.kind === "reel" ? "h-64 w-36" : "aspect-video w-full"}`}
          />
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Status map={VIDEO_STATUS} status={video.status} />
          <Badge color="slate">{video.kind === "reel" ? "Reel" : "Long video"}</Badge>
          {video.ai_generated && <Badge color="purple">AI-generated</Badge>}
          {video.embed_platform && <Badge color="blue">{humanise(video.embed_platform)} embed</Badge>}
        </div>
        <dl className="grid grid-cols-2 gap-4">
          <Row label="Visibility" value={humanise(video.visibility)} />
          <Row label="Duration" value={fmtDuration(video.duration_ms)} />
          <Row label="Views · likes" value={`${num(video.views)} · ${num(video.likes)}`} />
          <Row label="Comments · danmaku" value={`${num(video.comments)} · ${num(video.danmaku)}`} />
          <Row label="Uploaded" value={when(video.created_at, true)} />
          <Row label="Published" value={video.published_at ? when(video.published_at, true) : "Not yet"} />
          <Row label="AI" value={video.ai_status ? humanise(video.ai_status) : "—"} />
          <Row label="Source" value={humanise(video.source)} />
          {video.status_note && <Row label="Status note" value={video.status_note} wide />}
          {video.description && <Row label="Description" value={video.description} wide />}
        </dl>
        <a
          href={watchUrl(video.public_id)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline"
        >
          Open the watch page <ExternalLink size={13} />
        </a>
        {canAct && (
          <section>
            <SectionHeading>Act on this video</SectionHeading>
            <ActionForm targetType="video" targetId={video.id} onDone={onClose} />
          </section>
        )}
      </div>
    </Drawer>
  )
}

export default function Videos() {
  const [status, setStatus] = useState("all")
  const [search, setSearch] = useState("")
  const q = useDebounced(search)
  const [open, setOpen] = useState<AdminVideo | null>(null)
  const list = usePagedList<AdminVideo>("admin-video-videos", `${VIDEO_ADMIN}/videos`, { status, q }, 50)

  return (
    <>
      <PageHeader title="Videos" subtitle="Every video on the platform, across all channels" />
      <DataTable
        label="Videos"
        loading={list.isLoading}
        rows={list.rows}
        rowKey={(r) => r.id}
        serverTotal={list.total}
        onServerPage={list.onServerPage}
        pageSize={list.pageSize}
        pageSizeOptions={[25, 50, 100, 200]}
        unitLabel="videos"
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search titles"
        toolbarRight={<Select value={status} onChange={setStatus} options={STATUSES} aria-label="Status" className="w-48" />}
        emptyTitle="No videos match"
        onRowClick={(r) => setOpen(r)}
        columns={[
          {
            key: "title",
            header: "Video",
            render: (r) => (
              <div className="flex min-w-0 items-center gap-3">
                {r.thumbnail ? (
                  <img src={r.thumbnail} alt="" className="h-9 w-16 shrink-0 rounded bg-slate-100 object-cover" />
                ) : (
                  <div className="h-9 w-16 shrink-0 rounded bg-slate-100" />
                )}
                <div className="min-w-0">
                  <p className="max-w-sm truncate font-medium text-navy">{r.title}</p>
                  <p className="truncate text-xs text-slate-500">{r.channel ? `@${r.channel}` : "—"}</p>
                </div>
              </div>
            ),
          },
          { key: "kind", header: "Kind", render: (r) => (r.kind === "reel" ? "Reel" : "Long") },
          { key: "status", header: "Status", render: (r) => <Status map={VIDEO_STATUS} status={r.status} /> },
          { key: "duration", header: "Length", align: "right", render: (r) => <span className="font-num">{fmtDuration(r.duration_ms)}</span> },
          { key: "views", header: "Views", align: "right", render: (r) => <span className="font-num">{num(r.views)}</span> },
          { key: "created", header: "Uploaded", render: (r) => when(r.created_at) },
          {
            key: "watch",
            header: "",
            srHeader: "Watch",
            render: (r) => (
              <a
                href={watchUrl(r.public_id)}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"
              >
                Watch <ExternalLink size={12} />
              </a>
            ),
          },
        ]}
      />
      <VideoDrawer video={open} onClose={() => setOpen(null)} />
    </>
  )
}
