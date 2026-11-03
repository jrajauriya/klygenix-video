import { useState, type FormEvent } from "react"
import { Link } from "react-router-dom"
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { ChevronDown, ChevronUp, Flag, MessageSquare, Trash2 } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { useConfirm } from "@klygenixvideo/ui"
import { errText, loginPath, useMe, useSignedIn } from "../lib/api"
import { compactNumber, hue, initials, timeAgo } from "../lib/format"
import type { CommentRow } from "../lib/types"
import { Btn, ChannelAvatar, Skel, TEXTAREA } from "./bits"
import type { ReportTarget } from "./ReportDialog"

const PAGE = 20

async function fetchComments(videoId: string, offset: number, parentId?: number) {
  const res = await api.get<CommentRow[]>(`/api/video/videos/${videoId}/comments`, {
    params: { limit: parentId ? 50 : PAGE, offset, ...(parentId ? { parent_id: parentId } : {}) },
  })
  return { rows: res.data, total: Number(res.headers["x-total-count"] ?? res.data.length), offset }
}

function Composer({ videoId, parentId, onDone, autoFocus, placeholder = "Add a comment…" }: { videoId: string; parentId?: number; onDone?: () => void; autoFocus?: boolean; placeholder?: string }) {
  const qc = useQueryClient()
  const [body, setBody] = useState("")
  const [focused, setFocused] = useState(Boolean(autoFocus))
  const [pending, setPending] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const text = body.trim()
    if (!text) return
    setPending(true)
    try {
      const { data } = await api.post<CommentRow>(`/api/video/videos/${videoId}/comments`, { body: text, parent_id: parentId ?? null })
      setBody("")
      setFocused(false)
      if (data.status !== "visible") toast.message("Your comment is held for review because it contains a link.")
      qc.invalidateQueries({ queryKey: ["comments", videoId] })
      onDone?.()
    } catch (err) {
      toast.error(errText(err, "Your comment could not be posted."))
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex-1">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onFocus={() => setFocused(true)}
        placeholder={placeholder}
        aria-label={placeholder}
        rows={focused ? 3 : 1}
        maxLength={2000}
        autoFocus={autoFocus}
        className={`${TEXTAREA} resize-none`}
      />
      {focused && (
        <div className="mt-2 flex justify-end gap-2">
          <Btn tone="ghost" size="sm" onClick={() => { setBody(""); setFocused(false); onDone?.() }}>Cancel</Btn>
          <Btn tone="brand" size="sm" type="submit" disabled={!body.trim() || pending}>{pending ? "Posting…" : parentId ? "Reply" : "Comment"}</Btn>
        </div>
      )}
    </form>
  )
}

function Bubble({ name }: { name: string }) {
  const h = hue(name)
  return (
    <span
      aria-hidden="true"
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
      style={{ background: `linear-gradient(135deg, hsl(${h} 55% 42%), hsl(${(h + 40) % 360} 60% 32%))` }}
    >
      {initials(name)}
    </span>
  )
}

function Replies({ videoId, parentId, onReport }: { videoId: string; parentId: number; onReport: (t: ReportTarget) => void }) {
  const q = useQuery({ queryKey: ["comments", videoId, parentId], queryFn: () => fetchComments(videoId, 0, parentId) })
  if (q.isLoading) return <Skel className="ml-11 h-10 w-2/3" />
  return (
    <div className="space-y-4">
      {(q.data?.rows ?? []).slice().reverse().map((c) => <CommentItem key={c.id} videoId={videoId} comment={c} onReport={onReport} isReply />)}
    </div>
  )
}

