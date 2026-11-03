import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Plus } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { Badge, Button, DataTable, ListPage, Modal, PageHeader, Select, type DataTableColumn } from "@klygenixvideo/ui"
import { usePagedList } from "@klygenixvideo/client"
import { STUDIO } from "../lib/hooks"
import { clock, detail, when } from "../lib/format"
import { createClip } from "../lib/clips"
import type { Clip, StudioVideo } from "../lib/types"
import { ClipStatusPill } from "../components/StatusChips"

const STATUS = [
  { value: "all", label: "Any status" },
  { value: "draft", label: "Draft" },
  { value: "queued", label: "Queued" },
  { value: "rendering", label: "Rendering" },
  { value: "rendered", label: "Ready" },
  { value: "published", label: "Published" },
  { value: "failed", label: "Failed" },
]

function useSourceVideos() {
  return useQuery({
    queryKey: ["studio-videos", "sources"],
    queryFn: async () => (await api.get<StudioVideo[]>(`${STUDIO}/videos?limit=100`)).data,
  })
}

export default function Clips() {
  const navigate = useNavigate()
  const [status, setStatus] = useState("all")
  const [picking, setPicking] = useState(false)
  const list = usePagedList<Clip>("studio-clips", `${STUDIO}/clips`, { status }, 50)
  const { data: videos } = useSourceVideos()
  const titles = useMemo(() => new Map((videos ?? []).map((v) => [v.id, v.title])), [videos])

  const columns: DataTableColumn<Clip>[] = [
    {
      key: "title",
      header: "Clip",
      render: (c) => (
        <div className="min-w-0">
          <p className="max-w-[22rem] truncate font-medium text-slate-800">{c.title}</p>
          <p className="max-w-[22rem] truncate text-xs text-slate-500">From {titles.get(c.source_video_id) ?? `video ${c.source_video_id}`}</p>
        </div>
      ),
    },
    {
      key: "range",
      header: "Moment",
      render: (c) => <span className="whitespace-nowrap font-num text-slate-600">{clock(c.start_ms)} – {clock(c.end_ms)} · {Math.round(c.duration_ms / 1000)} s</span>,
    },
    { key: "aspect", header: "Shape", render: (c) => <Badge color="slate">{c.aspect}</Badge> },
    { key: "status", header: "Status", render: (c) => <ClipStatusPill status={c.status} /> },
    { key: "updated", header: "Updated", sortKey: "updated_at", render: (c) => <span className="whitespace-nowrap text-slate-600">{when(c.updated_at, true)}</span> },
  ]

  return (
    <ListPage>
      <PageHeader
        title="Clip maker"
        subtitle="Cut short vertical reels with captions from your long videos, then publish them to your channel."
        actions={<Button onClick={() => setPicking(true)}><Plus size={15} /> New clip</Button>}
      />
      <DataTable
        label="Clips"
        rows={list.rows}
        columns={columns}
        rowKey={(c) => c.id}
        loading={list.isLoading}
        serverTotal={list.total}
        onServerPage={list.onServerPage}
        pageSize={50}
        pageSizeOptions={[50, 100, 200]}
        unitLabel="clips"
        onRowClick={(c) => navigate(`/clips/${c.id}`)}
        emptyTitle="No clips yet"
        emptyDescription="Open a long video's Clips tab to see the moments we suggest, or start a new clip."
        toolbarRight={<Select value={status} onChange={setStatus} options={STATUS} className="w-40" />}
      />
      <PickSource open={picking} onClose={() => setPicking(false)} videos={videos ?? []} />
    </ListPage>
  )
}

function PickSource({ open, onClose, videos }: { open: boolean; onClose: () => void; videos: StudioVideo[] }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [busy, setBusy] = useState<number | null>(null)
  const sources = videos.filter((v) => v.source !== "embed" && ["published", "in_review"].includes(v.status) && v.duration_ms > 3000)

  async function start(v: StudioVideo) {
    setBusy(v.id)
    try {
      const clip = await createClip({ source_video_id: v.id, title: `Clip from ${v.title}`, start_ms: 0, end_ms: Math.min(v.duration_ms, 30_000) })
      qc.invalidateQueries({ queryKey: ["studio-clips"] })
      navigate(`/clips/${clip.id}`)
    } catch (err) {
      toast.error(detail(err, "Could not start the clip"))
      setBusy(null)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Pick a video to clip" size="md">
      {sources.length === 0 ? (
        <p className="text-sm text-slate-500">Clips are cut from your own published uploads. Upload a video first.</p>
      ) : (
        <ul className="max-h-[60vh] divide-y divide-slate-100 overflow-y-auto">
          {sources.map((v) => (
            <li key={v.id}>
              <button type="button" disabled={busy !== null} onClick={() => start(v)}
                className="flex w-full items-center gap-3 px-1 py-2.5 text-left hover:bg-slate-50 disabled:opacity-60">
                <div className="h-10 w-16 shrink-0 overflow-hidden rounded bg-slate-200">
                  {v.thumbnail && <img src={v.thumbnail} alt="" className="h-full w-full object-cover" />}
                </div>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">{v.title}</span>
                <span className="font-num text-xs text-slate-500">{busy === v.id ? "Starting…" : clock(v.duration_ms)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
