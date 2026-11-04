import { Suspense, lazy, useCallback, useEffect, useRef, useState, type RefObject } from "react"
import { useQuery } from "@tanstack/react-query"
import { api } from "@klygenixvideo/auth"
import type { AdCreative } from "@klygenixvideo/player/src/AdBreak"
import { getJson } from "../../lib/api"
import type { AdBreaks } from "../../lib/types"

const AdBreak = lazy(() => import("@klygenixvideo/player/src/AdBreak").then((m) => ({ default: m.AdBreak })))

export const adBreaksKey = (videoId: string, signedIn: boolean) => ["ad-breaks", videoId, signedIn]
export const fetchAdBreaks = (videoId: string) => getJson<AdBreaks>("/api/video/ads/breaks", { video: videoId })

interface Plan {
  video: string
  pre: boolean
  played: Set<number>
  first: number | null
  last: number | null
  busy: boolean
}

const fresh = (video: string): Plan => ({ video, pre: false, played: new Set(), first: null, last: null, busy: false })

export function useWatchAds({ videoId, signedIn, on, videoRef }: { videoId: string; signedIn: boolean; on: boolean; videoRef: RefObject<HTMLVideoElement | null> }) {
  const breaks = useQuery({
    queryKey: adBreaksKey(videoId, signedIn),
    enabled: Boolean(videoId),
    queryFn: () => fetchAdBreaks(videoId),
    staleTime: 5 * 60_000,
    retry: false,
  })
  const [ad, setAd] = useState<AdCreative | null>(null)
  const [holding, setHolding] = useState(false)
  const [muted, setMuted] = useState(false)
  const plan = useRef<Plan>(fresh(videoId))
  const live = useRef({ on, mids: [] as number[] })
  const eligible = Boolean(on && breaks.data?.eligible)
  live.current = { on: eligible, mids: breaks.data?.mid ?? [] }

  useEffect(() => {
    plan.current = fresh(videoId)
    setAd(null)
    setHolding(false)
  }, [videoId])

  const request = useCallback(async (slot: "pre" | "mid") => {
    const p = plan.current
    if (p.busy) return
    p.busy = true
    setHolding(true)
    try {
      const { data } = await api.get<{ ad: AdCreative | null }>("/api/video/ads/decision", { params: { video: p.video, slot }, timeout: 4000 })
      if (plan.current !== p) return
      if (data.ad && data.ad.playback?.type === "hls") {
        setMuted(Boolean(videoRef.current?.muted))
        setAd(data.ad)
        return
      }
    } catch {
      if (plan.current !== p) return
    }
    p.busy = false
    setHolding(false)
  }, [videoRef])

  useEffect(() => {
    const p = plan.current
    if (!eligible || !breaks.data?.pre || p.pre || p.video !== videoId) return
    p.pre = true
    if (p.first !== null && p.last !== null && p.last - p.first > 3000) return
    void request("pre")
  }, [eligible, breaks.data?.pre, videoId, request])

  const onTime = useCallback((ms: number) => {
    const p = plan.current
    const prev = p.last
    p.last = ms
    const { on: allowed, mids } = live.current
    if (prev === null) {
      p.first = ms
      for (const m of mids) if (m <= ms) p.played.add(m)
      return
    }
    if (!allowed || p.busy || ms <= prev) return
    const natural = ms - prev <= 2000
    let due = false
    for (const m of mids) {
      if (p.played.has(m) || m <= prev || ms < m) continue
      p.played.add(m)
      due = due || natural
    }
    if (due) void request("mid")
  }, [request])

  const done = useCallback(() => {
    plan.current.busy = false
    setAd(null)
    setHolding(false)
  }, [])

  const overlay = ad ? (
    <Suspense fallback={null}>
      <AdBreak key={ad.token} ad={ad} http={api} muted={muted} onDone={done} />
    </Suspense>
  ) : null

  return { held: holding || ad !== null, active: ad !== null, overlay, onTime }
}
