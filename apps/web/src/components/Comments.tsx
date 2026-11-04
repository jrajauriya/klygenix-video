import { useEffect, useState, type FormEvent } from "react"
import { Link } from "react-router-dom"
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { ChevronDown, ChevronUp, Coins, Flag, Languages, MessageSquare, Sparkles, Trash2 } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { cn, useConfirm } from "@klygenixvideo/ui"
import { errText, getJson, loginPath, useMe, useSignedIn } from "../lib/api"
import { compactNumber, hue, initials, langName, rupees, timeAgo } from "../lib/format"
import { TRANSLATE_LANGS, useTranslateLang } from "../lib/prefs"
import type { CommentRow, CommentSummary, Translation } from "../lib/types"
import { Btn, ChannelAvatar, Skel, TEXTAREA } from "./bits"
import type { ReportTarget } from "./ReportDialog"
import { useT } from "../i18n"

const PAGE = 20

async function fetchComments(videoId: string, offset: number, parentId?: number) {
  const res = await api.get<CommentRow[]>(`/api/video/videos/${videoId}/comments`, {
    params: { limit: parentId ? 50 : PAGE, offset, ...(parentId ? { parent_id: parentId } : {}) },
  })
  return { rows: res.data, total: Number(res.headers["x-total-count"] ?? res.data.length), offset }
}

