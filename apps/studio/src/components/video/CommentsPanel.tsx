import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { ChevronDown, ChevronRight, Trash2 } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { Badge, Button, Card, Pager, Select, Spinner, useConfirm } from "@klygenixvideo/ui"
import { formatMoney } from "@klygenixvideo/client"
import { clock, detail, when } from "../../lib/format"
import { useHasPermission } from "../../lib/team"
import { ViewOnly } from "../team/ViewOnly"
import type { Comment, Danmaku } from "../../lib/types"
import { useT } from "../../i18n"

const WINDOW_MS = 120_000
const PAGE = 20

export function useRemover() {
  const t = useT()
  const confirm = useConfirm()
  const qc = useQueryClient()
  return async (kind: "comment" | "danmaku", id: number, text: string) => {
    const ok = await confirm({
      title: kind === "comment" ? t("Delete this comment?") : t("Delete this danmaku?"),
      message: t("“{text}” is removed for everyone.", { text: text.slice(0, 140) }),
      confirmLabel: t("Delete"),
      variant: "destructive",
    })
    if (!ok) return
    try {
      await api.delete(kind === "comment" ? `/api/video/comments/${id}` : `/api/video/danmaku/${id}`)
      toast.success(t("Deleted"))
      qc.invalidateQueries({ queryKey: [kind === "comment" ? "video-comments" : "video-danmaku"] })
      qc.invalidateQueries({ queryKey: ["studio-inbox"] })
    } catch (err) {
      toast.error(detail(err, t("Could not delete it")))
    }
  }
}

export function CommentsPanel({ publicId, durationMs }: { publicId: string; durationMs: number }) {
  const t = useT()
  const canModerate = useHasPermission("video.comments", "full")
  return (
    <div className="grid gap-5 xl:grid-cols-2 [&>*]:min-w-0">
      {!canModerate && <ViewOnly className="xl:col-span-2" what={t("Your role can read comments and danmaku but not remove them.")} />}
      <Comments publicId={publicId} />
      <DanmakuList publicId={publicId} durationMs={durationMs} />
    </div>
  )
}

function Comments({ publicId }: { publicId: string }) {
  const t = useT()
  const [page, setPage] = useState(1)
  const { data, isLoading } = useQuery({
    queryKey: ["video-comments", publicId, page],
    queryFn: async () => {
      const res = await api.get<Comment[]>(`/api/video/videos/${publicId}/comments?limit=${PAGE}&offset=${(page - 1) * PAGE}`)
      return { rows: res.data, total: Number(res.headers["x-total-count"] ?? res.data.length) }
    },
    placeholderData: (prev) => prev,
  })

  return (
    <Card className="p-0">
      <div className="border-b border-slate-100 px-4 py-3">
        <h3 className="text-sm font-bold text-navy">{t("Comments")}</h3>
        <p className="text-xs text-slate-500">{data ? (data.total === 1 ? t("1 top-level comment") : t("{n} top-level comments", { n: data.total })) : t("Loading…")}</p>
      </div>
      {isLoading ? (
        <Spinner />
      ) : !data?.rows.length ? (
        <p className="px-4 py-6 text-sm text-slate-500">{t("No comments yet.")}</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {data.rows.map((c) => <CommentRow key={c.id} comment={c} publicId={publicId} />)}
        </ul>
      )}
      {data && data.total > PAGE && (
        <div className="border-t border-slate-100 px-4 py-2">
          <Pager page={page} totalPages={Math.ceil(data.total / PAGE)} onChange={setPage} />
        </div>
      )}
    </Card>
  )
}

