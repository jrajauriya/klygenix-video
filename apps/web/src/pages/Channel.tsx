import { useState } from "react"
import { useParams } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { BadgeCheck, Clapperboard, Flag, ListVideo, Video } from "lucide-react"
import { PageShell } from "../components/Layout"
import { CardSkeletons, ChannelAvatar, Empty, Skel, Tabs } from "../components/bits"
import { FollowButton } from "../components/FollowButton"
import { PlaylistTile } from "../components/Playlists"
import { ReportDialog, type ReportTarget } from "../components/ReportDialog"
import { ReelTile, VideoGridCard } from "../components/VideoCards"
import { errStatus, getJson, useMe, useSignedIn } from "../lib/api"
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
  const [tab, setTab] = useState<"long" | "reel" | "playlists">("long")
  const [report, setReport] = useState<ReportTarget | null>(null)
  const ch = useQuery({
    queryKey: ["channel", handle, signedIn],
    queryFn: () => getJson<ChannelDetail>(`/api/video/channels/${handle}`),
    retry: (n, err) => errStatus(err) !== 404 && n < 1,
  })
  const vids = useQuery({
    queryKey: ["channel", handle, "videos", tab],
    enabled: ch.isSuccess && tab !== "playlists",
    queryFn: () => getJson<VideoCard[]>(`/api/video/channels/${handle}/videos`, { kind: tab, limit: 48 }),
  })
  const lists = useQuery({
    queryKey: ["channel", handle, "playlists"],
    enabled: ch.isSuccess,
    queryFn: () => getJson<PlaylistSummary[]>(`/api/video/channels/${handle}/playlists`),
  })
  useTitle(ch.data?.name)

  if (ch.isError) return <NotFound what="channel" />
  const c = ch.data
  const mine = me?.channel?.handle === handle

  return (
    <div>
      <div className="relative h-32 w-full overflow-hidden bg-gradient-to-br from-[#4A044E] via-[#1b1b27] to-[#0b0b12] sm:h-48 lg:h-56">
        {c?.banner && <img src={c.banner} alt="" className="h-full w-full object-cover" />}
      </div>
      <PageShell className="-mt-10 sm:-mt-14">
        {!c ? (
          <div className="flex items-end gap-4"><Skel className="h-24 w-24 rounded-full" /><div className="space-y-2"><Skel className="h-6 w-48" /><Skel className="h-4 w-32" /></div></div>
        ) : (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <ChannelAvatar channel={c} size={104} className="ring-4 ring-bg" />
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
            </div>
            <div className="flex items-center gap-2">
              {!mine && <FollowButton handle={c.handle} following={c.following} />}
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
          ]}
        />

        <div className="mt-6">
          {tab === "playlists" ? (
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
    </div>
  )
}
