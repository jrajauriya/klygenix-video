import { useState } from "react"
import { Link, useParams } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { api, errStatus, errText, getJson, useSignedIn } from "../lib/api"
import type { ChannelDetail, LiveStreamCard, VideoCard } from "../lib/types"
import { LiveTile, Phone, Row, Status, VideoTile } from "../components/Tiles"

export default function Channel() {
  const { handle = "" } = useParams()
  const signedIn = useSignedIn()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState("")
  const channel = useQuery({
    queryKey: ["channel", handle, signedIn],
    queryFn: () => getJson<ChannelDetail>(`/api/video/channels/${handle}`),
    retry: (count, err) => errStatus(err) !== 404 && count < 1,
  })
  const videos = useQuery({ queryKey: ["channel", handle, "long"], queryFn: () => getJson<VideoCard[]>(`/api/video/channels/${handle}/videos`, { kind: "long", limit: 30 }) })
  const reels = useQuery({ queryKey: ["channel", handle, "reel"], queryFn: () => getJson<VideoCard[]>(`/api/video/channels/${handle}/videos`, { kind: "reel", limit: 30 }) })
  const live = useQuery({ queryKey: ["channel", handle, "live"], queryFn: () => getJson<LiveStreamCard[]>(`/api/video/channels/${handle}/live`) })
  const c = channel.data

  if (channel.isLoading) return <Status>Loading channel…</Status>
  if (channel.isError || !c) {
    return (
      <div className="safe-x">
        <h1 className="text-5xl font-bold">{errStatus(channel.error) === 404 ? "This channel isn't here" : "The channel did not load"}</h1>
        <p className="mt-4 text-2xl text-muted">{errText(channel.error, "Try again in a moment.")}</p>
      </div>
    )
  }

  async function follow() {
    if (!c) return
    setBusy(true)
    setNote("")
    try {
      if (c.following) await api.delete(`/api/video/channels/${c.handle}/follow`)
      else await api.post(`/api/video/channels/${c.handle}/follow`)
      await qc.invalidateQueries({ queryKey: ["channel", handle] })
    } catch (err) {
      setNote(errText(err, "That did not work. Try again."))
    } finally {
      setBusy(false)
    }
  }

  const longs = videos.data ?? []
  const shorts = reels.data ?? []
  const streams = (live.data ?? []).filter((s) => s.status === "live" || s.status === "scheduled")
  return (
    <>
      <div className="safe-x flex items-start gap-10">
        <div className="flex h-[8rem] w-[8rem] shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand text-5xl font-bold text-white">
          {c.avatar ? <img src={c.avatar} alt="" className="h-full w-full object-cover" /> : c.name.slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-5xl font-bold">{c.name}</h1>
          <p className="mt-2 text-2xl text-muted">@{c.handle} · {c.followers} followers</p>
          {c.about && <p className="mt-3 line-clamp-2 max-w-[80rem] text-2xl">{c.about}</p>}
          <div className="mt-6 flex flex-wrap items-center gap-6" data-focus-group>
            {signedIn ? (
              <button type="button" onClick={follow} disabled={busy} data-autofocus aria-pressed={c.following}
                className={`rounded-full px-10 py-4 text-2xl font-semibold ${c.following ? "bg-panel-3 text-ink" : "bg-brand text-white"}`}>
                {c.following ? "Following" : "Follow"}
              </button>
            ) : (
              <Link to="/login" data-autofocus className="rounded-full bg-brand px-10 py-4 text-2xl font-semibold text-white">Sign in to follow</Link>
            )}
            {note && <p role="alert" className="text-2xl text-[#fda4af]">{note}</p>}
          </div>
          <div className="mt-6 max-w-[70rem]">
            <Phone what="Memberships, tips and paid videos are bought on the web." />
          </div>
        </div>
      </div>
      {streams.length > 0 && (
        <Row id="ch-live" title="Live">
          {streams.map((s) => <LiveTile key={s.id} stream={s} group="ch-live" />)}
        </Row>
      )}
      <Row id="ch-videos" title="Videos">
        {longs.length ? longs.map((v) => <VideoTile key={v.id} video={v} group="ch-videos" src="channel" />) : <p className="px-2 text-2xl text-muted">{videos.isLoading ? "Loading…" : "No videos yet."}</p>}
      </Row>
      {shorts.length > 0 && (
        <Row id="ch-reels" title="Reels">
          {shorts.map((v) => <VideoTile key={v.id} video={v} group="ch-reels" src="channel" />)}
        </Row>
      )}
    </>
  )
}
