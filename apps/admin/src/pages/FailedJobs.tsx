import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { RefreshCw, RotateCcw } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { Badge, Button, DataTable, PageHeader, Select, useConfirm, type BadgeColor, type DataTableColumn } from "@klygenixvideo/ui"
import { VIDEO_ADMIN, detail, relative, useCanAct, when } from "../lib/shared"

interface FailedItem {
  kind: "video" | "render" | "dub" | "publish" | "payment_event" | "live"
  id: number
  title: string | null
  tenant_id: number | null
  detail: string | null
  at: string | null
}

const KIND: Record<FailedItem["kind"], { label: string; color: BadgeColor; retry: string | null }> = {
  video: { label: "Video AI", color: "blue", retry: "The AI pipeline runs again on this video." },
  render: { label: "Clip render", color: "purple", retry: "One render is reserved from the creator's quota and the clip is queued again." },
  dub: { label: "Dub", color: "brand", retry: "The dub is queued again." },
  publish: { label: "Publish", color: "amber", retry: "The clip is sent to the platform again." },
  payment_event: { label: "Payment event", color: "red", retry: "The provider event is processed again. Processing is idempotent." },
  live: { label: "Live stream", color: "slate", retry: null },
}

const KIND_FILTER = [
  { value: "all", label: "Every kind" },
  ...Object.entries(KIND).map(([value, k]) => ({ value, label: k.label })),
]

const QUERY = ["admin-ops-failed"]

export default function FailedJobs() {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const canAct = useCanAct("admin.dashboard")
  const [kind, setKind] = useState("all")
  const [busy, setBusy] = useState<string | null>(null)

  const { data = [], isLoading, isFetching, refetch } = useQuery({
    queryKey: QUERY,
    queryFn: async () => (await api.get<FailedItem[]>(`${VIDEO_ADMIN}/ops/failed`)).data,
  })
  const rows = kind === "all" ? data : data.filter((r) => r.kind === kind)

  async function retry(item: FailedItem) {
    const k = KIND[item.kind]
    const ok = await confirm({
      title: `Retry ${k.label.toLowerCase()} #${item.id}?`,
      message: k.retry ?? undefined,
      confirmLabel: "Retry",
    })
    if (!ok) return
    const tag = `${item.kind}-${item.id}`
    setBusy(tag)
    try {
      await api.post(`${VIDEO_ADMIN}/ops/failed/${item.kind}/${item.id}/retry`)
      toast.success("Queued again")
    } catch (err) {
      toast.error(detail(err, "That job could not be retried"))
    } finally {
      setBusy(null)
      qc.invalidateQueries({ queryKey: QUERY })
    }
  }

  const columns: DataTableColumn<FailedItem>[] = [
    {
      key: "kind",
      header: "Kind",
      sortValue: (r) => r.kind,
      render: (r) => <Badge color={KIND[r.kind]?.color ?? "slate"}>{KIND[r.kind]?.label ?? r.kind}</Badge>,
    },
    {
      key: "title",
      header: "Item",
      render: (r) => (
        <div className="min-w-0">
          <p className="max-w-[20rem] truncate font-medium text-slate-800">{r.title || "Untitled"}</p>
          <p className="font-num text-xs text-slate-500">#{r.id}{r.tenant_id ? ` · tenant ${r.tenant_id}` : ""}</p>
        </div>
      ),
    },
    {
      key: "detail",
      header: "What went wrong",
      render: (r) => <p className="max-w-[28rem] whitespace-pre-line break-words text-xs text-red-800">{r.detail || "—"}</p>,
    },
    {
      key: "at",
      header: "When",
      sortValue: (r) => r.at ?? "",
      render: (r) => <span className="whitespace-nowrap text-slate-600" title={when(r.at, true)}>{relative(r.at)}</span>,
    },
    {
      key: "retry",
      header: "",
      align: "right",
      render: (r) =>
        r.kind === "live" ? (
          <span className="text-xs text-slate-400">No retry</span>
        ) : canAct ? (
          <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => retry(r)}>
            <RotateCcw size={13} /> {busy === `${r.kind}-${r.id}` ? "Retrying…" : "Retry"}
          </Button>
        ) : null,
    },
  ]

  return (
    <>
      <PageHeader
        title="Failed jobs"
        subtitle="Videos, renders, dubs, publishes, payment events and live streams that stopped with an error"
        actions={
          <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw size={14} /> {isFetching ? "Refreshing…" : "Refresh"}
          </Button>
        }
      />
      <DataTable
        label="Failed jobs"
        rows={rows}
        columns={columns}
        rowKey={(r) => `${r.kind}-${r.id}`}
        loading={isLoading}
        unitLabel="failures"
        initialSort={{ key: "at", dir: "desc" }}
        emptyTitle="Nothing has failed"
        emptyDescription="Failed jobs of every kind show up here, newest first."
        toolbarRight={<Select value={kind} onChange={setKind} options={KIND_FILTER} className="w-44" aria-label="Kind" />}
        note="Each kind shows its 50 most recent failures."
      />
    </>
  )
}
