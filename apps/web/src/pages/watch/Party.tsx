import { useCallback, useEffect, useRef, useState, type RefObject } from "react"
import { Link } from "react-router-dom"
import { toast } from "sonner"
import { Copy, LogOut, MessageCircle, PartyPopper, Send, Users } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { cn, useConfirm } from "@klygenixvideo/ui"
import { errStatus, errText, loginPath } from "../../lib/api"
import { Btn } from "../../components/bits"

export interface PartyInfo {
  code: string
  video_id: string
  host_name: string
  playing: boolean
  position_ms: number
  server_time: number
  members: number
  is_host: boolean
}

export interface PartyState {
  playing: boolean
  position_ms: number
  server_time: number
}

interface ChatLine {
  n: number
  name: string
  text: string
}

export interface Party {
  code: string
  info: PartyInfo | null
  members: number
  chat: ChatLine[]
  ended: boolean
  missing: boolean
  latest: RefObject<PartyState | null>
  expected: (s: PartyState) => number
  sendState: (playing: boolean, positionMs: number) => void
  sendChat: (text: string) => Promise<boolean>
  end: () => Promise<void>
}

function wsUrl(code: string): string {
  const root = String(api.defaults.baseURL ?? "") || window.location.origin
  const url = new URL(`/api/video/ws/parties/${encodeURIComponent(code)}`, root)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  return url.toString()
}

export const partyLink = (videoId: string, code: string) => `${window.location.origin}/watch/${videoId}?party=${code}`

export function useParty(code: string | null, enabled: boolean, onState: (s: PartyState) => void): Party | null {
  const [info, setInfo] = useState<PartyInfo | null>(null)
  const [members, setMembers] = useState(0)
  const [chat, setChat] = useState<ChatLine[]>([])
  const [ended, setEnded] = useState(false)
  const [missing, setMissing] = useState(false)
  const latest = useRef<PartyState | null>(null)
  const offset = useRef(0)
  const counter = useRef(0)
  const handler = useRef(onState)
  handler.current = onState
  const isHost = useRef(false)

  useEffect(() => {
    setInfo(null)
    setChat([])
    setEnded(false)
    setMissing(false)
    latest.current = null
    if (!code || !enabled) return
    let live = true
    api.get<PartyInfo>(`/api/video/parties/${code}`).then(({ data }) => {
      if (!live) return
      offset.current = data.server_time * 1000 - Date.now()
      isHost.current = data.is_host
      latest.current = { playing: data.playing, position_ms: data.position_ms, server_time: data.server_time }
      setInfo(data)
      setMembers(data.members)
      if (!data.is_host) handler.current(latest.current)
    }).catch((err) => {
      if (!live) return
      if (errStatus(err) === 404) setMissing(true)
      else toast.error(errText(err, "The watch party did not load."))
    })
    return () => { live = false }
  }, [code, enabled])

  const ready = Boolean(info) && !ended
  useEffect(() => {
    if (!code || !ready || typeof WebSocket === "undefined") return
    let socket: WebSocket | null = null
    let ping: number | undefined
    let retry: number | undefined
    let attempt = 0
    let stopped = false
    const connect = () => {
      if (stopped) return
      socket = new WebSocket(wsUrl(code))
      socket.onopen = () => {
        attempt = 0
        ping = window.setInterval(() => { if (socket?.readyState === WebSocket.OPEN) socket.send("ping") }, 25_000)
      }
      socket.onmessage = (ev) => {
        let msg: Record<string, unknown>
        try {
          msg = JSON.parse(String(ev.data))
        } catch {
          return
        }
        if (typeof msg.server_time === "number" && (msg.type === "hello" || msg.type === "pong")) {
          offset.current = msg.server_time * 1000 - Date.now()
        }
        if (msg.type === "hello" || msg.type === "state") {
          const s = { playing: Boolean(msg.playing), position_ms: Number(msg.position_ms) || 0, server_time: Number(msg.server_time) || 0 }
          latest.current = s
          if (typeof msg.members === "number") setMembers(msg.members)
          if (!isHost.current) handler.current(s)
        } else if (msg.type === "members" && typeof msg.members === "number") {
          setMembers(msg.members)
        } else if (msg.type === "chat") {
          counter.current += 1
          const line = { n: counter.current, name: String(msg.name ?? ""), text: String(msg.text ?? "") }
          setChat((prev) => [...prev.slice(-99), line])
        } else if (msg.type === "ended") {
          stopped = true
          setEnded(true)
          socket?.close()
        }
      }
      socket.onclose = (ev) => {
        window.clearInterval(ping)
        if (stopped || ev.code === 4404) {
          if (ev.code === 4404) setEnded(true)
          return
        }
        retry = window.setTimeout(connect, Math.min(30_000, 1000 * 2 ** attempt++))
      }
      socket.onerror = () => socket?.close()
    }
    connect()
    return () => {
      stopped = true
      window.clearInterval(ping)
      window.clearTimeout(retry)
      socket?.close()
    }
  }, [code, ready])

  const expected = useCallback((s: PartyState) => {
    if (!s.playing) return s.position_ms
    return s.position_ms + Math.max(0, Date.now() + offset.current - s.server_time * 1000)
  }, [])

  const sendState = useCallback((playing: boolean, positionMs: number) => {
    if (!code) return
    api.post(`/api/video/parties/${code}/state`, { playing, position_ms: Math.max(0, Math.round(positionMs)) }).catch((err) => {
      if (errStatus(err) === 404) setEnded(true)
    })
  }, [code])

  const sendChat = useCallback(async (text: string) => {
    if (!code) return false
    try {
      await api.post(`/api/video/parties/${code}/chat`, { text })
      return true
    } catch (err) {
      toast.error(errText(err, "That message was not sent."))
      return false
    }
  }, [code])

  const end = useCallback(async () => {
    if (!code) return
    try {
      await api.delete(`/api/video/parties/${code}`)
      setEnded(true)
    } catch (err) {
      toast.error(errText(err, "The party could not be ended."))
    }
  }, [code])

  if (!code || !enabled) return null
  return { code, info, members, chat, ended, missing, latest, expected, sendState, sendChat, end }
}