function Composer({ videoId, parentId, onDone, autoFocus, placeholder: hint = "Add a comment…" }: { videoId: string; parentId?: number; onDone?: () => void; autoFocus?: boolean; placeholder?: string }) {
  const t = useT("watch")
  const placeholder = t(hint)
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
      if (data.status !== "visible") toast.message(t("Your comment is held for review because it contains a link."))
      qc.invalidateQueries({ queryKey: ["comments", videoId] })
      onDone?.()
    } catch (err) {
      toast.error(errText(err, t("Your comment could not be posted.")))
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
          <Btn tone="ghost" size="sm" onClick={() => { setBody(""); setFocused(false); onDone?.() }}>{t("Cancel")}</Btn>
          <Btn tone="brand" size="sm" type="submit" disabled={!body.trim() || pending}>{pending ? t("Posting…") : parentId ? t("Reply") : t("Comment")}</Btn>
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

function Replies({ videoId, parentId, onReport, lang }: { videoId: string; parentId: number; onReport: (t: ReportTarget) => void; lang: string }) {
  const q = useQuery({ queryKey: ["comments", videoId, parentId], queryFn: () => fetchComments(videoId, 0, parentId) })
  if (q.isLoading) return <Skel className="ml-11 h-10 w-2/3" />
  return (
    <div className="space-y-4">
      {(q.data?.rows ?? []).slice().reverse().map((c) => <CommentItem key={c.id} videoId={videoId} comment={c} onReport={onReport} lang={lang} isReply />)}
    </div>
  )
}

function CommentItem({ videoId, comment, onReport, lang, isReply = false }: { videoId: string; comment: CommentRow; onReport: (t: ReportTarget) => void; lang: string; isReply?: boolean }) {
  const t = useT("watch")
  const signedIn = useSignedIn()
  const confirm = useConfirm()
  const qc = useQueryClient()
  const [replying, setReplying] = useState(false)
  const [open, setOpen] = useState(false)
  const [translated, setTranslated] = useState<{ lang: string; text: string | null } | null>(null)
  const [translating, setTranslating] = useState(false)

  async function translate() {
    if (translated && translated.lang === lang) {
      setTranslated(null)
      return
    }
    setTranslating(true)
    try {
      const { data } = await api.post<Translation>("/api/video/translate", { kind: "comments", ids: [comment.id], lang })
      const item = data.items.find((x) => x.id === comment.id)
      setTranslated({ lang, text: data.machine_translation && item ? item.text : null })
    } catch (err) {
      toast.error(errText(err, t("This comment could not be translated.")))
    } finally {
      setTranslating(false)
    }
  }

  async function remove() {
    const ok = await confirm({ title: t("Delete this comment?"), message: t("This cannot be undone."), confirmLabel: t("Delete"), cancelLabel: t("Cancel"), variant: "destructive" })
    if (!ok) return
    try {
      await api.delete(`/api/video/comments/${comment.id}`)
      qc.invalidateQueries({ queryKey: ["comments", videoId] })
      toast.success(t("Comment deleted"))
    } catch (err) {
      toast.error(errText(err, t("The comment could not be deleted.")))
    }
  }

  const tip = comment.paid_minor && comment.paid_minor > 0 ? comment.paid_minor : 0

  return (
    <div className={cn("flex gap-3", tip > 0 && "rounded-2xl border border-[#FACC15]/50 bg-[#FACC15]/[0.07] p-3")}>
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
            <span className="rounded-md bg-brand/25 px-1.5 py-0.5 text-[11px] font-semibold text-brand-soft">{t("Creator")}</span>
          )}
          {tip > 0 && (
            <span className="inline-flex items-center gap-1 rounded-md bg-[#FACC15] px-1.5 py-0.5 text-[11px] font-bold text-black">
              <Coins size={11} aria-hidden="true" /> {t("{amount} tip", { amount: rupees(tip) })}
            </span>
          )}
          <span className="text-faint">{timeAgo(comment.created_at)}</span>
        </p>
        <p className="mt-0.5 whitespace-pre-wrap break-words text-sm leading-relaxed text-ink/90">{comment.body}</p>
        {translated && (
          translated.text !== null ? (
            <p className="mt-1 whitespace-pre-wrap break-words border-l-2 border-brand/60 pl-2 text-sm leading-relaxed text-ink/90">
              <span className="block text-[11px] font-semibold text-muted">{t("Translated to {language} by AI", { language: langName(translated.lang) })}</span>
              {translated.text}
            </p>
          ) : (
            <p className="mt-1 text-xs text-muted">{t("Machine translation is off in this environment.")}</p>
          )
        )}
        <div className="mt-1 flex items-center gap-1 text-xs text-muted">
          {signedIn && !isReply && (
            <button type="button" onClick={() => setReplying(true)} className="rounded-full px-2 py-1 font-semibold hover:bg-white/10">{t("Reply")}</button>
          )}
          <button type="button" onClick={translate} disabled={translating} className="inline-flex items-center gap-1 rounded-full px-2 py-1 hover:bg-white/10 disabled:opacity-60">
            <Languages size={13} aria-hidden="true" /> {translating ? t("Translating…") : translated && translated.lang === lang ? t("Hide translation") : t("Translate")}
          </button>
          {comment.mine ? (
            <button type="button" onClick={remove} className="inline-flex items-center gap-1 rounded-full px-2 py-1 hover:bg-white/10" aria-label={t("Delete comment")}>
              <Trash2 size={13} /> {t("Delete")}
            </button>
          ) : (
            <button type="button" onClick={() => onReport({ type: "comment", id: comment.id, label: "comment" })} className="inline-flex items-center gap-1 rounded-full px-2 py-1 hover:bg-white/10" aria-label={t("Report comment")}>
              <Flag size={13} /> {t("Report")}
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
            {t(comment.replies === 1 ? "{n} reply" : "{n} replies", { n: comment.replies })}
          </button>
        )}
        {open && (
          <div className="mt-3">
            <Replies videoId={videoId} parentId={comment.id} onReport={onReport} lang={lang} />
          </div>
        )}
      </div>
    </div>
  )
}

