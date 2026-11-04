import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react"
import { Link } from "react-router-dom"
import { ArrowDown, Flag, Loader2, MessageSquareHeart, Send, Timer, Users } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { cn } from "@klygenixvideo/ui"
import { errStatus, errText, loginPath, useSignedIn } from "../../lib/api"
import { compactNumber, rupees } from "../../lib/format"
import { countdown, pinnedLeft, useNow, type LiveRoom } from "../../lib/live"
import type { ChannelSupport, LiveDetail, LiveMessage } from "../../lib/types"
import { giftIcon } from "./gifts"
import { useT } from "../../i18n"

const FALLBACK = "#FACC15"

function tierColor(support: ChannelSupport | undefined, label: string | null): string {
  return support?.superchat_tiers?.find((t) => t.label === label)?.color ?? FALLBACK
}

function giftKey(support: ChannelSupport | undefined, label: string | null): string | null {
  return support?.gifts?.find((g) => g.label === label)?.gift ?? null
}

function PaidCard({ m, support, compact = false }: { m: LiveMessage; support: ChannelSupport | undefined; compact?: boolean }) {
  const t = useT("live")
  if (m.kind === "gift") {
    return (
      <div className={cn("flex items-center gap-2.5 rounded-xl border border-brand/40 bg-brand/20 text-ink", compact ? "px-2.5 py-1.5" : "px-3 py-2")}>
        <span className="text-brand-soft">{giftIcon(giftKey(support, m.tier), compact ? 16 : 20)}</span>
        <p className="min-w-0 flex-1 text-sm">
          <span className="font-semibold">{m.author}</span> {t("sent a {gift}", { gift: m.tier ?? t("gift") })}
        </p>
        {m.paid_minor ? <span className="text-xs font-bold tabular-nums">{rupees(m.paid_minor)}</span> : null}
      </div>
    )
  }
  return (
    <div className={cn("rounded-xl text-black", compact ? "px-2.5 py-1.5" : "px-3 py-2")} style={{ background: tierColor(support, m.tier) }}>
      <p className="flex items-center gap-2 text-xs font-bold">
        <span className="min-w-0 flex-1 truncate">{m.author}</span>
        {m.paid_minor ? <span className="tabular-nums">{rupees(m.paid_minor)}</span> : null}
      </p>
      {m.body && <p className={cn("mt-0.5 break-words text-sm", compact && "line-clamp-2")}>{m.body}</p>}
    </div>
  )
}

function Pinned({ pinned, support }: { pinned: LiveMessage[]; support: ChannelSupport | undefined }) {
  const now = useNow(1000, pinned.length > 0)
  const t = useT("live")
  const shown = pinned.filter((m) => pinnedLeft(m, now) > 0).sort((a, b) => (b.paid_minor ?? 0) - (a.paid_minor ?? 0))
  if (!shown.length) return null
  return (
    <section aria-label={t("Pinned super chats and gifts")} className="space-y-1.5 border-b border-line px-3 py-2">
      {shown.slice(0, 3).map((m) => (
        <div key={m.id}>
          <PaidCard m={m} support={support} compact />
          <p className="mt-0.5 text-right text-[11px] tabular-nums text-faint">{t("Pinned · {time} left", { time: countdown(pinnedLeft(m, now)) })}</p>
        </div>
      ))}
      {shown.length > 3 && <p className="text-xs text-muted">{t("+{n} more pinned", { n: shown.length - 3 })}</p>}
    </section>
  )
}

