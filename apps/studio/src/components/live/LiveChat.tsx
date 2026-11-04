import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Clock, EyeOff, Send, Snail } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { formatMoney } from "@klygenixvideo/client"
import { Badge, Button, Card, Input, Select, useConfirm } from "@klygenixvideo/ui"
import { detail, when } from "../../lib/format"
import { LIVE_PUBLIC, wsUrl, type LiveMessage, type LiveStream } from "../../lib/live"
import { useHasPermission } from "../../lib/team"
import { useT } from "../../i18n"

const TIMEOUTS = [
  { value: "60", label: "1 minute" },
  { value: "300", label: "5 minutes" },
  { value: "3600", label: "1 hour" },
  { value: "86400", label: "24 hours" },
]

const SLOW = [
  { value: "5", label: "5 s" },
  { value: "10", label: "10 s" },
  { value: "30", label: "30 s" },
  { value: "60", label: "1 min" },
  { value: "120", label: "2 min" },
]

const PAID_KINDS = ["superchat", "gift"]

export interface ChatEvents {
  onViewers?: (n: number) => void
  onSlowMode?: (seconds: number) => void
  onEnded?: () => void
}

export function LiveChat({ stream, ...events }: { stream: LiveStream } & ChatEvents) {
  const t = useT()
  const confirm = useConfirm()
  const [items, setItems] = useState<LiveMessage[]>([])
  const [connected, setConnected] = useState(false)
  const [timeout, setTimeoutLen] = useState("300")
  const [slow, setSlow] = useState(String(stream.slow_mode_seconds || 30))
  const [text, setText] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const handlers = useRef(events)
  handlers.current = events
  const closed = stream.status === "ended" || stream.status === "failed"
  const canComments = useHasPermission("video.comments", "full")
  const canLive = useHasPermission("video.live", "full")
  const canModerate = canComments || canLive

  useEffect(() => {
    const v = String(stream.slow_mode_seconds)
    if (SLOW.some((o) => o.value === v)) setSlow(v)
  }, [stream.slow_mode_seconds])

  useEffect(() => {
    let live = true
    api.get<LiveMessage[]>(`${LIVE_PUBLIC}/${stream.id}/chat`, { params: { limit: 100 } })
      .then(({ data }) => {
        if (live) setItems((prev) => merge(data, prev))
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [stream.id])

  useEffect(() => {
    let socket: WebSocket | null = null
    let ping: ReturnType<typeof setInterval> | undefined
    let retry: ReturnType<typeof setTimeout> | undefined
    let attempts = 0
    let alive = true
    const open = () => {
      socket = new WebSocket(wsUrl(`/api/video/ws/live/${encodeURIComponent(stream.id)}`))
      socket.onopen = () => {
        attempts = 0
        setConnected(true)
        ping = setInterval(() => socket?.readyState === WebSocket.OPEN && socket.send("ping"), 25_000)
      }
      socket.onmessage = (e) => {
        let msg: { type?: string; item?: LiveMessage; id?: number; viewers?: number; seconds?: number; user_id?: number }
        try {
          msg = JSON.parse(e.data)
        } catch {
          return
        }
        if (msg.type === "viewers" || msg.type === "hello") {
          if (typeof msg.viewers === "number") handlers.current.onViewers?.(msg.viewers)
        } else if (msg.type === "chat_removed" && msg.id) {
          setItems((prev) => prev.filter((m) => m.id !== msg.id))
        } else if (msg.type === "slow_mode" && typeof msg.seconds === "number") {
          handlers.current.onSlowMode?.(msg.seconds)
        } else if (msg.type === "ended") {
          handlers.current.onEnded?.()
        } else if (msg.item && (msg.type === "chat" || PAID_KINDS.includes(msg.type ?? ""))) {
          const item = msg.item
          setItems((prev) => merge([item], prev))
        }
      }
      socket.onclose = (e) => {
        setConnected(false)
        if (ping) clearInterval(ping)
        if (!alive || e.code === 4404) return
        attempts += 1
        retry = setTimeout(open, Math.min(15_000, 1000 * 2 ** Math.min(attempts, 4)))
      }
    }
    open()
    return () => {
      alive = false
      if (ping) clearInterval(ping)
      if (retry) clearTimeout(retry)
      socket?.close(1000)
    }
  }, [stream.id])

  useEffect(() => {
    const el = list.current
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 120) el.scrollTop = el.scrollHeight
  }, [items])

  async function moderate(body: Record<string, unknown>, tag: string) {
    setBusy(tag)
    try {
      return (await api.post<{ ok: boolean; refunded?: boolean; slow_mode_seconds?: number }>(`${LIVE_PUBLIC}/${stream.id}/moderate`, body)).data
    } catch (err) {
      toast.error(detail(err, t("That did not work")))
      return null
    } finally {
      setBusy(null)
    }
  }

  async function hide(m: LiveMessage) {
    const paid = (m.paid_minor ?? 0) > 0
    const ok = await confirm({
      title: paid ? t("Hide this paid message?") : t("Hide this message?"),
      message: paid
        ? t("{author} paid {amount} for it. Hiding it refunds them in full, and the money comes off your earnings.", { author: m.author, amount: formatMoney(m.paid_minor ?? 0, "INR") })
        : t("It disappears for everyone watching."),
      confirmLabel: paid ? t("Hide and refund") : t("Hide"),
      variant: "destructive",
    })
    if (!ok) return
    const res = await moderate({ action: "hide", message_id: m.id }, `hide-${m.id}`)
    if (!res) return
    setItems((prev) => prev.filter((x) => x.id !== m.id))
    toast.success(res.refunded ? t("Hidden and refunded") : t("Message hidden"))
  }

  async function timeoutUser(m: LiveMessage) {
    const found = TIMEOUTS.find((o) => o.value === timeout)
    const label = found ? t(found.label) : t("{n} s", { n: timeout })
    const ok = await confirm({
      title: t("Time out {author}?", { author: m.author }),
      message: t("They cannot chat for {length}.", { length: label }),
      confirmLabel: t("Time out"),
    })
    if (!ok) return
    const res = await moderate({ action: "timeout", message_id: m.id, seconds: Number(timeout) }, `to-${m.id}`)
    if (res) toast.success(t("{author} is timed out for {length}", { author: m.author, length: label }))
  }

  async function slowMode(on: boolean) {
    const res = await moderate(on ? { action: "slow_mode", seconds: Number(slow) } : { action: "slow_mode_off" }, "slow")
    if (!res) return
    handlers.current.onSlowMode?.(res.slow_mode_seconds ?? 0)
    toast.success(on ? t("Slow mode on: {n} s", { n: res.slow_mode_seconds ?? 0 }) : t("Slow mode off"))
  }

  async function send() {
    const body = text.trim()
    if (!body) return
    setBusy("send")
    try {
      const { data } = await api.post<LiveMessage>(`${LIVE_PUBLIC}/${stream.id}/chat`, { body })
      setItems((prev) => merge([data], prev))
      setText("")
    } catch (err) {
      toast.error(detail(err, t("Could not send")))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card className="flex min-h-[28rem] flex-col p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div>
          <h2 className="text-sm font-bold text-navy">{t("Live chat")}</h2>
          <p className="text-xs text-slate-500">{connected ? t("Connected") : t("Connecting…")} · {items.length === 1 ? t("1 message") : t("{n} messages", { n: items.length })}</p>
        </div>
        {!closed && canModerate && (
          <div className="flex flex-wrap items-center gap-1.5">
            <Clock size={14} className="text-slate-400" aria-hidden="true" />
            <Select value={timeout} onChange={setTimeoutLen} options={TIMEOUTS.map((o) => ({ ...o, label: t(o.label) }))} className="w-32" aria-label={t("Timeout length")} />
          </div>
        )}
      </div>
      {!closed && canModerate && (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2">
          <Snail size={14} className="text-slate-500" aria-hidden="true" />
          <span className="text-xs font-medium text-slate-600">
            {stream.slow_mode_seconds ? t("Slow mode on · {n} s", { n: stream.slow_mode_seconds }) : t("Slow mode off")}
          </span>
          <Select value={slow} onChange={setSlow} options={SLOW.map((o) => ({ ...o, label: t(o.label) }))} className="ml-auto w-24" aria-label={t("Slow mode interval")} />
          <Button size="sm" variant="outline" onClick={() => slowMode(true)} disabled={busy !== null}>
            {stream.slow_mode_seconds ? t("Change") : t("Turn on")}
          </Button>
          {stream.slow_mode_seconds > 0 && (
            <Button size="sm" variant="ghost" onClick={() => slowMode(false)} disabled={busy !== null}>{t("Turn off")}</Button>
          )}
        </div>
      )}
      <div ref={list} className="max-h-[32rem] min-h-0 flex-1 space-y-1 overflow-y-auto px-2 py-2" aria-live="polite">
        {items.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-slate-500">{t("No messages yet.")}</p>
        ) : (
          items.map((m) => {
            const paid = (m.paid_minor ?? 0) > 0
            return (
              <div key={m.id} className={`group flex items-start gap-2 rounded-md px-2 py-1.5 ${paid ? "border border-amber-200 bg-amber-50" : "hover:bg-slate-50"}`}>
                <div className="min-w-0 flex-1 text-sm">
                  <span className="font-semibold text-slate-800">{m.author}</span>
                  {m.moderator && <Badge color="blue" className="ml-1">{t("Mod")}</Badge>}
                  {paid && <Badge color="amber" className="ml-1">{m.tier ?? t("Paid|access")} · {formatMoney(m.paid_minor ?? 0, "INR")}</Badge>}
                  <span className="ml-1.5 break-words text-slate-700">{m.body}</span>
                  {m.created_at && <span className="ml-1.5 text-xs text-slate-500">{when(m.created_at, true)}</span>}
                </div>
                {canModerate && <div className="flex shrink-0 gap-1">
                  {!closed && !m.moderator && (
                    <Button size="sm" variant="ghost" className="h-7 px-2" disabled={busy !== null} onClick={() => timeoutUser(m)}
                      aria-label={t("Time out {author}", { author: m.author })} title={t("Time out")}>
                      <Clock size={13} />
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-red-600" disabled={busy !== null} onClick={() => hide(m)}
                    aria-label={t("Hide message from {author}", { author: m.author })} title={paid ? t("Hide and refund") : t("Hide")}>
                    <EyeOff size={13} />
                  </Button>
                </div>}
              </div>
            )
          })
        )}
      </div>
      <form
        className="flex items-center gap-2 border-t border-slate-100 p-3"
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
      >
        <Input value={text} maxLength={200} onChange={(e) => setText(e.target.value)} placeholder={stream.status === "live" ? t("Say something to your viewers") : t("Chat opens when you are live")}
          disabled={stream.status !== "live"} aria-label={t("Chat message")} />
        <Button type="submit" size="sm" disabled={stream.status !== "live" || !text.trim() || busy !== null}><Send size={13} /> {t("Send")}</Button>
      </form>
    </Card>
  )
}

function merge(incoming: LiveMessage[], prev: LiveMessage[]): LiveMessage[] {
  const by = new Map(prev.map((m) => [m.id, m]))
  for (const m of incoming) by.set(m.id, { ...by.get(m.id), ...m })
  return [...by.values()].sort((a, b) => a.id - b.id).slice(-300)
}