export function Comments({ videoId, count, onReport, heading = true }: { videoId: string; count?: number; onReport: (t: ReportTarget) => void; heading?: boolean }) {
  const t = useT("watch")
  const signedIn = useSignedIn()
  const { data: me } = useMe()
  const [lang, setLang] = useTranslateLang(me?.profile?.language)
  const q = useInfiniteQuery({
    queryKey: ["comments", videoId],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => fetchComments(videoId, pageParam),
    getNextPageParam: (last) => (last.offset + last.rows.length < last.total ? last.offset + last.rows.length : undefined),
  })
  const rows = q.data?.pages.flatMap((p) => p.rows) ?? []
  const total = q.data?.pages[0]?.total ?? count ?? 0

  return (
    <section aria-label={t("Comments")}>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {heading && (
          <h2 className="flex flex-1 items-center gap-2 text-lg font-bold">
            <MessageSquare size={18} className="text-brand-soft" aria-hidden="true" />
            {t(total === 1 ? "{n} comment" : "{n} comments", { n: compactNumber(total) })}
          </h2>
        )}
        <label className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted">
          <Languages size={14} aria-hidden="true" /> {t("Translate to")}
          <select value={lang} onChange={(e) => setLang(e.target.value)} className="h-8 rounded-lg border border-line bg-panel-2 px-2 text-xs text-ink outline-none focus:border-brand">
            {TRANSLATE_LANGS.map((l) => <option key={l} value={l}>{langName(l)}</option>)}
          </select>
        </label>
      </div>
      {heading && <CommentSummaryCard videoId={videoId} lang={lang} />}
      <div className="mb-6 flex gap-3">
        {signedIn ? (
          <>
            <Bubble name={me?.profile?.display_name ?? me?.user.name ?? t("You")} />
            <Composer videoId={videoId} />
          </>
        ) : (
          <Link to={loginPath()} className="flex w-full items-center rounded-xl border border-line bg-panel-2 px-3 py-2.5 text-sm text-muted hover:border-brand/60">
            {t("Sign in to join the conversation")}
          </Link>
        )}
      </div>
      {q.isLoading ? (
        <div className="space-y-4">{Array.from({ length: 3 }, (_, i) => <Skel key={i} className="h-12 w-full" />)}</div>
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">{t("No comments yet. Start the conversation.")}</p>
      ) : (
        <div className="space-y-5">
          {rows.map((c) => <CommentItem key={c.id} videoId={videoId} comment={c} onReport={onReport} lang={lang} />)}
        </div>
      )}
      {q.hasNextPage && (
        <div className="mt-5 flex justify-center">
          <Btn tone="soft" size="sm" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>
            {q.isFetchingNextPage ? t("Loading…") : t("Show more comments")}
          </Btn>
        </div>
      )}
    </section>
  )
}

function CommentSummaryCard({ videoId, lang }: { videoId: string; lang: string }) {
  const t = useT("watch")
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const timer = window.setTimeout(() => setReady(true), 2500)
    return () => window.clearTimeout(timer)
  }, [])
  const q = useQuery({
    queryKey: ["comment-summary", videoId, lang],
    enabled: ready,
    queryFn: () => getJson<CommentSummary>(`/api/video/videos/${videoId}/comments/summary`, { lang }),
    staleTime: 5 * 60_000,
    retry: false,
  })
  const d = q.data
  if (!d || !d.available) return null
  return (
    <section aria-label={t("What people are saying")} className="mb-5 rounded-2xl border border-line bg-panel p-4">
      <h3 className="flex items-center gap-2 text-sm font-bold"><Sparkles size={15} className="text-brand-soft" aria-hidden="true" /> {t("What people are saying")}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-ink/90">{d.summary}</p>
      {d.topics.length > 0 && (
        <ul className="mt-2.5 flex flex-wrap gap-1.5">
          {d.topics.map((topic) => <li key={topic} className="rounded-full bg-white/[0.08] px-2.5 py-0.5 text-xs">{topic}</li>)}
        </ul>
      )}
      {d.quotes.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {d.quotes.slice(0, 3).map((quote) => <li key={quote} className="border-l-2 border-brand/60 pl-2 text-xs italic text-muted">“{quote}”</li>)}
        </ul>
      )}
      <p className="mt-2.5 text-[11px] text-faint">{t("Summarised by AI from {n} comments.", { n: d.count })}</p>
    </section>
  )
}
