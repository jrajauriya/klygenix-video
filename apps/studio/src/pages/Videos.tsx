import { useEffect, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { Upload } from "lucide-react"
import { Button, DataTable, ListPage, PageHeader, Select, type DataTableColumn } from "@klygenixvideo/ui"
import { usePagedList } from "@klygenixvideo/client"
import { STUDIO } from "../lib/hooks"
import { clock, compact, when } from "../lib/format"
import type { StudioVideo } from "../lib/types"
import { KindBadge, STATUS_OPTIONS, VideoStatusPill, VisibilityBadge } from "../components/StatusChips"
import { UploadDrawer } from "../components/upload/UploadDrawer"

const KIND_OPTIONS = [
  { value: "all", label: "Long and reels" },
  { value: "long", label: "Long videos" },
  { value: "reel", label: "Reels" },
]

export default function Videos() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [status, setStatus] = useState("all")
  const [kind, setKind] = useState("all")
  const [search, setSearch] = useState("")
  const [q, setQ] = useState("")
  const uploading = params.get("upload") === "1"

  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  const list = usePagedList<StudioVideo>("studio-videos", `${STUDIO}/videos`, { status, kind, q }, 25)

  const columns: DataTableColumn<StudioVideo>[] = [
    {
      key: "title",
      header: "Video",
      render: (v) => (
        <div className="flex min-w-0 items-center gap-3">
          <div className="relative h-12 w-20 shrink-0 overflow-hidden rounded bg-slate-200">
            {v.thumbnail && <img src={v.thumbnail} alt="" loading="lazy" className="h-full w-full object-cover" />}
            {v.duration_ms > 0 && (
              <span className="absolute bottom-0 right-0 rounded-tl bg-black/70 px-1 font-num text-[10px] text-white">{clock(v.duration_ms)}</span>
            )}
          </div>
          <div className="min-w-0">
            <p className="max-w-[22rem] truncate font-medium text-slate-800">{v.title}</p>
            <p className="max-w-[22rem] truncate text-xs text-slate-500">
              {v.source === "embed" ? `Linked from ${v.embed_platform === "bilibili" ? "Bilibili" : "YouTube"}` : v.description || "No description"}
            </p>
          </div>
        </div>
      ),
    },
    { key: "kind", header: "Kind", render: (v) => <KindBadge kind={v.kind} /> },
    { key: "status", header: "Status", render: (v) => <VideoStatusPill video={v} /> },
    { key: "visibility", header: "Visibility", render: (v) => <VisibilityBadge value={v.visibility} /> },
    { key: "views", header: "Views", align: "right", sortKey: "views", render: (v) => <span className="font-num">{compact(v.views)}</span> },
    { key: "created", header: "Uploaded", sortKey: "created_at", render: (v) => <span className="whitespace-nowrap text-slate-600">{when(v.created_at)}</span> },
  ]

  return (
    <ListPage>
      <PageHeader
        title="Videos"
        subtitle="Everything on your channel: uploads, reels made from clips, and videos linked from YouTube or Bilibili."
        actions={<Button onClick={() => setParams({ upload: "1" })}><Upload size={15} /> Upload</Button>}
      />
      <DataTable
        label="Videos"
        rows={list.rows}
        columns={columns}
        rowKey={(v) => v.id}
        loading={list.isLoading}
        serverTotal={list.total}
        onServerPage={list.onServerPage}
        pageSize={25}
        pageSizeOptions={[25, 50, 100]}
        unitLabel="videos"
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search titles and descriptions…"
        onRowClick={(v) => navigate(`/videos/${v.id}`)}
        emptyTitle="No videos match"
        emptyDescription={status === "all" && kind === "all" && !q ? "Upload your first video to get started." : "Try a different filter."}
        toolbarRight={
          <div className="flex flex-wrap gap-2">
            <Select value={status} onChange={setStatus} options={STATUS_OPTIONS} className="w-40" />
            <Select value={kind} onChange={setKind} options={KIND_OPTIONS} className="w-40" />
          </div>
        }
      />
      <UploadDrawer open={uploading} onClose={() => setParams({}, { replace: true })} />
    </ListPage>
  )
}