export function usePartySync(party: Party | null, videoRef: RefObject<HTMLVideoElement | null>, mountKey: string) {
  const [blocked, setBlocked] = useState(false)
  const applying = useRef(0)
  const active = Boolean(party?.info) && !party?.ended
  const host = Boolean(party?.info?.is_host)
  const partyRef = useRef(party)
  partyRef.current = party

  const apply = useCallback((s: PartyState | null) => {
    const v = videoRef.current
    const p = partyRef.current
    if (!v || !s || !p || p.ended || p.info?.is_host) return
    applying.current = Date.now() + 1200
    const target = p.expected(s)
    if (Math.abs(v.currentTime * 1000 - target) > 1500 && (v.readyState > 0 || !s.playing)) v.currentTime = target / 1000
    if (s.playing && v.paused) {
      v.play().then(() => setBlocked(false)).catch(() => setBlocked(true))
    } else if (!s.playing && !v.paused) {
      v.pause()
    }
  }, [videoRef])

  useEffect(() => {
    const v = videoRef.current
    if (!active || !v) return
    if (host) {
      let last = 0
      let timer: number | undefined
      const send = () => {
        last = Date.now()
        partyRef.current?.sendState(!v.paused && !v.ended, v.currentTime * 1000)
      }
      const onSeeked = () => {
        window.clearTimeout(timer)
        const wait = 700 - (Date.now() - last)
        if (wait <= 0) send()
        else timer = window.setTimeout(send, wait)
      }
      v.addEventListener("play", send)
      v.addEventListener("pause", send)
      v.addEventListener("seeked", onSeeked)
      return () => {
        window.clearTimeout(timer)
        v.removeEventListener("play", send)
        v.removeEventListener("pause", send)
        v.removeEventListener("seeked", onSeeked)
      }
    }
    const snapBack = () => {
      if (Date.now() < applying.current) return
      window.setTimeout(() => apply(partyRef.current?.latest.current ?? null), 50)
    }
    const onReady = () => apply(partyRef.current?.latest.current ?? null)
    v.addEventListener("play", snapBack)
    v.addEventListener("pause", snapBack)
    v.addEventListener("seeked", snapBack)
    v.addEventListener("loadedmetadata", onReady)
    const tick = window.setInterval(onReady, 4000)
    onReady()
    return () => {
      window.clearInterval(tick)
      v.removeEventListener("play", snapBack)
      v.removeEventListener("pause", snapBack)
      v.removeEventListener("seeked", snapBack)
      v.removeEventListener("loadedmetadata", onReady)
    }
  }, [active, host, mountKey, videoRef, apply])

  const join = useCallback(() => {
    setBlocked(false)
    apply(partyRef.current?.latest.current ?? null)
  }, [apply])

  return { apply, blocked: active && !host && blocked, join }
}

export function GuestStrip({ party, blocked, onJoin }: { party: Party | null; blocked: boolean; onJoin: () => void }) {
  if (!party?.info || party.ended || party.info.is_host) return null
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-brand/15 px-3 py-2 text-sm sm:rounded-b-2xl">
      <PartyPopper size={16} className="shrink-0 text-brand-soft" aria-hidden="true" />
      <span className="min-w-0 flex-1">The host controls playback.</span>
      {blocked && <Btn tone="brand" size="sm" onClick={onJoin}>Join playback</Btn>}
    </div>
  )
}

