import { Suspense, lazy, useCallback, useEffect, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { CalendarClock, Clapperboard, Flag, Gift, Loader2, Lock, MessageSquareHeart, Radio, Users } from "lucide-react"
import { useAuthStore } from "@klygenixvideo/auth"
import { cn } from "@klygenixvideo/ui"
import { HlsPlayer } from "@klygenixvideo/player"
import { errStatus, getJson, loginPath, useSignedIn } from "../../lib/api"
import { compactNumber, longDate, timeAgo } from "../../lib/format"
import { countdown, useLiveRoom, useNow } from "../../lib/live"
import { useChannelSupport } from "../../lib/support"
import { useTitle } from "../../lib/title"
import type { ChannelDetail, LiveDetail } from "../../lib/types"
import { Btn, ChannelAvatar, ChannelName, Skel } from "../../components/bits"
import { FollowButton } from "../../components/FollowButton"
import { LiveBadge, watching } from "../../components/Live"
import { Sheet } from "../../components/Sheet"
import { MembershipTiers } from "../../components/Support"
import { ReportDialog, type ReportTarget } from "../../components/ReportDialog"
import NotFound from "../NotFound"
import { LiveChat } from "./LiveChat"
import type { SupportMode } from "./LiveSupportSheet"

const LiveSupportSheet = lazy(() => import("./LiveSupportSheet"))

const STAGE = "relative flex aspect-video w-full flex-col items-center justify-center gap-3 overflow-hidden bg-[radial-gradient(circle_at_50%_35%,#3b0a45,#0b0b12_70%)] p-6 text-center sm:rounded-2xl"

function pollEvery(d: LiveDetail | undefined): number | false {
  if (!d) return false
  if (d.status === "scheduled") return 5000
  if (d.status === "live") return d.playback || d.locked ? 30_000 : 4000
  if (d.status === "ended" && d.replay_enabled && d.replay?.status !== "published") {
    const since = d.ended_at ? Date.now() - Date.parse(d.ended_at) : 0
    return since < 3_600_000 ? 15_000 : false
  }
  return false
}

function Scheduled({ stream }: { stream: LiveDetail }) {
  const at = stream.scheduled_at ? Date.parse(stream.scheduled_at) : null
  const now = useNow(1000, Boolean(at))
  const left = at ? at - now : 0
  return (
    <div className={STAGE}>
      <ChannelAvatar channel={stream.channel} size={72} />
      <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-ink">
        <CalendarClock size={14} aria-hidden="true" /> Upcoming live
      </p>
      {left > 0 ? (
        <>
          <p className="text-sm text-muted">Starts in</p>
          <p className="text-3xl font-bold tabular-nums sm:text-5xl" role="timer">{countdown(left)}</p>
          <p className="text-xs text-faint">{new Date(at as number).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</p>
        </>
      ) : (
        <p className="inline-flex items-center gap-2 text-sm text-muted">
          <Loader2 size={16} className="animate-spin" aria-hidden="true" /> Waiting for {stream.channel?.name ?? "the creator"} to go live…
        </p>
      )}
    </div>
  )
}

function Ended({ stream }: { stream: LiveDetail }) {
  const replay = stream.replay
  return (
    <div className={STAGE}>
      <Clapperboard size={30} className="text-brand-soft" aria-hidden="true" />
      <p className="text-lg font-bold">{stream.status === "failed" ? "This stream stopped unexpectedly" : "This live stream has ended"}</p>
      {stream.ended_at && <p className="text-xs text-faint">Ended {timeAgo(stream.ended_at)}</p>}
      {replay?.status === "published" ? (
        <Link to={`/watch/${replay.id}`} className="mt-1 inline-flex h-10 items-center gap-2 rounded-full bg-brand px-5 text-sm font-semibold text-white hover:bg-brand-hover">
          Watch the replay
        </Link>
      ) : stream.replay_enabled && stream.status === "ended" ? (
        <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-sm text-ink">
          <Loader2 size={15} className="animate-spin" aria-hidden="true" /> Replay processing
        </p>
      ) : (
        <p className="text-sm text-muted">There is no replay for this stream.</p>
      )}
    </div>
  )
}

function Locked({ stream, canJoin, onJoin }: { stream: LiveDetail; canJoin: boolean; onJoin: () => void }) {
  const signedIn = useSignedIn()
  const rank = stream.locked?.members_rank ?? stream.members_rank
  return (
    <div className={STAGE}>
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#FACC15] text-black"><Lock size={24} aria-hidden="true" /></span>
      <p className="text-lg font-bold">Members-only live</p>
      <p className="max-w-sm text-sm text-muted">
        This live stream and its chat are for {stream.channel?.name ?? "channel"} members{rank && rank > 1 ? ` at tier ${rank} or above` : ""}.
      </p>
      {!signedIn ? (
        <Link to={loginPath()} className="inline-flex h-10 items-center rounded-full bg-snow px-5 text-sm font-semibold text-black hover:bg-snow/85">Sign in to join</Link>
      ) : canJoin ? (
        <Btn tone="brand" size="lg" onClick={onJoin}>Join membership to watch</Btn>
      ) : (
        <p className="text-xs text-faint">This channel is not taking new members right now.</p>
      )}
    </div>
  )
}

export default function LivePage() {
  const { publicId = "" } = useParams()
  const signedIn = useSignedIn()
  const me = useAuthStore((s) => s.user)
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [supportMode, setSupportMode] = useState<SupportMode>("superchat")
  const [supportOpen, setSupportOpen] = useState(false)
  const [supportUsed, setSupportUsed] = useState(false)
  const [joinOpen, setJoinOpen] = useState(false)
  const [src, setSrc] = useState<{ url: string; exp: number } | null>(null)
  const [report, setReport] = useState<ReportTarget | null>(null)

  const detail = useQuery({
    queryKey: ["live", publicId, signedIn],
    queryFn: () => getJson<LiveDetail>(`/api/video/live/${publicId}`),
    retry: (n, err) => errStatus(err) !== 404 && n < 1,
    refetchInterval: (q) => pollEvery(q.state.data),
  })
  const d = detail.data
  const handle = d?.channel?.handle
  const channel = useQuery({
    queryKey: ["channel", handle, signedIn],
    enabled: Boolean(handle),
    queryFn: () => getJson<ChannelDetail>(`/api/video/channels/${handle}`),
  })
  const support = useChannelSupport(handle, Boolean(d))
  useTitle(d?.title)

  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["live", publicId] })
  }, [qc, publicId])

  const open = Boolean(d && !d.locked && (d.status === "live" || d.status === "scheduled"))
  const room = useLiveRoom(publicId, {
    connect: open,
    canRead: Boolean(d && !d.locked),
    myUserId: me?.id,
    seedPinned: d?.pinned,
    onStatus: (status) => {
      if (status !== d?.status) refresh()
    },
  })

  const pb = d?.status === "live" ? d.playback : null
  useEffect(() => {
    if (!pb) {
      if (d && d.status !== "live") setSrc(null)
      return
    }
    setSrc((cur) => {
      if (!cur || (cur.exp && cur.exp * 1000 - Date.now() < 10 * 60_000)) return { url: pb.url, exp: pb.expires_at ?? 0 }
      return cur
    })
  }, [pb?.url, d?.status])

  if (detail.isError && errStatus(detail.error) === 404) return <NotFound what="live stream" />
  if (!d) {
    return (
      <div className="mx-auto max-w-[1700px] sm:px-6 sm:py-6">
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-6">
          <Skel className="aspect-video w-full rounded-none sm:rounded-2xl" />
          <Skel className="mt-4 h-[420px] w-full rounded-2xl lg:mt-0" />
        </div>
      </div>
    )
  }

  const money = support.data
  const tiers = money?.tiers.filter((t) => t.is_active) ?? []
  const canPay = Boolean(
    money?.can_take_money && !money.is_owner && !d.is_owner && d.status === "live" && !d.locked &&
    ((money.superchat_tiers?.length ?? 0) > 0 || (money.gifts?.length ?? 0) > 0),
  )
  const openSupport = (mode: SupportMode) => {
    if (!signedIn) {
      navigate(loginPath())
      return
    }
    setSupportMode(mode)
    setSupportUsed(true)
    setSupportOpen(true)
  }
  const askReport = (target: ReportTarget) => {
    if (!signedIn) navigate(loginPath())
    else setReport(target)
  }
  const viewers = room.viewers ?? d.viewers
  const live = d.status === "live"

  return (
    <div className="mx-auto max-w-[1700px] sm:px-6 sm:py-6">
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-6">
        <div className="min-w-0">
          <div className="relative bg-black sm:rounded-2xl">
            {d.locked ? (
              <Locked stream={d} canJoin={Boolean(money?.can_take_money && tiers.length)} onJoin={() => setJoinOpen(true)} />
            ) : d.status === "scheduled" ? (
              <Scheduled stream={d} />
            ) : live && src ? (
              <HlsPlayer key={src.url} src={src.url} live autoPlay className="aspect-video w-full sm:rounded-2xl">
                <div className="absolute left-2 top-2 flex items-center gap-1.5">
                  <LiveBadge />
                  <span className="rounded-md bg-black/80 px-1.5 py-0.5 text-[11px] font-semibold text-white">{watching(viewers)}</span>
                </div>
              </HlsPlayer>
            ) : live ? (
              <div className={STAGE}>
                <Radio size={30} className="text-[#f87171]" aria-hidden="true" />
                <p className="inline-flex items-center gap-2 text-sm text-muted"><Loader2 size={15} className="animate-spin" aria-hidden="true" /> The stream is starting…</p>
              </div>
            ) : (
              <Ended stream={d} />
            )}
          </div>

          <div className="space-y-4 px-3 pt-4 sm:px-0">
            <div>
              <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                {live ? <LiveBadge /> : d.status === "scheduled" ? (
                  <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-ink">Upcoming</span>
                ) : (
                  <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-ink">Ended</span>
                )}
                {live && <span className="inline-flex items-center gap-1"><Users size={13} aria-hidden="true" /> {compactNumber(viewers)} watching</span>}
                {live && d.started_at && <span>· Started {timeAgo(d.started_at)}</span>}
                {d.status === "ended" && d.peak_viewers > 0 && <span>Peak {compactNumber(d.peak_viewers)} watching</span>}
                {d.members_rank ? <span className="inline-flex items-center gap-1 rounded-md bg-[#FACC15] px-1.5 py-0.5 text-[11px] font-bold text-black"><Lock size={11} aria-hidden="true" /> Members only</span> : null}
              </div>
              <h1 className="text-lg font-bold leading-snug sm:text-xl">{d.title}</h1>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {d.channel && (
                <div className="flex min-w-0 items-center gap-3">
                  <Link to={`/@${d.channel.handle}`} aria-hidden="true" tabIndex={-1}>
                    <ChannelAvatar channel={d.channel} size={40} className={cn(live && "ring-2 ring-[#dc2626]")} />
                  </Link>
                  <div className="min-w-0">
                    <ChannelName channel={d.channel} className="text-sm font-semibold" />
                    <p className="text-xs text-muted">{compactNumber(d.channel.followers)} {d.channel.followers === 1 ? "follower" : "followers"}</p>
                  </div>
                </div>
              )}
              {d.channel && !d.is_owner && <FollowButton handle={d.channel.handle} following={Boolean(channel.data?.following)} />}
              <div className="flex-1" />
              {canPay && (money?.superchat_tiers?.length ?? 0) > 0 && (
                <Btn tone="soft" onClick={() => openSupport("superchat")}><MessageSquareHeart size={16} className="text-[#FACC15]" aria-hidden="true" /> Super chat</Btn>
              )}
              {canPay && (money?.gifts?.length ?? 0) > 0 && (
                <Btn tone="soft" onClick={() => openSupport("gift")}><Gift size={16} className="text-brand-soft" aria-hidden="true" /> Send a gift</Btn>
              )}
              {!d.is_owner && (
                <Btn tone="soft" onClick={() => askReport({ type: "live", id: d.id, label: "live stream" })} aria-label="Report live stream">
                  <Flag size={16} aria-hidden="true" /> <span className="hidden sm:inline">Report</span>
                </Btn>
              )}
            </div>

            {d.description && (
              <div className="rounded-2xl bg-panel p-3 text-sm sm:p-4">
                {d.scheduled_at && d.status === "scheduled" && <p className="mb-1 font-semibold text-ink">Scheduled for {longDate(d.scheduled_at)}</p>}
                <p className="whitespace-pre-wrap break-words leading-relaxed text-ink/85">{d.description}</p>
              </div>
            )}
          </div>
        </div>

        <aside className="mt-4 px-3 pb-4 sm:px-0 lg:mt-0 lg:pb-0">
          {d.locked ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-line bg-panel p-6 text-center">
              <Lock size={22} className="text-brand-soft" aria-hidden="true" />
              <p className="text-sm font-semibold">Members-only chat</p>
              <p className="max-w-xs text-xs text-muted">Join the channel's membership to watch and chat.</p>
            </div>
          ) : (
            <LiveChat
              stream={d}
              room={room}
              support={money}
              onRefresh={refresh}
              onSupport={canPay && (money?.superchat_tiers?.length ?? 0) > 0 ? () => openSupport("superchat") : undefined}
              onReport={(m) => askReport({ type: "live_message", id: m.id, label: "message" })}
              className="h-[70dvh] lg:sticky lg:top-20 lg:h-[calc(100dvh-7rem)]"
            />
          )}
        </aside>
      </div>

      <ReportDialog target={report} onClose={() => setReport(null)} />

      {money && d.channel && supportUsed && (
        <Suspense fallback={null}>
          <LiveSupportSheet
            open={supportOpen && canPay}
            onClose={() => setSupportOpen(false)}
            mode={supportMode}
            streamId={d.id}
            support={money}
            channelName={d.channel.name}
            onPaid={refresh}
          />
        </Suspense>
      )}

      {money && d.channel && (
        <Sheet open={joinOpen} onClose={() => setJoinOpen(false)} title={`Join ${d.channel.name}`} wide>
          <MembershipTiers
            support={money}
            channelName={d.channel.name}
            onJoined={() => {
              setJoinOpen(false)
              qc.invalidateQueries({ queryKey: ["support", handle] })
              refresh()
            }}
          />
        </Sheet>
      )}
    </div>
  )
}