export function LiveChat({
  stream, room, support, onRefresh, onSupport, onReport, className,
}: {
  stream: LiveDetail
  room: LiveRoom
  support: ChannelSupport | undefined
  onRefresh: () => void
  onSupport?: () => void
  onReport?: (m: LiveMessage) => void
  className?: string
}) {
  const signedIn = useSignedIn()
  const t = useT("live")
  const [text, setText] = useState("")
  const [sending, setSending] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [waitUntil, setWaitUntil] = useState(0)
  const [isMod, setIsMod] = useState(false)
  const [atBottom, setAtBottom] = useState(true)
  const log = useRef<HTMLDivElement>(null)
  const slow = room.slowMode ?? stream.slow_mode_seconds ?? 0
  const live = stream.status === "live"
  const timing = waitUntil > Date.now() || room.timedOutUntil > Date.now()
  const now = useNow(1000, timing)
  const wait = Math.max(0, waitUntil - now)
  const timedOut = Math.max(0, room.timedOutUntil - now)

  useLayoutEffect(() => {
    const el = log.current
    if (el && atBottom) el.scrollTop = el.scrollHeight
  }, [room.messages, atBottom])

  useEffect(() => {
    if (!slow) setWaitUntil(0)
  }, [slow])

  function onScroll() {
    const el = log.current
    if (el) setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 48)
  }

  function jump() {
    const el = log.current
    if (el) el.scrollTop = el.scrollHeight
    setAtBottom(true)
  }

  async function send(e: FormEvent) {
    e.preventDefault()
    const body = text.trim()
    if (!body || sending) return
    setSending(true)
    setProblem(null)
    try {
      const { data } = await api.post<LiveMessage>(`/api/video/live/${stream.id}/chat`, { body })
      room.add(data)
      setText("")
      setIsMod(Boolean(data.moderator))
      if (slow && !data.moderator) setWaitUntil(Date.now() + slow * 1000)
      jump()
    } catch (err) {
      const status = errStatus(err)
      setProblem(errText(err, t("Your message was not sent. Try again.")))
      if (status === 429 && slow) setWaitUntil(Date.now() + slow * 1000)
      if (status === 402 || status === 409) onRefresh()
    } finally {
      setSending(false)
    }
  }

  const blocked = wait > 0 || timedOut > 0

  return (
    <section aria-label={t("Live chat")} className={cn("flex min-h-0 flex-col overflow-hidden rounded-2xl border border-line bg-panel", className)}>
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1.5 whitespace-nowrap border-b border-line px-3 py-2.5">
        <h2 className="text-sm font-semibold">{t("Live chat")}</h2>
        {live && (
          <span className="inline-flex items-center gap-1 text-xs text-muted">
            <Users size={13} aria-hidden="true" /> {t("{n} watching", { n: compactNumber(room.viewers ?? stream.viewers) })}
          </span>
        )}
        <div className="flex-1" />
        {live && slow > 0 && (
          <span className="inline-flex items-center gap-1 rounded-md bg-white/[0.08] px-1.5 py-0.5 text-[11px] font-semibold text-muted">
            <Timer size={12} aria-hidden="true" /> {t("Slow mode {n} s", { n: slow })}
          </span>
        )}
        {onSupport && (
          <button type="button" onClick={onSupport} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-[#FACC15] px-3 text-xs font-bold text-black hover:bg-[#fde047]">
            <MessageSquareHeart size={14} aria-hidden="true" /> {t("Super chat")}
          </button>
        )}
      </header>

      <Pinned pinned={room.pinned} support={support} />

      <div className="relative min-h-0 flex-1">
        <div
          ref={log}
          onScroll={onScroll}
          role="log"
          aria-label={t("Chat messages")}
          tabIndex={0}
          className="h-full overflow-y-auto outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
        >
        <ol className="space-y-1.5 px-3 py-3 text-sm">
          {room.messages.length === 0 ? (
            <li className="py-8 text-center text-sm text-muted">
              {live ? t("No messages yet. Say hello!") : stream.status === "scheduled" ? t("Chat opens when the stream starts.") : t("No chat for this stream.")}
            </li>
          ) : (
            room.messages.map((m) => (
              <li key={m.id} className="group flex items-start gap-1 break-words leading-snug">
                <div className="min-w-0 flex-1">
                  {m.kind === "chat" ? (
                    <>
                      <span className="mr-1.5 font-semibold text-muted">{m.author}</span>
                      {m.moderator && <span className="mr-1.5 rounded bg-brand/30 px-1 py-px text-[10px] font-bold uppercase text-brand-soft">{t("Mod")}</span>}
                      <span className="text-ink/90">{m.body}</span>
                    </>
                  ) : (
                    <PaidCard m={m} support={support} />
                  )}
                </div>
                {onReport && !m.mine && (
                  <button
                    type="button"
                    onClick={() => onReport(m)}
                    aria-label={t("Report message from {name}", { name: m.author })}
                    title={t("Report message")}
                    className="-mr-1 shrink-0 rounded-full p-1 text-faint hover:bg-white/10 hover:text-ink focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                  >
                    <Flag size={13} aria-hidden="true" />
                  </button>
                )}
              </li>
            ))
          )}
        </ol>
        </div>
        {!atBottom && room.messages.length > 0 && (
          <button
            type="button"
            onClick={jump}
            className="absolute bottom-2 left-1/2 inline-flex -translate-x-1/2 items-center gap-1 rounded-full bg-snow px-3 py-1 text-xs font-semibold text-black shadow-lg"
          >
            <ArrowDown size={13} aria-hidden="true" /> {t("Latest messages")}
          </button>
        )}
      </div>

      <div className="border-t border-line p-3">
        {!live ? (
          <p className="text-center text-xs text-muted">
            {stream.status === "scheduled" ? t("You can chat once the stream is live.") : t("Chat is closed. The stream has ended.")}
          </p>
        ) : !signedIn ? (
          <p className="text-center text-sm text-muted">
            <Link to={loginPath()} className="font-semibold text-brand-soft hover:underline">{t("Sign in")}</Link> {t("to chat.")}
          </p>
        ) : (
          <form onSubmit={send} className="space-y-2">
            {problem && <p role="alert" className="rounded-lg border border-[#f97316]/40 bg-[#7c2d12]/30 px-2.5 py-1.5 text-xs text-[#fed7aa]">{problem}</p>}
            <div className="flex items-center gap-2">
              <label htmlFor="live-chat-input" className="sr-only">{t("Chat message")}</label>
              <input
                id="live-chat-input"
                value={text}
                onChange={(e) => { setText(e.target.value.slice(0, 200)); setProblem(null) }}
                maxLength={200}
                autoComplete="off"
                placeholder={timedOut ? t("Chat paused by a moderator") : t("Say something…")}
                disabled={timedOut > 0}
                className="h-10 min-w-0 flex-1 rounded-full border border-line bg-panel-2 px-4 text-sm text-ink outline-none placeholder:text-faint focus:border-brand focus:ring-1 focus:ring-brand disabled:opacity-60"
              />
              <button
                type="submit"
                aria-label={t("Send message")}
                disabled={!text.trim() || sending || blocked}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                {sending ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}
              </button>
            </div>
            <p className="flex justify-between text-[11px] text-faint">
              <span>
                {timedOut > 0
                  ? t("A moderator paused your chat · {time}", { time: countdown(timedOut) })
                  : wait > 0
                    ? t("Slow mode · you can send again in {n} s", { n: Math.ceil(wait / 1000) })
                    : isMod && slow
                      ? t("Slow mode does not apply to moderators.")
                      : ""}
              </span>
              <span className="tabular-nums">{text.length}/200</span>
            </p>
          </form>
        )}
      </div>
    </section>
  )
}