export function PartyPanel({
  party, videoId, signedIn, hosted, onLeave, className,
}: {
  party: Party | null
  videoId: string
  signedIn: boolean
  hosted: boolean
  onLeave: () => void
  className?: string
}) {
  const confirm = useConfirm()
  const [text, setText] = useState("")
  const [sending, setSending] = useState(false)
  const list = useRef<HTMLOListElement>(null)
  const lines = party?.chat.length ?? 0

  useEffect(() => {
    const box = list.current
    if (box) box.scrollTop = box.scrollHeight
  }, [lines])

  const box = (children: React.ReactNode) => (
    <section aria-label="Watch party" className={cn("overflow-hidden rounded-2xl border border-line bg-panel", className)}>
      {children}
    </section>
  )

  if (!signedIn) {
    return box(
      <div className="space-y-2 p-4 text-sm">
        <p className="flex items-center gap-2 font-semibold"><PartyPopper size={16} className="text-brand-soft" /> You are invited to a watch party</p>
        <p className="text-muted">Sign in to watch together and chat.</p>
        <Link to={loginPath()} className="inline-flex h-8 items-center rounded-full bg-brand px-3 text-xs font-semibold text-white hover:bg-brand-hover">Sign in to join</Link>
      </div>,
    )
  }
  if (!hosted) {
    return box(<p className="p-4 text-sm text-muted">Watch parties work only on videos hosted on Klygenix Play.</p>)
  }
  if (!party) return null
  if (party.ended || party.missing) {
    return box(
      <div className="space-y-2 p-4 text-sm">
        <p className="font-semibold">The watch party has ended.</p>
        <p className="text-muted">You can keep watching on your own.</p>
        <Btn size="sm" onClick={onLeave}>Keep watching</Btn>
      </div>,
    )
  }
  if (!party.info) return box(<p className="p-4 text-sm text-muted">Joining the watch party…</p>)
  const info = party.info

  async function copy() {
    const url = partyLink(videoId, info.code)
    try {
      await navigator.clipboard.writeText(url)
      toast.success("Party link copied")
    } catch {
      toast.message(url)
    }
  }

  async function endParty() {
    const ok = await confirm({
      title: "End the watch party?",
      message: "Everyone in it stops following your playback. The video keeps playing for each of them.",
      confirmLabel: "End party",
      variant: "destructive",
    })
    if (ok) await party!.end()
  }

  async function send(e: React.FormEvent) {
    e.preventDefault()
    const t = text.trim()
    if (!t) return
    setSending(true)
    if (await party!.sendChat(t)) setText("")
    setSending(false)
  }

  return box(
    <>
      <div className="space-y-2 border-b border-line px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-2 font-semibold"><PartyPopper size={16} className="text-brand-soft" aria-hidden="true" /> Watch party</p>
          <span className="inline-flex items-center gap-1 text-xs text-muted" aria-label={`${party.members} watching`}>
            <Users size={14} aria-hidden="true" /> {party.members}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-lg bg-white/10 px-2.5 py-1 font-mono text-lg font-bold tracking-[0.2em]" aria-label={`Party code ${info.code.split("").join(" ")}`}>{info.code}</span>
          <Btn size="sm" onClick={copy}><Copy size={14} aria-hidden="true" /> Copy link</Btn>
          {info.is_host ? (
            <Btn size="sm" tone="danger" onClick={endParty}>End party</Btn>
          ) : (
            <Btn size="sm" tone="ghost" onClick={onLeave}><LogOut size={14} aria-hidden="true" /> Leave</Btn>
          )}
        </div>
        <p className="text-xs text-muted">
          {info.is_host ? "You are the host. Everyone follows your play, pause and seek." : <>Hosted by {info.host_name}. The host controls playback.</>}
        </p>
      </div>
      <ol ref={list} className="h-44 space-y-1.5 overflow-y-auto px-3 py-2 text-sm" aria-live="polite" aria-label="Party chat">
        {party.chat.length === 0 ? (
          <li className="flex items-center gap-2 text-muted"><MessageCircle size={14} aria-hidden="true" /> Say hello to the room.</li>
        ) : party.chat.map((c) => (
          <li key={c.n} className="break-words"><span className="font-semibold text-brand-soft">{c.name}</span> <span className="text-ink/90">{c.text}</span></li>
        ))}
      </ol>
      <form onSubmit={send} className="flex items-center gap-2 border-t border-line p-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={200}
          placeholder="Chat with the room"
          aria-label="Chat message"
          className="h-9 min-w-0 flex-1 rounded-full border border-line bg-panel-2 px-3 text-sm text-ink placeholder:text-faint outline-none focus:border-brand"
        />
        <button type="submit" disabled={sending || !text.trim()} aria-label="Send" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand text-white disabled:opacity-50">
          <Send size={15} aria-hidden="true" />
        </button>
      </form>
    </>,
  )
}
