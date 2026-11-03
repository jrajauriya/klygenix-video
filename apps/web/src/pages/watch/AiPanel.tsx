import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react"
import { Link } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { ArrowUp, Crown, ListOrdered, Loader2, MessageCircleQuestion, ScrollText, Sparkles } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { cn } from "@klygenixvideo/ui"
import { TranscriptPanel, activeChapter } from "@klygenixvideo/player"
import { errStatus, errText, getJson, loginPath, useSignedIn } from "../../lib/api"
import { clock } from "../../lib/format"
import type { AskMessage, Citation, Quota, Segment, VideoDetail } from "../../lib/types"
import { Skel } from "../../components/bits"

type Tab = "summary" | "chapters" | "transcript" | "ask"

export function AiPanel({ video, currentMs, onSeek, className }: { video: VideoDetail; currentMs: number; onSeek: (ms: number) => void; className?: string }) {
  const [tab, setTab] = useState<Tab>("summary")
  const ready = video.ai_status === "ready"
  const insight = video.insight
  const tabs: { key: Tab; label: string; icon: ReactNode }[] = [
    { key: "summary", label: "Summary", icon: <Sparkles size={15} /> },
    { key: "chapters", label: "Chapters", icon: <ListOrdered size={15} /> },
    { key: "transcript", label: "Transcript", icon: <ScrollText size={15} /> },
    { key: "ask", label: "Ask", icon: <MessageCircleQuestion size={15} /> },
  ]

  return (
    <section aria-label="AI notes" className={cn("flex flex-col overflow-hidden rounded-2xl border border-line bg-panel", className)}>
      <div role="tablist" className="flex shrink-0 gap-1 overflow-x-auto border-b border-line p-1.5 scrollbar-none">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "inline-flex h-8 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-[13px] font-semibold transition-colors",
              tab === t.key ? "bg-brand/25 text-white" : "text-muted hover:bg-white/5 hover:text-ink",
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 p-3">
        {!ready && tab !== "transcript" ? (
          <NotReady status={video.ai_status} />
        ) : tab === "summary" ? (
          <div className="h-full overflow-y-auto pr-1" tabIndex={0}>
            {insight?.summary ? (
              <>
                <p className="text-sm leading-relaxed text-ink/90">{insight.summary}</p>
                {insight.key_points?.length > 0 && (
                  <>
                    <h3 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-muted">Key points</h3>
                    <ul className="space-y-2">
                      {insight.key_points.map((p, i) => (
                        <li key={i} className="flex gap-2 text-sm leading-relaxed text-ink/85">
                          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-soft" />
                          {p}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                <p className="mt-4 text-[11px] text-faint">Written by AI from the video's transcript. It can make mistakes.</p>
              </>
            ) : (
              <p className="py-6 text-center text-sm text-muted">No summary for this video.</p>
            )}
          </div>
        ) : tab === "chapters" ? (
          <Chapters video={video} currentMs={currentMs} onSeek={onSeek} />
        ) : tab === "transcript" ? (
          <Transcript videoId={video.id} currentMs={currentMs} onSeek={onSeek} />
        ) : (
          <Ask videoId={video.id} onSeek={onSeek} />
        )}
      </div>
    </section>
  )
}

function NotReady({ status }: { status: string }) {
  const working = ["pending", "queued", "processing", "running"].includes(status)
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 py-8 text-center">
      {working ? <Loader2 size={22} className="animate-spin text-brand-soft" /> : <Sparkles size={22} className="text-faint" />}
      <p className="text-sm font-semibold">{working ? "AI notes are being prepared" : "AI notes are not available"}</p>
      <p className="max-w-xs text-xs text-muted">{working ? "Summary, chapters and Ask appear here once the video has been transcribed." : "This video does not have a transcript to work from."}</p>
    </div>
  )
}

function Chapters({ video, currentMs, onSeek }: { video: VideoDetail; currentMs: number; onSeek: (ms: number) => void }) {
  const chapters = video.insight?.chapters ?? []
  const current = activeChapter(chapters, currentMs)
  if (!chapters.length) return <p className="py-6 text-center text-sm text-muted">No chapters for this video.</p>
  return (
    <ol className="h-full space-y-1 overflow-y-auto pr-1">
      {chapters.map((c, i) => {
        const on = current?.start_ms === c.start_ms
        return (
          <li key={c.start_ms}>
            <button
              type="button"
              onClick={() => onSeek(c.start_ms)}
              className={cn("flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors", on ? "bg-brand/20" : "hover:bg-white/5")}
            >
              <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold", on ? "bg-brand text-white" : "bg-white/10 text-muted")}>{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{c.title}</span>
                <span className="block text-xs tabular-nums text-brand-soft">{clock(c.start_ms)}</span>
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}

function Transcript({ videoId, currentMs, onSeek }: { videoId: string; currentMs: number; onSeek: (ms: number) => void }) {
  const q = useQuery({
    queryKey: ["transcript", videoId],
    queryFn: () => getJson<{ segments: Segment[] }>(`/api/video/videos/${videoId}/transcript`),
  })
  if (q.isLoading) return <div className="space-y-2">{Array.from({ length: 6 }, (_, i) => <Skel key={i} className="h-8 w-full" />)}</div>
  return <TranscriptPanel className="h-full" segments={q.data?.segments ?? []} currentMs={currentMs} onSeek={onSeek} emptyText="No transcript for this video yet." />
}

const STAMP = /\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g

function stampMs(label: string): number {
  const parts = label.split(":").map(Number)
  return parts.reduce((acc, n) => acc * 60 + n, 0) * 1000
}

function Chip({ label, onClick, title }: { label: string; onClick: () => void; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="mx-0.5 inline-flex items-center rounded-md bg-brand/25 px-1.5 py-0.5 align-baseline text-xs font-semibold tabular-nums text-brand-soft ring-1 ring-brand/40 hover:bg-brand/40"
    >
      {label}
    </button>
  )
}

function Answer({ msg, onSeek }: { msg: AskMessage; onSeek: (ms: number) => void }) {
  const byLabel = new Map<string, Citation>((msg.citations ?? []).map((c) => [c.label, c]))
  const lines = (msg.answer ?? "").split("\n")
  return (
    <div className="space-y-1.5 text-sm leading-relaxed text-ink/90">
      {lines.map((line, i) => {
        const out: ReactNode[] = []
        let at = 0
        for (const m of line.matchAll(STAMP)) {
          const idx = m.index ?? 0
          if (idx > at) out.push(line.slice(at, idx))
          const label = m[1]
          const cite = byLabel.get(label)
          out.push(<Chip key={`${i}-${idx}`} label={label} title={cite?.text} onClick={() => onSeek(cite?.start_ms ?? stampMs(label))} />)
          at = idx + m[0].length
        }
        out.push(line.slice(at))
        return <p key={i}>{out}</p>
      })}
      {msg.status === "declined" && <p className="text-xs text-muted">The video does not seem to cover that.</p>}
      {(msg.citations?.length ?? 0) > 0 && (
        <div className="flex flex-wrap items-center gap-1 pt-1 text-xs text-muted">
          Sources:
          {msg.citations.map((c) => <Chip key={c.start_ms} label={c.label} title={c.text} onClick={() => onSeek(c.start_ms)} />)}
        </div>
      )}
    </div>
  )
}

function Ask({ videoId, onSeek }: { videoId: string; onSeek: (ms: number) => void }) {
  const signedIn = useSignedIn()
  const qc = useQueryClient()
  const [question, setQuestion] = useState("")
  const [pending, setPending] = useState<string | null>(null)
  const [upsell, setUpsell] = useState(false)
  const list = useRef<HTMLDivElement>(null)
  const q = useQuery({
    queryKey: ["ask", videoId],
    enabled: signedIn,
    queryFn: () => getJson<{ messages: AskMessage[]; quota: Quota }>(`/api/video/videos/${videoId}/ask`),
  })
  const messages = q.data?.messages ?? []
  const quota = q.data?.quota
  const left = quota && quota.limit !== null ? Math.max(0, quota.limit - quota.used) : null

  useEffect(() => {
    const box = list.current
    if (box) box.scrollTop = box.scrollHeight
  }, [messages.length, pending, upsell])

  async function submit(e: FormEvent) {
    e.preventDefault()
    const text = question.trim()
    if (text.length < 2 || pending) return
    setPending(text)
    setQuestion("")
    try {
      const { data } = await api.post<AskMessage & { quota: Quota }>(`/api/video/videos/${videoId}/ask`, { question: text })
      qc.setQueryData(["ask", videoId], (old: { messages: AskMessage[]; quota: Quota } | undefined) => ({
        messages: [...(old?.messages ?? []), data],
        quota: data.quota,
      }))
      qc.invalidateQueries({ queryKey: ["me"] })
    } catch (err) {
      const status = errStatus(err)
      if (status === 402) setUpsell(true)
      else toast.error(errText(err, "That question could not be answered right now."))
      setQuestion(text)
    } finally {
      setPending(null)
    }
  }

  if (!signedIn) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 py-8 text-center">
        <MessageCircleQuestion size={26} className="text-brand-soft" />
        <p className="text-sm font-semibold">Ask this video anything</p>
        <p className="max-w-xs text-xs text-muted">Get answers with timestamps you can jump to. Free accounts get a few questions a day.</p>
        <Link to={loginPath()} className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover">Sign in to ask</Link>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-[300px] flex-col">
      <div ref={list} className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1" tabIndex={0}>
        {q.isLoading && <Skel className="h-16 w-full" />}
        {!q.isLoading && messages.length === 0 && !pending && (
          <div className="py-4 text-center">
            <p className="text-sm font-semibold">Ask about anything said in this video</p>
            <p className="mt-1 text-xs text-muted">Answers cite the moments they come from. Tap a time to jump there.</p>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className="space-y-2">
            <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-brand px-3 py-2 text-sm text-white">{m.question}</div>
            <div className="max-w-[95%] rounded-2xl rounded-bl-md bg-panel-2 px-3 py-2.5"><Answer msg={m} onSeek={onSeek} /></div>
          </div>
        ))}
        {pending && (
          <div className="space-y-2">
            <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-brand px-3 py-2 text-sm text-white">{pending}</div>
            <div className="inline-flex items-center gap-2 rounded-2xl rounded-bl-md bg-panel-2 px-3 py-2.5 text-sm text-muted">
              <Loader2 size={14} className="animate-spin" /> Looking through the video…
            </div>
          </div>
        )}
        {upsell && (
          <div className="rounded-2xl border border-brand/50 bg-gradient-to-br from-brand/25 to-transparent p-4">
            <p className="flex items-center gap-2 text-sm font-semibold"><Crown size={16} className="text-brand-soft" /> You have used today's questions</p>
            <p className="mt-1 text-xs text-muted">Viewer Premium lifts the daily limit and unlocks every subtitle language.</p>
            <Link to="/plans" className="mt-3 inline-flex rounded-full bg-brand px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-hover">See Viewer Premium</Link>
          </div>
        )}
      </div>
      <form onSubmit={submit} className="mt-3 shrink-0">
        <div className="flex items-end gap-2 rounded-2xl border border-line bg-panel-2 p-1.5 focus-within:border-brand">
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value.slice(0, 500))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                e.currentTarget.form?.requestSubmit()
              }
            }}
            rows={1}
            placeholder="Ask a question about this video"
            aria-label="Question"
            className="max-h-28 min-h-9 flex-1 resize-none bg-transparent px-2 py-2 text-sm text-ink placeholder:text-faint outline-none"
          />
          <button type="submit" disabled={question.trim().length < 2 || !!pending} aria-label="Ask" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand text-white hover:bg-brand-hover disabled:opacity-40">
            <ArrowUp size={17} />
          </button>
        </div>
        {quota && (
          <p className="mt-1.5 text-[11px] text-faint">
            {left === null ? "Unlimited questions" : `${left} of ${quota.limit} questions left today`}
            {left !== null && left <= 2 && <> · <Link to="/plans" className="text-brand-soft hover:underline">Get more</Link></>}
          </p>
        )}
      </form>
    </div>
  )
}
