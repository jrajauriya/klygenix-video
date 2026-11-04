import { useQuery } from "@tanstack/react-query"
import { getJson, useSignedIn } from "../lib/api"
import type { HistoryItem, LiveStreamCard, VideoCard } from "../lib/types"
import { LiveTile, Row, Status, VideoTile } from "../components/Tiles"

export default function Home() {
  const signedIn = useSignedIn()
  const home = useQuery({ queryKey: ["feed", "home"], queryFn: () => getJson<VideoCard[]>("/api/video/feed/home", { limit: 30 }) })
  const live = useQuery({ queryKey: ["live", "now"], queryFn: () => getJson<LiveStreamCard[]>("/api/video/live", { limit: 20 }), refetchInterval: 60_000 })
  const reels = useQuery({ queryKey: ["feed", "reels"], queryFn: () => getJson<VideoCard[]>("/api/video/feed/reels", { limit: 20 }) })
  const history = useQuery({
    queryKey: ["history", signedIn],
    enabled: signedIn,
    queryFn: () => getJson<HistoryItem[]>("/api/video/me/history", { limit: 20 }),
  })
  const following = useQuery({
    queryKey: ["feed", "following", signedIn],
    enabled: signedIn,
    queryFn: () => getJson<VideoCard[]>("/api/video/feed/following", { limit: 30 }),
  })

  const resume = (history.data ?? []).filter((v) => !v.completed && v.position_ms > 5000)
  const longs = (home.data ?? []).filter((v) => v.kind === "long")
  const streams = live.data ?? []
  const shorts = reels.data ?? []
  const follows = following.data ?? []
  const firstRow = resume.length ? "continue" : longs.length ? "home" : streams.length ? "live" : "reels"

  return (
    <>
      <h1 className="sr-only">Home</h1>
      {home.isLoading && <Status>Loading videos…</Status>}
      {home.isError && <Status>The home feed did not load. Try again in a moment.</Status>}
      {resume.length > 0 && (
        <Row id="continue" title="Continue watching">
          {resume.map((v, i) => (
            <VideoTile key={v.id} video={v} group="continue" src="home" auto={firstRow === "continue" && i === 0} progress={v.duration_ms ? v.position_ms / v.duration_ms : 0} />
          ))}
        </Row>
      )}
      {longs.length > 0 && (
        <Row id="home" title="Recommended">
          {longs.map((v, i) => <VideoTile key={v.id} video={v} group="home" src="home" auto={firstRow === "home" && i === 0} />)}
        </Row>
      )}
      {streams.length > 0 && (
        <Row id="live" title="Live now">
          {streams.map((s, i) => <LiveTile key={s.id} stream={s} group="live" auto={firstRow === "live" && i === 0} />)}
        </Row>
      )}
      {follows.length > 0 && (
        <Row id="following" title="From channels you follow">
          {follows.map((v) => <VideoTile key={v.id} video={v} group="following" src="follow" />)}
        </Row>
      )}
      {shorts.length > 0 && (
        <Row id="reels" title="Reels">
          {shorts.map((v, i) => <VideoTile key={v.id} video={v} group="reels" src="reels" auto={firstRow === "reels" && i === 0} />)}
        </Row>
      )}
      {!home.isLoading && !longs.length && !streams.length && !shorts.length && <Status>Nothing to watch yet.</Status>}
    </>
  )
}
