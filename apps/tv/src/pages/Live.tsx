import { useEffect, useRef, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { HlsPlayer } from "@klygenixvideo/player"
import { PUBLIC_DOMAIN, api, errStatus, errText, getJson, sameOrigin, useSignedIn } from "../lib/api"
import { when } from "../lib/format"
import type { LiveDetail, LiveMessage } from "../lib/types"
import { Phone } from "../components/Tiles"

const KEEP = 150

function merge(base: LiveMessage[], extra: LiveMessage[], removed: Set<number>): LiveMessage[] {
  const byId = new Map<number, LiveMessage>()
  for (const m of [...base, ...extra]) if (!removed.has(m.id)) byId.set(m.id, m)
  return [...byId.values()].sort((a, b) => a.id - b.id).slice(-KEEP)
}

function socketUrl(id: string): string {
  const root = String(api.defaults.baseURL ?? "") || window.location.origin
  const url = new URL(`/api/video/ws/live/${encodeURIComponent(id)}`, root)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  return url.toString()
}

function useChat(id: string, open: boolean, onStatus: (s: string) => void) {
  const [messages, setMessages] = useState<LiveMessage[]>([])
  const [viewers, setViewers] = useState<number | null>(null)
  const removed = useRef(new Set<number>())
  const status = useRef(onStatus)
  status.current = onStatus
  const history = useQuery({
    queryKey: ["live", id, "chat"],
    enabled: open,
    staleTime: Infinity,
    queryFn: () => getJson<LiveMessage[]>(`/api/video/live/${id}/chat`, { limit: 50 }),
  })
  useEffect(() => {
    if (history.data) setMessages((prev) => merge(history.data, prev, removed.current))
  }, [history.data])
  useEffect(() => {
    if (!open || typeof WebSocket === "undefined") return
    let socket: WebSocket | null = null
    let ping = 0
    let retry = 0
    let attempt = 0
    let stopped = false
    const connect = () => {
      if (stopped) return
      socket = new WebSocket(socketUrl(id))
      socket.onopen = () => {
        attempt = 0
        ping = window.setInterval(() => socket?.readyState === WebSocket.OPEN && socket.send("ping"), 25_000)
      }
      socket.onmessage = (ev) => {
        let msg: Record<string, unknown>
        try {
          msg = JSON.parse(String(ev.data))
        } catch {
          return
        }
        if ((msg.type === "hello" || msg.type === "viewers") && typeof msg.viewers === "number") setViewers(msg.viewers)
        if ((msg.type === "chat" || msg.type === "superchat" || msg.type === "gift") && msg.item) {
          setMessages((prev) => merge(prev, [msg.item as LiveMessage], removed.current))
        } else if (msg.type === "chat_removed" && typeof msg.id === "number") {
          removed.current.add(msg.id)
          setMessages((prev) => prev.filter((m) => m.id !== msg.id))
        } else if (msg.type === "ended" || msg.type === "live") status.current(msg.type)
      }
      socket.onclose = (ev) => {
        window.clearInterval(ping)
        if (stopped || ev.code === 4404) return
        attempt += 1
        retry = window.setTimeout(connect, Math.min(15_000, 1000 * 2 ** Math.min(attempt, 4)))
      }
    }
    connect()
    return () => {
      stopped = true
      window.clearInterval(ping)
      window.clearTimeout(retry)
      socket?.close()
    }
  }, [id, open])
  return { messages, viewers }
}

export default function Live() {
  const { id = "" } = useParams()
  const signedIn = useSignedIn()
  const navigate = useNavigate()
  const [chatOn, setChatOn] = useState(true)
  const q = useQuery({
    queryKey: ["live", id, signedIn],
    queryFn: () => getJson<LiveDetail>(`/api/video/live/${id}`),
    retry: (count, err) => errStatus(err) !== 404 && count < 1,
    refetchInterval: (query) => (query.state.data?.status === "live" || query.state.data?.status === "scheduled" ? 30_000 : false),
  })
  const data = q.data
  const open = Boolean(data && !data.locked && (data.status === "live" || data.status === "scheduled"))
  const chat = useChat(id, open, () => q.refetch())
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chat.messages.length])

  const back = () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
    if (idx > 0) navigate(-1)
    else navigate("/", { replace: true })
  }
  const ctl = "rounded-full bg-panel-3 px-7 py-3 text-2xl font-semibold text-white hover:bg-line focus:bg-white focus:text-black"

  let stage
  if (q.isLoading) stage = <p role="status" className="text-3xl text-white/80">Loading…</p>
  else if (q.isError || !data) stage = <p className="text-3xl">{errStatus(q.error) === 404 ? "This stream isn't here." : errText(q.error, "This stream did not load.")}</p>
  else if (data.locked) stage = <div className="max-w-[48rem]"><Phone what="This stream is for channel members. To join," /></div>
  else if (data.status === "live" && data.playback) {
    stage = <HlsPlayer key={data.playback.url} src={sameOrigin(data.playback.url) ?? data.playback.url} live autoPlay controls={false} hotkeys={false} className="tv-player absolute inset-0 h-full w-full" />
  } else if (data.status === "live") stage = <p className="text-3xl">The stream is starting. Stay here — it plays as soon as video arrives.</p>
  else if (data.status === "scheduled") stage = <p className="text-3xl">Starts {when(data.scheduled_at)}</p>
  else {
    stage = (
      <div className="text-center">
        <p className="text-4xl font-bold">This stream has ended.</p>
        {data.replay?.status === "published" && (
          <Link to={`/watch/${data.replay.id}`} data-autofocus className="mt-8 inline-block rounded-full bg-brand px-10 py-4 text-2xl font-semibold text-white">
            Watch the replay
          </Link>
        )}
      </div>
    )
  }

  return (
    <main className="fixed inset-0 flex bg-black text-white">
      <div className="relative flex flex-1 flex-col">
        <div className="relative flex flex-1 items-center justify-center">{stage}</div>
        <div className="bg-gradient-to-t from-black via-black/80 to-transparent px-[6rem] pb-[3.375rem] pt-8">
          <div className="flex items-center gap-4">
            {data?.status === "live" && <span className="rounded-md bg-live px-3 py-1 text-xl font-extrabold">LIVE</span>}
            <h1 className="text-4xl font-bold">{data?.title ?? "Live"}</h1>
          </div>
          <p className="mt-2 text-2xl text-white/80">
            {data?.channel?.name}
            {data?.status === "live" ? ` · ${chat.viewers ?? data.viewers} watching` : ""}
          </p>
          <div className="mt-5 flex flex-wrap gap-4" data-focus-group>
            <button type="button" className={ctl} onClick={back} data-autofocus>‹ Back</button>
            {open && (
              <button type="button" className={ctl} aria-pressed={chatOn} onClick={() => setChatOn(!chatOn)}>
                Chat {chatOn ? "shown" : "hidden"}
              </button>
            )}
            {data?.channel && <Link to={`/channel/${data.channel.handle}`} className={ctl}>{data.channel.name}</Link>}
          </div>
        </div>
      </div>
      {open && chatOn && (
        <aside aria-labelledby="chat-title" className="flex w-[30rem] flex-col border-l border-line bg-panel px-6 py-[3.375rem]">
          <h2 id="chat-title" className="text-3xl font-bold">Live chat</h2>
          <div ref={listRef} role="log" aria-label="Chat messages" tabIndex={0} data-focusable className="scrollbar-none mt-4 flex-1 overflow-y-auto rounded-lg">
            <ul className="space-y-3">
            {chat.messages.length === 0 && <li className="text-xl text-muted">No messages yet.</li>}
            {chat.messages.map((m) => (
              <li key={m.id} className={`text-xl leading-snug ${m.paid_minor ? "rounded-lg bg-brand px-3 py-2" : ""}`}>
                <span className={`font-bold ${m.paid_minor ? "text-white" : "text-brand-soft"}`}>{m.author}</span>{" "}
                <span className="break-words">{m.body}</span>
              </li>
            ))}
            </ul>
          </div>
          <p className="mt-4 text-lg leading-snug text-muted">
            Chat is read-only on TV. To chat or send a Super Chat, open {PUBLIC_DOMAIN} on your phone.
          </p>
        </aside>
      )}
    </main>
  )
}
