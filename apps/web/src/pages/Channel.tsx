import { useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { BadgeCheck, Clapperboard, Coins, Crown, Flag, ListVideo, Megaphone, MessageCircleQuestion, Video } from "lucide-react"
import { PageShell } from "../components/Layout"
import { Btn, CardSkeletons, ChannelAvatar, Empty, Skel, Tabs } from "../components/bits"
import { FollowButton } from "../components/FollowButton"
import { ChannelLiveLink, LiveBadge, useChannelLiveNow } from "../components/Live"
import { PlaylistTile } from "../components/Playlists"
import { ReportDialog, type ReportTarget } from "../components/ReportDialog"
import { MembershipTiers, TipSheet } from "../components/Support"
import { useChannelSupport } from "../lib/support"
import { CommunityPosts } from "../components/Community"
import { ScopedAsk } from "../components/ScopedAsk"
import { ReelTile, VideoGridCard } from "../components/VideoCards"
import { errStatus, getJson, loginPath, useMe, useSignedIn } from "../lib/api"
import { compactNumber, longDate } from "../lib/format"
import { useTitle } from "../lib/title"
import type { ChannelDetail, PlaylistSummary, VideoCard } from "../lib/types"
import NotFound from "./NotFound"

export default function ChannelPage() {
  const { channel: raw = "" } = useParams()
  if (!raw.startsWith("@") || raw.length < 2) return <NotFound />
  return <Channel handle={raw.slice(1).toLowerCase()} />
}

function Channel({ handle }: { handle: string }) {
  const signedIn = useSignedIn()
  const { data: me } = useMe()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [tab, setTab] = useState<"long" | "reel" | "playlists" | "community" | "ask" | "membership">("long")
  const [tipOpen, setTipOpen] = useState(false)
  const [report, setReport] = useState<ReportTarget | null>(null)
  const ch = useQuery({
    queryKey: ["channel", handle, signedIn],
    queryFn: () => getJson<ChannelDetail>(`/api/video/channels/${handle}`),
    retry: (n, err) => errStatus(err) !== 404 && n < 1,
  })
  const vids = useQuery({
    queryKey: ["channel", handle, "videos", tab],
    enabled: ch.isSuccess && (tab === "long" || tab === "reel"),
    queryFn: () => getJson<VideoCard[]>(`/api/video/channels/${handle}/videos`, { kind: tab, limit: 48 }),
  })
  const lists = useQuery({
    queryKey: ["channel", handle, "playlists"],
    enabled: ch.isSuccess,
    queryFn: () => getJson<PlaylistSummary[]>(`/api/video/channels/${handle}/playlists`),
  })
  const support = useChannelSupport(handle, ch.isSuccess)
  const onAir = useChannelLiveNow(handle, ch.isSuccess)
  useTitle(ch.data?.name)

  if (ch.isError) return <NotFound what="channel" />
  const c = ch.data
  const mine = me?.channel?.handle === handle
  const money = support.data
  const hasTiers = (money?.tiers ?? []).some((t) => t.is_active)
  const canTip = Boolean(money?.can_take_money && !money.is_owner && !mine)

  return (
    <div>
      <div className="relative h-32 w-full overflow-hidden bg-gradient-to-br from-[#4A044E] via-[#1b1b27] to-[#0b0b12] sm:h-48 lg:h-56">
        {c?.banner && <img src={c.banner} alt="" className="h-full w-full object-cover" />}
      </div>
      <PageShell className="relative -mt-10 sm:-mt-14">
        {!c ? (
          <div className="flex items-end gap-4"><Skel className="h-24 w-24 rounded-full" /><div className="space-y-2"><Skel className="h-6 w-48" /><Skel className="h-4 w-32" /></div></div>
        ) : (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="relative w-fit shrink-0">
              <ChannelAvatar channel={c} size={104} className={onAir.live ? "ring-4 ring-[#dc2626]" : "ring-4 ring-bg"} />
              {onAir.live && <LiveBadge className="absolute -bottom-1 left-1/2 -translate-x-1/2 ring-2 ring-bg" />}
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="flex items-center gap-2 text-2xl font-bold sm:text-3xl">
                <span className="truncate">{c.name}</span>
                {c.verified && <BadgeCheck size={22} className="shrink-0 text-brand-soft" aria-label="Verified" />}
              </h1>
              <p className="mt-1 text-sm text-muted">
                @{c.handle} · {compactNumber(c.followers)} {c.followers === 1 ? "follower" : "followers"}
                {c.created_at && <> · Joined {longDate(c.created_at)}</>}
              </p>
              {c.about && <p className="mt-2 line-clamp-3 max-w-2xl text-sm text-ink/80">{c.about}</p>}
              {(onAir.live || onAir.upcoming) && <div className="mt-3"><ChannelLiveLink live={onAir.live} upcoming={onAir.upcoming} /></div>}
            </div>
            <div className="flex items-center gap-2">
              {!mine && <FollowButton handle={c.handle} following={c.following} />}
              {canTip && (
                <Btn tone="soft" onClick={() => (signedIn ? setTipOpen(true) : navigate(loginPath()))}>
                  <Coins size={16} aria-hidden="true" /> Tip
                </Btn>
              )}
              {!mine && signedIn && (
                <button type="button" onClick={() => setReport({ type: "channel", id: c.handle, label: "channel" })} className="rounded-full bg-white/10 p-2.5 text-muted hover:bg-white/15 hover:text-ink" aria-label="Report channel">
                  <Flag size={16} />
                </button>
              )}
            </div>
          </div>
        )}

        <Tabs
          className="mt-6 border-b border-line pb-3"
          value={tab}
          onChange={setTab}
          tabs={[
            { key: "long", label: <span className="inline-flex items-center gap-1.5"><Video size={15} /> Videos</span> },
            { key: "reel", label: <span className="inline-flex items-center gap-1.5"><Clapperboard size={15} /> Reels</span> },
            { key: "playlists", label: <span className="inline-flex items-center gap-1.5"><ListVideo size={15} /> Playlists</span> },
            { key: "community", label: <span className="inline-flex items-center gap-1.5"><Megaphone size={15} /> Community</span> },
            { key: "ask", label: <span className="inline-flex items-center gap-1.5"><MessageCircleQuestion size={15} /> Ask</span> },
            ...(hasTiers ? [{ key: "membership" as const, label: <span className="inline-flex items-center gap-1.5"><Crown size={15} /> Membership</span> }] : []),
          ]}
        />

        <div className="mt-6">
          {tab === "community" ? (
            c ? <CommunityPosts handle={handle} channel={c} onJoin={hasTiers ? () => setTab("membership") : undefined} /> : <Skel className="h-40 w-full rounded-2xl" />
          ) : tab === "ask" ? (
            <div className="mx-auto max-w-2xl">
              <ScopedAsk endpoint={`/api/video/channels/${handle}/ask`} title="Ask this channel" blurb={`Ask a question and get answers from across ${c?.name ?? "this channel"}'s videos, with links to the moments they come from.`} />
            </div>
          ) : tab === "membership" ? (
            money && c ? <MembershipTiers support={money} channelName={c.name} onJoined={() => qc.invalidateQueries({ queryKey: ["support", handle] })} /> : <Skel className="h-64 w-full rounded-2xl" />
          ) : tab === "playlists" ? (
            lists.isLoading || ch.isLoading ? (
              <div className="grid gap-x-4 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4"><CardSkeletons count={4} /></div>
            ) : (lists.data ?? []).length === 0 ? (
              <Empty icon={<ListVideo size={30} />} title="No playlists yet" body="Playlists and series from this channel will show up here." />
            ) : (
              <div className="grid gap-x-4 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">{(lists.data ?? []).map((p) => <PlaylistTile key={p.id} playlist={p} />)}</div>
            )
          ) : vids.isLoading || ch.isLoading ? (
            <div className="grid gap-x-4 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4"><CardSkeletons count={4} /></div>
          ) : (vids.data ?? []).length === 0 ? (
            <Empty icon={tab === "reel" ? <Clapperboard size={30} /> : <Video size={30} />} title={tab === "reel" ? "No reels yet" : "No videos yet"} body="When this channel publishes, it will show up here." />
          ) : tab === "reel" ? (
            <div className="flex flex-wrap gap-3">{(vids.data ?? []).map((v) => <ReelTile key={v.id} video={v} />)}</div>
          ) : (
            <div className="grid gap-x-4 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">{(vids.data ?? []).map((v) => <VideoGridCard key={v.id} video={v} />)}</div>
          )}
        </div>
      </PageShell>
      <ReportDialog target={report} onClose={() => setReport(null)} />
      {money && c && canTip && <TipSheet open={tipOpen} onClose={() => setTipOpen(false)} support={money} name={c.name} />}
    </div>
  )
}
