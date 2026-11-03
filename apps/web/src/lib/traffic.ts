import { useEffect } from "react"
import { useLocation } from "react-router-dom"

export type TrafficSource = { src: string; ref?: string }

const SOURCES = ["home", "reels", "search", "channel", "related", "playlist", "share", "follow", "direct", "external"]
const trail = new Map<string, { pathname: string; search: string } | null>()
let last: { key: string; pathname: string; search: string } | null = null

export function useNavTrail() {
  const loc = useLocation()
  if (!trail.has(loc.key)) trail.set(loc.key, last && last.key !== loc.key ? { pathname: last.pathname, search: last.search } : null)
  useEffect(() => {
    last = { key: loc.key, pathname: loc.pathname, search: loc.search }
  }, [loc.key, loc.pathname, loc.search])
}

function external(): TrafficSource {
  const ref = typeof document !== "undefined" ? document.referrer : ""
  if (ref) {
    try {
      if (new URL(ref).origin !== window.location.origin) return { src: "external", ref: ref.slice(0, 300) }
    } catch {
      return { src: "direct" }
    }
  }
  return { src: "direct" }
}

export function trafficSource(key: string, search: string): TrafficSource {
  const params = new URLSearchParams(search)
  const explicit = params.get("src")
  if (explicit && SOURCES.includes(explicit)) return explicit === "external" ? external() : { src: explicit }
  const prev = trail.get(key)
  if (!prev) return external()
  if (params.get("list")) return { src: "playlist" }
  const p = prev.pathname
  if (p === "/") return { src: "home" }
  if (p.startsWith("/reels")) return { src: "reels" }
  if (p.startsWith("/search")) return { src: "search" }
  if (p.startsWith("/@")) return { src: "channel" }
  if (p.startsWith("/playlist")) return { src: "playlist" }
  if (p.startsWith("/watch")) return { src: "related" }
  return { src: "direct" }
}
