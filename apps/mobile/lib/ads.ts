import { useCallback, useEffect, useRef, useState } from "react"

import { api } from "./api"

export interface Ad {
  token: string
  brand: string
  label: string
  skip_after_seconds: number
  click_url: string
  duration_ms: number
  playback: { url: string }
}

interface AdBreaks {
  eligible: boolean
  pre: boolean
  mid: number[]
}

export type AdPhase = "checking" | "ad" | "content"

export function sendAdEvent(token: string, event: string): void {
  api.post("/api/video/ads/events", { token, event }).catch(() => null)
}

async function decide(publicId: string, slot: "pre" | "mid"): Promise<Ad | null> {
  const { data } = await api.get<{ ad: Ad | null }>("/api/video/ads/decision", { params: { video: publicId, slot } })
  return data.ad
}

export function useAdBreaks(publicId: string | undefined, enabled: boolean, startMs: number) {
  const [phase, setPhase] = useState<AdPhase>("checking")
  const [ad, setAd] = useState<Ad | null>(null)
  const phaseRef = useRef<AdPhase>("checking")
  const mids = useRef<number[]>([])
  const asking = useRef(false)

  const go = useCallback((next: AdPhase, nextAd: Ad | null = null) => {
    phaseRef.current = next
    setAd(nextAd)
    setPhase(next)
  }, [])

  useEffect(() => {
    if (!publicId) return
    if (!enabled) {
      go("content")
      return
    }
    let alive = true
    go("checking")
    mids.current = []
    const fallback = setTimeout(() => alive && phaseRef.current === "checking" && go("content"), 5000)
    ;(async () => {
      try {
        const { data } = await api.get<AdBreaks>("/api/video/ads/breaks", { params: { video: publicId } })
        mids.current = (data.mid ?? []).filter((m) => m > startMs + 1000)
        if (!data.eligible || !data.pre) {
          if (alive && phaseRef.current === "checking") go("content")
          return
        }
        const found = await decide(publicId, "pre")
        if (alive && phaseRef.current === "checking") go(found ? "ad" : "content", found)
      } catch {
        if (alive && phaseRef.current === "checking") go("content")
      }
    })()
    return () => {
      alive = false
      clearTimeout(fallback)
    }
  }, [publicId, enabled])

  const onContentTime = useCallback(
    (seconds: number) => {
      if (!publicId || phaseRef.current !== "content" || asking.current) return
      const ms = seconds * 1000
      const due = mids.current.find((m) => ms >= m && ms < m + 20_000)
      if (due === undefined) return
      mids.current = mids.current.filter((m) => m !== due)
      asking.current = true
      go("checking")
      decide(publicId, "mid")
        .then((found) => go(found ? "ad" : "content", found))
        .catch(() => go("content"))
        .finally(() => {
          asking.current = false
        })
    },
    [publicId, go],
  )

  const finish = useCallback(() => go("content"), [go])

  return { phase, ad, onContentTime, finish }
}
