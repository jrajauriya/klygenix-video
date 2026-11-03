import { useState, type FormEvent } from "react"
import { Link } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Check, ChevronLeft, ChevronRight, GraduationCap, Loader2, Lock, RotateCcw, Trash2, X } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { cn } from "@klygenixvideo/ui"
import { errStatus, errText, getJson, loginPath, useSignedIn } from "../../lib/api"
import { clock, timeAgo } from "../../lib/format"
import type { Flashcard, PersonalNote, QuizAttempt, QuizItem, QuizResult, StudyNote, StudySet } from "../../lib/types"
import { Btn, Skel, TEXTAREA } from "../../components/bits"

type Kind = "notes" | "flashcards" | "quiz" | "mine"

const KINDS: { key: Kind; label: string }[] = [
  { key: "notes", label: "Notes" },
  { key: "flashcards", label: "Flashcards" },
  { key: "quiz", label: "Quiz" },
  { key: "mine", label: "My notes" },
]

export function Stamp({ label, ms, onSeek, className }: { label: string; ms: number; onSeek: (ms: number) => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={() => onSeek(ms)}
      className={cn("inline-flex items-center rounded-md bg-brand/25 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-brand-soft ring-1 ring-brand/40 hover:bg-brand/40", className)}
    >
      {label}
    </button>
  )
}

function useStudy<T>(videoId: string, kind: "notes" | "flashcards" | "quiz") {
  return useQuery({
    queryKey: ["study", videoId, kind],
    queryFn: () => getJson<StudySet<T>>(`/api/video/videos/${videoId}/study/${kind}`),
    retry: (n, err) => (errStatus(err) ?? 500) >= 500 && n < 1,
    staleTime: 5 * 60_000,
  })
}

function Problem({ error, what }: { error: unknown; what: string }) {
  const status = errStatus(error)
  if (status === 401) {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <GraduationCap size={26} className="text-brand-soft" aria-hidden="true" />
        <p className="text-sm font-semibold">Sign in to make study {what}</p>
        <p className="max-w-xs text-xs text-muted">The first person to ask creates them from the transcript. After that they load for everyone.</p>
        <Link to={loginPath()} className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover">Sign in</Link>
      </div>
    )
  }
  if (status === 402) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center">
        <Lock size={22} className="text-brand-soft" aria-hidden="true" />
        <p className="max-w-xs text-sm font-semibold">{errText(error, "Unlock the video to study it.")}</p>
        <Link to="/plans" className="text-xs font-semibold text-brand-soft hover:underline">See plans</Link>
      </div>
    )
  }
  return <p className="py-8 text-center text-sm text-muted">{errText(error, `Study ${what} are not available for this video.`)}</p>
}

function Loading() {
  return (
    <div className="space-y-2">
      <p className="flex items-center gap-2 text-xs text-muted"><Loader2 size={13} className="animate-spin" aria-hidden="true" /> Preparing from the transcript…</p>
      {Array.from({ length: 4 }, (_, i) => <Skel key={i} className="h-12 w-full" />)}
    </div>
  )
}

function Notes({ videoId, onSeek }: { videoId: string; onSeek: (ms: number) => void }) {
  const q = useStudy<StudyNote>(videoId, "notes")
  if (q.isLoading) return <Loading />
  if (q.isError) return <Problem error={q.error} what="notes" />
  const items = q.data?.items ?? []
  if (!items.length) return <p className="py-8 text-center text-sm text-muted">No study notes for this video.</p>
  return (
    <div className="space-y-4">
      {items.map((n, i) => (
        <div key={`${n.t_ms}-${i}`}>
          {n.heading && (i === 0 || items[i - 1].heading !== n.heading) && <h3 className="mb-1.5 text-sm font-bold">{n.heading}</h3>}
          <p className="text-sm leading-relaxed text-ink/90">
            <Stamp label={n.label} ms={n.t_ms} onSeek={onSeek} className="mr-1.5 align-baseline" />
            {n.text}
          </p>
        </div>
      ))}
      <p className="text-[11px] text-faint">Made by AI from the transcript. Tap a time to check it in the video.</p>
    </div>
  )
}