function CommentRow({ comment, publicId, reply = false }: { comment: Comment; publicId: string; reply?: boolean }) {
  const t = useT()
  const remove = useRemover()
  const canModerate = useHasPermission("video.comments", "full")
  const [open, setOpen] = useState(false)
  const { data: replies } = useQuery({
    queryKey: ["video-comments", publicId, "replies", comment.id],
    queryFn: async () => (await api.get<Comment[]>(`/api/video/videos/${publicId}/comments?parent_id=${comment.id}&limit=100`)).data,
    enabled: open,
  })

  return (
    <li className={reply ? "py-2 pl-6" : "px-4 py-3"}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-slate-500">
            <span className="font-semibold text-slate-700">{comment.author}</span> · {when(comment.created_at, true)}
            {comment.paid_minor ? <Badge color="green" className="ml-1.5">{t("Tip {amount}", { amount: formatMoney(comment.paid_minor, "INR") })}</Badge> : null}
          </p>
          <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-slate-800">{comment.body}</p>
          {!reply && comment.replies > 0 && (
            <button type="button" onClick={() => setOpen((o) => !o)} className="mt-1 inline-flex items-center gap-0.5 text-xs font-semibold text-brand">
              {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />} {comment.replies === 1 ? t("1 reply") : t("{n} replies", { n: comment.replies })}
            </button>
          )}
        </div>
        {canModerate && (
          <Button size="icon" variant="ghost" aria-label={t("Delete comment")} onClick={() => remove("comment", comment.id, comment.body)}>
            <Trash2 size={15} />
          </Button>
        )}
      </div>
      {open && replies && (
        <ul className="mt-1 divide-y divide-slate-100 border-l-2 border-slate-100">
          {replies.map((r) => <CommentRow key={r.id} comment={r} publicId={publicId} reply />)}
        </ul>
      )}
    </li>
  )
}

function DanmakuList({ publicId, durationMs }: { publicId: string; durationMs: number }) {
  const t = useT()
  const remove = useRemover()
  const canModerate = useHasPermission("video.comments", "full")
  const windows = Math.max(1, Math.ceil((durationMs || WINDOW_MS) / WINDOW_MS))
  const [win, setWin] = useState("0")
  const from = Number(win) * WINDOW_MS
  const to = Math.min(from + WINDOW_MS, Math.max(durationMs, from + 1000) + 1000)
  const { data, isLoading } = useQuery({
    queryKey: ["video-danmaku", publicId, from],
    queryFn: async () => (await api.get<Danmaku[]>(`/api/video/videos/${publicId}/danmaku?from_ms=${from}&to_ms=${to}`)).data,
  })
  const options = Array.from({ length: windows }, (_, i) => ({
    value: String(i),
    label: `${clock(i * WINDOW_MS)} – ${clock(Math.min((i + 1) * WINDOW_MS, durationMs || (i + 1) * WINDOW_MS))}`,
  }))

  return (
    <Card className="p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div>
          <h3 className="text-sm font-bold text-navy">{t("Danmaku")}</h3>
          <p className="text-xs text-slate-500">{t("Comments that fly over the video at a moment")}</p>
        </div>
        {windows > 1 && <Select value={win} onChange={setWin} options={options} className="w-44" />}
      </div>
      {isLoading ? (
        <Spinner />
      ) : !data?.length ? (
        <p className="px-4 py-6 text-sm text-slate-500">{t("No danmaku in this part of the video.")}</p>
      ) : (
        <ul className="max-h-[60vh] divide-y divide-slate-100 overflow-y-auto">
          {data.map((d) => (
            <li key={d.id} className="flex items-center gap-3 px-4 py-2">
              <span className="w-12 shrink-0 font-num text-xs text-brand">{clock(d.t_ms)}</span>
              <span className="h-3 w-3 shrink-0 rounded-full border border-slate-300" style={{ background: d.color }} title={d.color} />
              <span className="min-w-0 flex-1 truncate text-sm text-slate-800">{d.text}</span>
              {d.boost_tier || d.paid_minor ? (
                <Badge color="purple">{d.paid_minor ? t("Boost {amount}", { amount: formatMoney(d.paid_minor, "INR") }) : t("Boost")}</Badge>
              ) : null}
              {d.mode !== "scroll" && <span className="text-xs text-slate-500">{d.mode}</span>}
              {canModerate && (
                <Button size="icon" variant="ghost" aria-label={t("Delete danmaku")} onClick={() => remove("danmaku", d.id, d.text)}>
                  <Trash2 size={15} />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
