import { useState } from "react"
import { Link } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { Clapperboard, History, Users, Video } from "lucide-react"
import { PageShell } from "../components/Layout"
import { Shelf } from "../components/Shelf"
import { CardSkeletons, Empty, Skel, Tabs } from "../components/bits"
import { ReelTile, Thumb, VideoGridCard } from "../components/VideoCards"
import { getJson, useSignedIn } from "../lib/api"
import type { HistoryItem, VideoCard } from "../lib/types"
import { useTitle } from "../lib/title"

const GRID = "grid gap-x-4 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4"

export default function HomePage() {
  useTitle(null)
  const signedIn = useSignedIn()
  const [tab, setTab] = useState<"all" | "following">("all")
  const home = useQuery({ queryKey: ["feed", "home"], queryFn: () => getJson<VideoCard[]>("/api/video/feed/home", { limit: 48 }) })
  const reels = useQuery({ queryKey: ["feed", "reels", "shelf"], queryFn: () => getJson<VideoCard[]>("/api/video/feed/reels", { limit: 20 }) })
  const following = useQuery({
    queryKey: ["feed", "following"],
    enabled: signedIn && tab === "following",
    queryFn: () => getJson<VideoCard[]>("/api/video/feed/following", { limit: 48 }),
  })
  const history = useQuery({
    queryKey: ["history"],
    enabled: signedIn,
    queryFn: () => getJson<HistoryItem[]>("/api/video/me/history", { limit: 20 }),
  })

  const resume = (history.data ?? []).filter((h) => h.kind === "long" && !h.completed && h.position_ms > 3000)
  const long = (home.data ?? []).filter((v) => v.kind !== "reel")

  return (
    <PageShell className="space-y-8">
      {signedIn && (
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { key: "all", label: "For you" },
            { key: "following", label: "Following" },
          ]}
        />
      )}

      {tab === "following" ? (
        <section>
          <h1 className="sr-only">Following</h1>
          {following.isLoading ? (
            <div className={GRID}><CardSkeletons /></div>
          ) : following.isError ? (
            <Empty title="Your following feed did not load" body="Check your connection and try again." />
          ) : (following.data ?? []).length === 0 ? (
            <Empty icon={<Users size={32} />} title="Nothing from channels you follow yet" body="Follow a channel from any video and its new uploads will show up here." />
          ) : (
            <div className={GRID}>
              {(following.data ?? []).map((v) => (
                <VideoGridCard key={v.id} video={v} to={v.kind === "reel" ? `/reels?start=${v.id}` : undefined} />
              ))}
            </div>
          )}
        </section>
      ) : (
        <>
          {resume.length > 0 && (
            <Shelf title="Continue watching" icon={<History size={18} className="text-brand-soft" />}>
              {resume.map((h) => (
                <Link key={h.id} to={`/watch/${h.id}`} className="group w-64 shrink-0 snap-start sm:w-72">
                  <Thumb video={h} className="aspect-video w-full" progress={h.duration_ms ? h.position_ms / h.duration_ms : 0} />
                  <p className="mt-2 line-clamp-2 text-sm font-semibold leading-snug">{h.title}</p>
                  <p className="mt-0.5 truncate text-xs text-muted">{h.channel?.name}</p>
                </Link>
              ))}
            </Shelf>
          )}

          {(reels.isLoading || (reels.data ?? []).length > 0) && (
            <Shelf
              title="Reels"
              icon={<Clapperboard size={18} className="text-brand-soft" />}
              action={<Link to="/reels" className="mr-2 text-sm font-semibold text-brand-soft hover:underline">Watch all</Link>}
            >
              {reels.isLoading
                ? Array.from({ length: 6 }, (_, i) => <Skel key={i} className="aspect-[9/16] w-36 shrink-0 rounded-xl sm:w-44" />)
                : (reels.data ?? []).map((v) => <ReelTile key={v.id} video={v} />)}
            </Shelf>
          )}

          <section>
            <div className="mb-4 flex items-center gap-2">
              <Video size={18} className="text-brand-soft" aria-hidden="true" />
              <h1 className="text-lg font-bold tracking-tight">Videos</h1>
            </div>
            {home.isLoading ? (
              <div className={GRID}><CardSkeletons /></div>
            ) : home.isError ? (
              <Empty title="Videos did not load" body="Check your connection and try again." />
            ) : long.length === 0 ? (
              <Empty icon={<Video size={32} />} title="No videos yet" body="When creators publish, their videos show up here." />
            ) : (
              <div className={GRID}>
                {long.map((v) => <VideoGridCard key={v.id} video={v} />)}
              </div>
            )}
          </section>
        </>
      )}
    </PageShell>
  )
}