function Flashcards({ videoId, onSeek }: { videoId: string; onSeek: (ms: number) => void }) {
  const q = useStudy<Flashcard>(videoId, "flashcards")
  const [at, setAt] = useState(0)
  const [flipped, setFlipped] = useState(false)
  if (q.isLoading) return <Loading />
  if (q.isError) return <Problem error={q.error} what="flashcards" />
  const items = q.data?.items ?? []
  if (!items.length) return <p className="py-8 text-center text-sm text-muted">No flashcards for this video.</p>
  const card = items[Math.min(at, items.length - 1)]
  const go = (n: number) => {
    setAt((n + items.length) % items.length)
    setFlipped(false)
  }
  return (
    <div className="flex h-full flex-col gap-3">
      <button
        type="button"
        onClick={() => setFlipped(!flipped)}
        className={cn(
          "flex min-h-40 flex-1 flex-col items-center justify-center gap-2 rounded-2xl border p-5 text-center transition-colors",
          flipped ? "border-brand/60 bg-brand/15" : "border-line bg-panel-2 hover:bg-white/[0.06]",
        )}
      >
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">{flipped ? "Answer" : "Question"}</span>
        <span className="text-base font-semibold leading-snug">{flipped ? card.back : card.front}</span>
        <span className="text-xs text-faint">{flipped ? "Tap to see the question" : "Tap to see the answer"}</span>
      </button>
      <div className="flex items-center gap-2">
        <Btn tone="soft" size="sm" onClick={() => go(at - 1)} aria-label="Previous card"><ChevronLeft size={16} aria-hidden="true" /></Btn>
        <span className="flex-1 text-center text-xs tabular-nums text-muted">{at + 1} / {items.length}</span>
        <Stamp label={card.label} ms={card.t_ms} onSeek={onSeek} />
        <Btn tone="soft" size="sm" onClick={() => go(at + 1)} aria-label="Next card"><ChevronRight size={16} aria-hidden="true" /></Btn>
      </div>
    </div>
  )
}

