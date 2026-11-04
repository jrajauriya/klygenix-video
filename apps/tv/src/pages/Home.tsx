import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { getJson, useSignedIn } from "../lib/api"
import { useT } from "../lib/i18n"
import type { HistoryItem, LiveStreamCard, Subscriptions, VideoCard } from "../lib/types"
import { LiveTile, Row, Status, VideoTile } from "../components/Tiles"

export default function Home() {
  const signedIn = useSignedIn()
  const t = useT()
  const home = useQuery({ queryKey: ["feed", "home"], queryFn: () => getJson<VideoCard[]>("/api/video/feed/home", { limit: 30 }) })
  const live = useQuery({ queryKey: ["live", "now"], queryFn: () => getJson<LiveStreamCard[]>("/api/video/live", { limit: 20 }), refetchInterval: 60_000 })
  const reels = useQuery({ queryKey: ["feed", "reels"], queryFn: () => getJson<VideoCard[]>("/api/video/feed/reels", { limit: 20 }) })
  const history = useQuery({
    queryKey: ["history", signedIn],
    enabled: signedIn,
    queryFn: () => getJson<HistoryItem[]>("/api/video/me/history", { limit: 20 }),
  })
  const subs = useQuery({
    queryKey: ["feed", "subscriptions", "row", signedIn],
    enabled: signedIn,
    staleTime: 0,
    queryFn: () => getJson<Subscriptions>("/api/video/feed/subscriptions", { limit: 24, mark_seen: false }),
  })

  const resume = (history.data ?? []).filter((v) => !v.completed && v.position_ms > 5000)
  const longs = (home.data ?? []).filter((v) => v.kind === "long")
  const streams = live.data ?? []
  const shorts = reels.data ?? []
  const follows = subs.data?.items ?? []
  const fresh = subs.data?.new_count ?? 0
  const firstRow = resume.length ? "continue" : longs.length ? "home" : streams.length ? "live" : "reels"

  return (
    <>
      <h1 className="sr-only">{t("Home")}</h1>
      {home.isLoading && <Status>{t("Loading videos…")}</Status>}
      {home.isError && <Status>{t("The home feed did not load. Try again in a moment.")}</Status>}
      {resume.length > 0 && (
        <Row id="continue" title={t("Continue watching")}>
          {resume.map((v, i) => (
            <VideoTile key={v.id} video={v} group="continue" src="home" auto={firstRow === "continue" && i === 0} progress={v.duration_ms ? v.position_ms / v.duration_ms : 0} />
          ))}
        </Row>
      )}
      {longs.length > 0 && (
        <Row id="home" title={t("Recommended")}>
          {longs.map((v, i) => <VideoTile key={v.id} video={v} group="home" src="home" auto={firstRow === "home" && i === 0} />)}
        </Row>
      )}
      {streams.length > 0 && (
        <Row id="live" title={t("Live now")}>
          {streams.map((s, i) => <LiveTile key={s.id} stream={s} group="live" auto={firstRow === "live" && i === 0} />)}
        </Row>
      )}
      {follows.length > 0 && (
        <Row id="subscriptions" title={fresh > 0 ? t("Subscriptions · {n} new", { n: fresh }) : t("Subscriptions")}>
          {follows.map((v) => <VideoTile key={v.id} video={v} group="subscriptions" src="follow" />)}
          <Link
            to="/subscriptions"
            data-focus-id="subscriptions:all"
            className="flex aspect-video w-[18rem] shrink-0 items-center justify-center self-start rounded-2xl bg-panel-3 p-6 text-center text-2xl font-semibold text-ink"
          >
            {t("See all subscriptions")} ›
          </Link>
        </Row>
      )}
      {shorts.length > 0 && (
        <Row id="reels" title={t("Reels")}>
          {shorts.map((v, i) => <VideoTile key={v.id} video={v} group="reels" src="reels" auto={firstRow === "reels" && i === 0} />)}
        </Row>
      )}
      {!home.isLoading && !longs.length && !streams.length && !shorts.length && <Status>{t("Nothing to watch yet.")}</Status>}
    </>
  )
}
