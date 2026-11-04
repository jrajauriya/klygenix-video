import { useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Eye, EyeOff, Flag, IndianRupee, ShieldCheck, Trash2, Zap } from "lucide-react"
import { formatMoney } from "@klygenixvideo/client"
import { api } from "@klygenixvideo/auth"
import { Badge, Button, Card, EmptyState, PageHeader, Pager, Select, Spinner, Tabs } from "@klygenixvideo/ui"
import { STUDIO } from "../lib/hooks"
import { clock, detail, when } from "../lib/format"
import type { InboxItem, StudioVideo } from "../lib/types"
import { useRemover } from "../components/video/CommentsPanel"
import { ModeratorsDrawer } from "../components/Moderators"
import { useT } from "../i18n"

const PAGE = 25

const KINDS = [
  { key: "comments", label: "Comments" },
  { key: "danmaku", label: "Danmaku" },
]

const STATUSES = [
  { value: "", label: "Visible and hidden" },
  { value: "visible", label: "Visible" },
  { value: "hidden", label: "Hidden" },
]

export default function Comments() {
  const t = useT()
  const [params, setParams] = useSearchParams()
  const kind = params.get("kind") === "danmaku" ? "danmaku" : "comments"
  const status = ["visible", "hidden"].includes(params.get("status") ?? "") ? params.get("status")! : ""
  const videoId = params.get("video") ?? ""
  const page = Math.max(1, Number(params.get("page")) || 1)
  const remove = useRemover()
  const qc = useQueryClient()
  const [switching, setSwitching] = useState<string | null>(null)
  const [mods, setMods] = useState(false)

  async function toggle(r: InboxItem) {
    const next = r.status === "hidden" ? "visible" : "hidden"
    setSwitching(`${r.kind}-${r.id}`)
    try {
      await api.patch(`${STUDIO}/comments/${r.id}`, { status: next, kind: r.kind })
      toast.success(next === "hidden" ? t("Hidden from viewers") : t("Visible to viewers again"))
      await qc.invalidateQueries({ queryKey: ["studio-inbox"] })
      qc.invalidateQueries({ queryKey: [r.kind === "comment" ? "video-comments" : "video-danmaku"] })
    } catch (err) {
      toast.error(detail(err, t("Could not change it")))
    } finally {
      setSwitching(null)
    }
  }

  function set(next: Record<string, string>) {
    const merged: Record<string, string> = { kind, status, video: videoId, page: "1", ...next }
    setParams(Object.fromEntries(Object.entries(merged).filter(([k, v]) => v && !(k === "page" && v === "1") && !(k === "kind" && v === "comments"))), { replace: true })
  }

  const { data: videos } = useQuery({
    queryKey: ["studio-videos", "comment-filter"],
    queryFn: async () => (await api.get<StudioVideo[]>(`${STUDIO}/videos?limit=100`)).data,
  })
  const { data, isLoading } = useQuery({
    queryKey: ["studio-inbox", kind, status, videoId, page],
    queryFn: async () => {
      const res = await api.get<InboxItem[]>(`${STUDIO}/comments`, {
        params: { kind, status: status || undefined, video_id: videoId || undefined, limit: PAGE, offset: (page - 1) * PAGE },
      })
      return { rows: res.data, total: Number(res.headers["x-total-count"] ?? res.data.length) }
    },
    placeholderData: (prev) => prev,
  })
  const rows = data?.rows ?? []
  const total = data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE))
  const videoOptions = [
    { value: "", label: t("All videos") },
    ...(videos ?? []).map((v) => ({ value: String(v.id), label: v.title, hint: t("{comments} comments · {danmaku} danmaku", { comments: v.comments, danmaku: v.danmaku }) })),
  ]

  return (
    <div className="pb-8">
      <PageHeader
        title={t("Comments & danmaku")}
        subtitle={t("Everything viewers post on your videos, newest first.")}
        actions={<Button size="sm" variant="outline" onClick={() => setMods(true)}><ShieldCheck size={14} /> {t("Moderators")}</Button>}
      />
      {mods && <ModeratorsDrawer onClose={() => setMods(false)} />}
      <Tabs tabs={KINDS.map((x) => ({ ...x, label: t(x.label) }))} active={kind} onChange={(k) => set({ kind: k })} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select value={videoId} onChange={(v) => set({ video: v })} options={videoOptions} className="w-72" aria-label={t("Video")} />
        <Select value={status} onChange={(v) => set({ status: v })} options={STATUSES.map((o) => ({ ...o, label: t(o.label) }))} className="w-48" aria-label={t("Status")} />
        <span className="ml-auto text-sm text-slate-500">{data ? (kind === "danmaku" ? t("{n} danmaku", { n: total }) : total === 1 ? t("1 comment") : t("{n} comments", { n: total })) : ""}</span>
      </div>
      <Card className="p-0">
        {isLoading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <EmptyState
            title={kind === "danmaku" ? t("No danmaku here") : t("No comments here")}
            hint={status || videoId ? t("Try another video or status.") : t("What viewers post on your videos appears here.")}
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((r) => (
              <li key={`${r.kind}-${r.id}`} className="flex items-start gap-3 px-4 py-3">
                {r.kind === "danmaku" && (
                  <span className="mt-0.5 h-3 w-3 shrink-0 rounded-full border border-slate-300" style={{ background: r.color }} title={r.color} />
                )}
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-slate-500">
                    <span className="font-semibold text-slate-700">{r.author || t("Viewer")}</span>
                    <span>·</span>
                    <span>{when(r.created_at, true)}</span>
                    <span>·</span>
                    <Link to={`/videos/${r.video_id}?tab=comments`} className="max-w-[18rem] truncate font-medium text-brand hover:underline">{r.video_title}</Link>
                    {r.kind === "danmaku" && r.t_ms !== undefined && <span className="font-num text-brand">{t("at {time}", { time: clock(r.t_ms) })}</span>}
                    {r.kind === "comment" && r.parent_id && <Badge color="slate">{t("Reply")}</Badge>}
                    {r.kind === "comment" && r.paid_minor ? (
                      <Badge color="green"><IndianRupee size={11} aria-hidden="true" />{t("Tip {amount}", { amount: formatMoney(r.paid_minor, "INR") })}</Badge>
                    ) : null}
                    {r.kind === "danmaku" && (r.boost_tier || r.paid_minor) ? (
                      <Badge color="purple">
                        <Zap size={11} aria-hidden="true" />{r.boost_tier ? t("Boost tier {tier}", { tier: r.boost_tier }) : t("Boost")}{r.paid_minor ? ` · ${formatMoney(r.paid_minor, "INR")}` : ""}
                      </Badge>
                    ) : null}
                    {r.status === "hidden" && <Badge color="amber">{t("Hidden")}</Badge>}
                    {r.report_count > 0 && (
                      <Badge color="red"><Flag size={11} className="mr-0.5 inline" aria-hidden="true" />{r.report_count === 1 ? t("1 report") : t("{n} reports", { n: r.report_count })}</Badge>
                    )}
                  </p>
                  <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-slate-800">{r.body}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button size="sm" variant="outline" disabled={switching === `${r.kind}-${r.id}`} onClick={() => toggle(r)}
                    aria-label={r.status === "hidden" ? (r.kind === "danmaku" ? t("Unhide danmaku") : t("Unhide comment")) : (r.kind === "danmaku" ? t("Hide danmaku") : t("Hide comment"))}>
                    {r.status === "hidden" ? <Eye size={13} /> : <EyeOff size={13} />}
                    <span className="hidden sm:inline">{r.status === "hidden" ? t("Unhide") : t("Hide")}</span>
                  </Button>
                  <Button size="icon" variant="ghost" aria-label={r.kind === "danmaku" ? t("Delete danmaku") : t("Delete comment")} onClick={() => remove(r.kind, r.id, r.body)}>
                    <Trash2 size={15} />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {total > PAGE && (
          <div className="border-t border-slate-100 px-4 py-2">
            <Pager page={page} totalPages={pages} onChange={(p) => set({ page: String(p) })} />
          </div>
        )}
      </Card>
      {status === "hidden" && (
        <p className="mt-2 text-xs text-slate-500">{t("Comments with links and anything reported three times are hidden from viewers automatically.")}</p>
      )}
    </div>
  )
}
