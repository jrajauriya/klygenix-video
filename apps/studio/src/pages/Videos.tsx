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
import { useT } from "../i18n"

const KIND_OPTIONS = [
  { value: "all", label: "Long and reels" },
  { value: "long", label: "Long videos" },
  { value: "reel", label: "Reels" },
]

export default function Videos() {
  const t = useT()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [status, setStatus] = useState("all")
  const [kind, setKind] = useState("all")
  const [search, setSearch] = useState("")
  const [q, setQ] = useState("")
  const uploading = params.get("upload") === "1"

  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), 300)
    return () => clearTimeout(timer)
  }, [search])

  const list = usePagedList<StudioVideo>("studio-videos", `${STUDIO}/videos`, { status, kind, q }, 25)

  const columns: DataTableColumn<StudioVideo>[] = [
    {
      key: "title",
      header: t("Video"),
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
              {v.source === "embed" ? t("Linked from {platform}", { platform: v.embed_platform === "bilibili" ? "Bilibili" : "YouTube" }) : v.description || t("No description")}
            </p>
          </div>
        </div>
      ),
    },
    { key: "kind", header: t("Kind"), render: (v) => <KindBadge kind={v.kind} /> },
    { key: "status", header: t("Status"), render: (v) => <VideoStatusPill video={v} /> },
    { key: "visibility", header: t("Visibility"), render: (v) => <VisibilityBadge value={v.visibility} /> },
    { key: "views", header: t("Views"), align: "right", sortKey: "views", render: (v) => <span className="font-num">{compact(v.views)}</span> },
    { key: "created", header: t("Uploaded"), sortKey: "created_at", render: (v) => <span className="whitespace-nowrap text-slate-600">{when(v.created_at)}</span> },
  ]

  return (
    <ListPage>
      <PageHeader
        title={t("Videos")}
        subtitle={t("Everything on your channel: uploads, reels made from clips, and videos linked from YouTube or Bilibili.")}
        actions={<Button onClick={() => setParams({ upload: "1" })}><Upload size={15} /> {t("Upload")}</Button>}
      />
      <DataTable
        label={t("Videos")}
        rows={list.rows}
        columns={columns}
        rowKey={(v) => v.id}
        loading={list.isLoading}
        serverTotal={list.total}
        onServerPage={list.onServerPage}
        pageSize={25}
        pageSizeOptions={[25, 50, 100]}
        unitLabel={t("videos")}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={t("Search titles and descriptions…")}
        onRowClick={(v) => navigate(`/videos/${v.id}`)}
        emptyTitle={t("No videos match")}
        emptyDescription={status === "all" && kind === "all" && !q ? t("Upload your first video to get started.") : t("Try a different filter.")}
        toolbarRight={
          <div className="flex flex-wrap gap-2">
            <Select value={status} onChange={setStatus} options={STATUS_OPTIONS.map((o) => ({ ...o, label: t(o.label) }))} className="w-40" />
            <Select value={kind} onChange={setKind} options={KIND_OPTIONS.map((o) => ({ ...o, label: t(o.label) }))} className="w-40" />
          </div>
        }
      />
      <UploadDrawer open={uploading} onClose={() => setParams({}, { replace: true })} />
    </ListPage>
  )
}