function CommentItem({ videoId, comment, onReport, isReply = false }: { videoId: string; comment: CommentRow; onReport: (t: ReportTarget) => void; isReply?: boolean }) {
  const signedIn = useSignedIn()
  const confirm = useConfirm()
  const qc = useQueryClient()
  const [replying, setReplying] = useState(false)
  const [open, setOpen] = useState(false)

  async function remove() {
    const ok = await confirm({ title: "Delete this comment?", message: "This cannot be undone.", confirmLabel: "Delete", variant: "destructive" })
    if (!ok) return
    try {
      await api.delete(`/api/video/comments/${comment.id}`)
      qc.invalidateQueries({ queryKey: ["comments", videoId] })
      toast.success("Comment deleted")
    } catch (err) {
      toast.error(errText(err, "The comment could not be deleted."))
    }
  }

  return (
    <div className="flex gap-3">
      {comment.author_channel ? (
        <Link to={`/@${comment.author_channel.handle}`} aria-label={comment.author_channel.name} className="shrink-0">
          <ChannelAvatar channel={comment.author_channel} size={32} />
        </Link>
      ) : (
        <Bubble name={comment.author} />
      )}
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 text-[13px]">
          {comment.author_channel ? (
            <Link to={`/@${comment.author_channel.handle}`} className="font-semibold text-ink hover:underline">{comment.author}</Link>
          ) : (
            <span className="font-semibold text-ink">{comment.author}</span>
          )}
          {comment.is_creator && (
            <span className="rounded-md bg-brand/25 px-1.5 py-0.5 text-[11px] font-semibold text-brand-soft">Creator</span>
          )}
          <span className="text-faint">{timeAgo(comment.created_at)}</span>
        </p>
        <p className="mt-0.5 whitespace-pre-wrap break-words text-sm leading-relaxed text-ink/90">{comment.body}</p>
        <div className="mt-1 flex items-center gap-1 text-xs text-muted">
          {signedIn && !isReply && (
            <button type="button" onClick={() => setReplying(true)} className="rounded-full px-2 py-1 font-semibold hover:bg-white/10">Reply</button>
          )}
          {comment.mine ? (
            <button type="button" onClick={remove} className="inline-flex items-center gap-1 rounded-full px-2 py-1 hover:bg-white/10" aria-label="Delete comment">
              <Trash2 size={13} /> Delete
            </button>
          ) : (
            <button type="button" onClick={() => onReport({ type: "comment", id: comment.id, label: "comment" })} className="inline-flex items-center gap-1 rounded-full px-2 py-1 hover:bg-white/10" aria-label="Report comment">
              <Flag size={13} /> Report
            </button>
          )}
        </div>
        {replying && (
          <div className="mt-2 flex gap-3">
            <Composer videoId={videoId} parentId={comment.id} autoFocus placeholder="Add a reply…" onDone={() => { setReplying(false); setOpen(true) }} />
          </div>
        )}
        {!isReply && comment.replies > 0 && (
          <button type="button" onClick={() => setOpen(!open)} className="mt-1 inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold text-brand-soft hover:bg-brand/15">
            {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            {comment.replies} {comment.replies === 1 ? "reply" : "replies"}
          </button>
        )}
        {open && (
          <div className="mt-3">
            <Replies videoId={videoId} parentId={comment.id} onReport={onReport} />
          </div>
        )}
      </div>
    </div>
  )
}

export function Comments({ videoId, count, onReport, heading = true }: { videoId: string; count?: number; onReport: (t: ReportTarget) => void; heading?: boolean }) {
  const signedIn = useSignedIn()
  const { data: me } = useMe()
  const q = useInfiniteQuery({
    queryKey: ["comments", videoId],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => fetchComments(videoId, pageParam),
    getNextPageParam: (last) => (last.offset + last.rows.length < last.total ? last.offset + last.rows.length : undefined),
  })
  const rows = q.data?.pages.flatMap((p) => p.rows) ?? []
  const total = q.data?.pages[0]?.total ?? count ?? 0

  return (
    <section aria-label="Comments">
      {heading && (
        <h2 className="mb-4 flex items-center gap-2 text-lg font-bold">
          <MessageSquare size={18} className="text-brand-soft" aria-hidden="true" />
          {compactNumber(total)} {total === 1 ? "comment" : "comments"}
        </h2>
      )}
      <div className="mb-6 flex gap-3">
        {signedIn ? (
          <>
            <Bubble name={me?.profile?.display_name ?? me?.user.name ?? "You"} />
            <Composer videoId={videoId} />
          </>
        ) : (
          <Link to={loginPath()} className="flex w-full items-center rounded-xl border border-line bg-panel-2 px-3 py-2.5 text-sm text-muted hover:border-brand/60">
            Sign in to join the conversation
          </Link>
        )}
      </div>
      {q.isLoading ? (
        <div className="space-y-4">{Array.from({ length: 3 }, (_, i) => <Skel key={i} className="h-12 w-full" />)}</div>
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">No comments yet. Start the conversation.</p>
      ) : (
        <div className="space-y-5">
          {rows.map((c) => <CommentItem key={c.id} videoId={videoId} comment={c} onReport={onReport} />)}
        </div>
      )}
      {q.hasNextPage && (
        <div className="mt-5 flex justify-center">
          <Btn tone="soft" size="sm" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>
            {q.isFetchingNextPage ? "Loading…" : "Show more comments"}
          </Btn>
        </div>
      )}
    </section>
  )
}
