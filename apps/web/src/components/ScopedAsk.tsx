import { useState, type FormEvent, type ReactNode } from "react"
import { Link } from "react-router-dom"
import { toast } from "sonner"
import { ArrowUp, Crown, Loader2, MessageCircleQuestion } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { errStatus, errText, loginPath, useSignedIn } from "../lib/api"
import type { ScopedAnswer, ScopedCitation } from "../lib/types"

const MARK = /\[v:([A-Za-z0-9_-]+) (\d{1,2}:\d{2}(?::\d{2})?)\]/g

function watchAt(c: Pick<ScopedCitation, "video_id" | "start_ms">): string {
  return `/watch/${c.video_id}?t=${Math.max(0, Math.round(c.start_ms))}`
}

function stampMs(label: string): number {
  return label.split(":").map(Number).reduce((acc, n) => acc * 60 + n, 0) * 1000
}

function Chip({ to, label, title }: { to: string; label: string; title?: string }) {
  return (
    <Link to={to} title={title} className="mx-0.5 inline-flex items-center rounded-md bg-brand/25 px-1.5 py-0.5 align-baseline text-xs font-semibold tabular-nums text-brand-soft ring-1 ring-brand/40 hover:bg-brand/40">
      {label}
    </Link>
  )
}

function AnswerText({ msg }: { msg: ScopedAnswer }) {
  const cites = msg.citations ?? []
  return (
    <div className="space-y-1.5 text-sm leading-relaxed text-ink/90">
      {(msg.answer ?? "").split("\n").map((line, i) => {
        const out: ReactNode[] = []
        let at = 0
        for (const m of line.matchAll(MARK)) {
          const idx = m.index ?? 0
          if (idx > at) out.push(line.slice(at, idx))
          const cite = cites.find((c) => c.video_id === m[1] && c.label === m[2])
          out.push(<Chip key={`${i}-${idx}`} to={watchAt(cite ?? { video_id: m[1], start_ms: stampMs(m[2]) })} label={m[2]} title={cite?.title} />)
          at = idx + m[0].length
        }
        out.push(line.slice(at))
        return <p key={i}>{out}</p>
      })}
      {cites.length > 0 && (
        <ul className="mt-2 space-y-1.5 border-t border-line pt-2">
          {cites.map((c, i) => (
            <li key={`${c.video_id}-${c.start_ms}-${i}`}>
              <Link to={watchAt(c)} className="block rounded-lg px-2 py-1.5 hover:bg-white/5">
                <span className="flex items-center gap-2 text-xs font-semibold">
                  <span className="tabular-nums text-brand-soft">{c.label}</span>
                  <span className="truncate">{c.title}</span>
                </span>
                <span className="line-clamp-2 text-xs text-muted">{c.text}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function ScopedAsk({ endpoint, title, blurb }: { endpoint: string; title: string; blurb: string }) {
  const signedIn = useSignedIn()
  const [question, setQuestion] = useState("")
  const [pending, setPending] = useState<string | null>(null)
  const [answers, setAnswers] = useState<ScopedAnswer[]>([])
  const [upsell, setUpsell] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const text = question.trim()
    if (text.length < 2 || pending) return
    setPending(text)
    setQuestion("")
    setUpsell(null)
    try {
      const { data } = await api.post<ScopedAnswer>(endpoint, { question: text })
      setAnswers((a) => [...a, data])
    } catch (err) {
      if (errStatus(err) === 402) setUpsell(errText(err, "You have used today's questions."))
      else toast.error(errText(err, "That question could not be answered right now."))
      setQuestion(text)
    } finally {
      setPending(null)
    }
  }

  const last = answers[answers.length - 1]
  const left = last?.quota && last.quota.limit !== null ? Math.max(0, last.quota.limit - last.quota.used) : null

  return (
    <section aria-label={title} className="rounded-2xl border border-line bg-panel p-4 sm:p-5">
      <h2 className="flex items-center gap-2 text-base font-bold"><MessageCircleQuestion size={18} className="text-brand-soft" aria-hidden="true" /> {title}</h2>
      <p className="mt-1 text-sm text-muted">{blurb}</p>
      {!signedIn ? (
        <Link to={loginPath()} className="mt-4 inline-flex rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover">Sign in to ask</Link>
      ) : (
        <>
          {(answers.length > 0 || pending || upsell) && (
            <div className="mt-4 space-y-4">
              {answers.map((m) => (
                <div key={m.id} className="space-y-2">
                  <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-brand px-3 py-2 text-sm text-white">{m.question}</div>
                  <div className="rounded-2xl rounded-bl-md bg-panel-2 px-3 py-2.5">
                    <AnswerText msg={m} />
                    {m.status === "declined" && <p className="mt-1 text-xs text-muted">Searched {m.videos} {m.videos === 1 ? "video" : "videos"}.</p>}
                  </div>
                </div>
              ))}
              {pending && (
                <div className="space-y-2">
                  <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-brand px-3 py-2 text-sm text-white">{pending}</div>
                  <div className="inline-flex items-center gap-2 rounded-2xl rounded-bl-md bg-panel-2 px-3 py-2.5 text-sm text-muted">
                    <Loader2 size={14} className="animate-spin" aria-hidden="true" /> Looking through the videos…
                  </div>
                </div>
              )}
              {upsell && (
                <div className="rounded-2xl border border-brand/50 bg-gradient-to-br from-brand/25 to-transparent p-4">
                  <p className="flex items-center gap-2 text-sm font-semibold"><Crown size={16} className="text-brand-soft" aria-hidden="true" /> {upsell}</p>
                  <Link to="/plans" className="mt-3 inline-flex rounded-full bg-brand px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-hover">See Viewer Premium</Link>
                </div>
              )}
            </div>
          )}
          <form onSubmit={submit} className="mt-4">
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
                placeholder="Ask a question"
                aria-label={title}
                className="max-h-28 min-h-9 flex-1 resize-none bg-transparent px-2 py-2 text-sm text-ink placeholder:text-faint outline-none"
              />
              <button type="submit" disabled={question.trim().length < 2 || !!pending} aria-label="Ask" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand text-white hover:bg-brand-hover disabled:opacity-40">
                <ArrowUp size={17} aria-hidden="true" />
              </button>
            </div>
            {left !== null && <p className="mt-1.5 text-[11px] text-faint">{left} of {last?.quota?.limit} questions left today</p>}
          </form>
        </>
      )}
    </section>
  )
}
