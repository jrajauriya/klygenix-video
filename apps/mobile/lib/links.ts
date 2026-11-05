const HANDLE = /^\/@([A-Za-z0-9_.-]{3,40})\/?$/
const REEL = /^\/reels\/([A-Za-z0-9_-]+)\/?$/
const MEDIA = /^\/(watch|live)\/[A-Za-z0-9_-]+\/?$/

export function appPath(path: string): string {
  let url: URL
  try {
    url = new URL(path, "https://app.invalid")
  } catch {
    return "/"
  }
  const web = url.protocol === "https:" || url.protocol === "http:"
  const p = web ? url.pathname : `/${url.host}${url.pathname}`.replace(/\/+$/, "") || "/"
  const handle = HANDLE.exec(p)
  if (handle) return `/channel/${handle[1]}`
  const reel = REEL.exec(p)
  if (reel) return `/watch/${reel[1]}`
  if (MEDIA.test(p)) return p.replace(/\/$/, "") + url.search
  const token = url.searchParams.get("token")
  if (p === "/team/accept") return token ? `/team/accept?token=${encodeURIComponent(token)}` : "/team/accept"
  if (!web || url.host === "app.invalid") return p + url.search
  return "/"
}