function Quiz({ videoId, onSeek }: { videoId: string; onSeek: (ms: number) => void }) {
  const signedIn = useSignedIn()
  const qc = useQueryClient()
  const q = useStudy<QuizItem>(videoId, "quiz")
  const past = useQuery({
    queryKey: ["quiz-attempts", videoId],
    enabled: signedIn,
    queryFn: () => getJson<QuizAttempt[]>(`/api/video/videos/${videoId}/quiz/attempts`),
  })
  const [answers, setAnswers] = useState<Record<number, number>>({})
  const [result, setResult] = useState<QuizResult | null>(null)
  const [sending, setSending] = useState(false)
  if (q.isLoading) return <Loading />
  if (q.isError) return <Problem error={q.error} what="quizzes" />
  const items = q.data?.items ?? []
  if (!items.length) return <p className="py-8 text-center text-sm text-muted">No quiz for this video.</p>
  const answered = Object.keys(answers).length
  const graded = new Map((result?.results ?? []).map((r) => [r.index, r]))

  async function check(e: FormEvent) {
    e.preventDefault()
    setSending(true)
    try {
      const { data } = await api.post<QuizResult>(`/api/video/videos/${videoId}/quiz/attempts`, {
        answers: items.map((_, i) => answers[i] ?? -1),
      })
      setResult(data)
      qc.invalidateQueries({ queryKey: ["quiz-attempts", videoId] })
    } catch (err) {
      toast.error(errText(err, "Your answers could not be checked."))
    } finally {
      setSending(false)
    }
  }

  return (
    <form onSubmit={check} className="space-y-4">
      {result && (
        <div role="status" className="flex items-center gap-3 rounded-xl border border-brand/50 bg-brand/15 px-3 py-2.5">
          <p className="flex-1 text-sm font-bold">You scored {result.score} of {result.total}</p>
          <Btn tone="soft" size="sm" onClick={() => { setResult(null); setAnswers({}) }}><RotateCcw size={14} aria-hidden="true" /> Try again</Btn>
        </div>
      )}
      {items.map((item, i) => {
        const g = graded.get(i)
        return (
          <fieldset key={i} className="rounded-xl bg-panel-2 p-3">
            <legend className="sr-only">Question {i + 1}</legend>
            <p className="mb-2 flex gap-2 text-sm font-semibold">
              <span className="tabular-nums text-muted">{i + 1}.</span>
              <span className="flex-1">{item.question}</span>
              {g && (g.right
                ? <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-emerald-400"><Check size={14} aria-hidden="true" /> Right</span>
                : <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-[#fca5a5]"><X size={14} aria-hidden="true" /> Wrong</span>)}
            </p>
            <div className="space-y-1.5">
              {item.options.map((opt, j) => {
                const correct = g && g.correct === j
                const wrongPick = g && !g.right && g.given === j
                return (
                  <label
                    key={j}
                    className={cn(
                      "flex cursor-pointer items-start gap-2.5 rounded-lg border px-2.5 py-2 text-sm",
                      correct ? "border-emerald-500/70 bg-emerald-500/10" : wrongPick ? "border-[#f87171]/70 bg-[#7f1d1d]/30" : answers[i] === j ? "border-brand bg-brand/10" : "border-line hover:bg-white/[0.04]",
                      g && "cursor-default",
                    )}
                  >
                    <input
                      type="radio"
                      name={`quiz-${i}`}
                      checked={answers[i] === j}
                      disabled={Boolean(result)}
                      onChange={() => setAnswers((a) => ({ ...a, [i]: j }))}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-[#A21CAF]"
                    />
                    <span className="flex-1 leading-snug">{opt}</span>
                  </label>
                )
              })}
            </div>
            {g && (
              <p className="mt-2 flex items-center gap-2 text-xs text-muted">
                {g.right ? "Nice." : "Watch this moment:"} <Stamp label={g.label} ms={g.t_ms} onSeek={onSeek} />
              </p>
            )}
          </fieldset>
        )
      })}
      {!result && (
        signedIn ? (
          <Btn tone="brand" type="submit" className="w-full" disabled={sending || answered === 0}>
            {sending ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : null}
            Check answers ({answered}/{items.length})
          </Btn>
        ) : (
          <Link to={loginPath()} className="flex h-9 items-center justify-center rounded-full bg-brand text-sm font-semibold text-white hover:bg-brand-hover">Sign in to check your answers</Link>
        )
      )}
      {(past.data ?? []).length > 0 && (
        <div>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Your past scores</h3>
          <ul className="flex flex-wrap gap-1.5">
            {(past.data ?? []).slice(0, 8).map((a) => (
              <li key={a.id} className="rounded-full bg-white/[0.07] px-2.5 py-1 text-xs">
                <span className="font-semibold tabular-nums">{a.score}/{a.total}</span> <span className="text-muted">· {timeAgo(a.created_at)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </form>
  )
}

function MyNotes({ videoId, currentMs, onSeek }: { videoId: string; currentMs: number; onSeek: (ms: number) => void }) {
  const signedIn = useSignedIn()
  const qc = useQueryClient()
  const [body, setBody] = useState("")
  const [saving, setSaving] = useState(false)
  const key = ["notes", videoId]
  const q = useQuery({ queryKey: key, enabled: signedIn, queryFn: () => getJson<PersonalNote[]>(`/api/video/videos/${videoId}/notes`) })

  if (!signedIn) {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <p className="text-sm font-semibold">Keep your own notes on this video</p>
        <p className="max-w-xs text-xs text-muted">Each note remembers the moment you wrote it. Only you can see them.</p>
        <Link to={loginPath()} className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover">Sign in to take notes</Link>
      </div>
    )
  }

  async function add(e: FormEvent) {
    e.preventDefault()
    const text = body.trim()
    if (!text) return
    setSaving(true)
    try {
      await api.post(`/api/video/videos/${videoId}/notes`, { t_ms: Math.max(0, Math.round(currentMs)), body: text })
      setBody("")
      await qc.invalidateQueries({ queryKey: key })
    } catch (err) {
      toast.error(errText(err, "Your note could not be saved."))
    } finally {
      setSaving(false)
    }
  }

  async function remove(n: PersonalNote) {
    try {
      await api.delete(`/api/video/notes/${n.id}`)
      qc.setQueryData<PersonalNote[]>(key, (old) => (old ?? []).filter((x) => x.id !== n.id))
    } catch (err) {
      toast.error(errText(err, "The note could not be deleted."))
    }
  }

  const notes = [...(q.data ?? [])].sort((a, b) => a.t_ms - b.t_ms || a.id - b.id)
  return (
    <div className="space-y-3">
      <form onSubmit={add} className="space-y-2">
        <textarea
          className={`${TEXTAREA} resize-none`}
          rows={2}
          maxLength={2000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write a note…"
          aria-label="Note"
        />
        <Btn tone="brand" size="sm" type="submit" disabled={!body.trim() || saving}>Add note at {clock(currentMs)}</Btn>
      </form>
      {q.isLoading ? (
        <Skel className="h-12 w-full" />
      ) : notes.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted">No notes yet. Pause anywhere and write one.</p>
      ) : (
        <ul className="space-y-2">
          {notes.map((n) => (
            <li key={n.id} className="flex items-start gap-2 rounded-xl bg-panel-2 px-3 py-2">
              <Stamp label={n.label} ms={n.t_ms} onSeek={onSeek} className="mt-0.5 shrink-0" />
              <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm">{n.body}</p>
              <button type="button" onClick={() => remove(n)} aria-label={`Delete note at ${n.label}`} className="shrink-0 rounded-full p-1 text-muted hover:bg-white/10 hover:text-ink">
                <Trash2 size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function StudyPanel({ videoId, currentMs, onSeek }: { videoId: string; currentMs: number; onSeek: (ms: number) => void }) {
  const [kind, setKind] = useState<Kind>("notes")
  return (
    <div className="flex h-full flex-col gap-3">
      <div role="tablist" aria-label="Study" className="flex shrink-0 gap-1 overflow-x-auto scrollbar-none">
        {KINDS.map((k) => (
          <button
            key={k.key}
            type="button"
            role="tab"
            aria-selected={kind === k.key}
            onClick={() => setKind(k.key)}
            className={cn("h-7 shrink-0 rounded-full px-3 text-xs font-semibold", kind === k.key ? "bg-snow text-black" : "bg-white/[0.08] text-ink hover:bg-white/15")}
          >
            {k.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pr-1" tabIndex={0} aria-label={KINDS.find((k) => k.key === kind)?.label}>
        {kind === "notes" && <Notes videoId={videoId} onSeek={onSeek} />}
        {kind === "flashcards" && <Flashcards videoId={videoId} onSeek={onSeek} />}
        {kind === "quiz" && <Quiz videoId={videoId} onSeek={onSeek} />}
        {kind === "mine" && <MyNotes videoId={videoId} currentMs={currentMs} onSeek={onSeek} />}
      </div>
    </div>
  )
}
