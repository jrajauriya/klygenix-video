import { useEffect, useRef } from "react"
import type { UserInfo } from "@klygenixvideo/types"
import { api } from "./api"
import { useAuthStore } from "./store"

export async function openSignedIn(base: string, path = "/", newTab = false) {
  const plain = `${base}${path}`
  const tab = newTab ? window.open("", "_blank") : null
  if (tab) tab.opener = null
  const go = (url: string) => (tab ? tab.location.replace(url) : window.location.assign(url))
  if (!useAuthStore.getState().token) {
    go(plain)
    return
  }
  try {
    const { data } = await api.post<{ code: string }>("/api/auth/handoff")
    go(`${base}/auth/continue#code=${encodeURIComponent(data.code)}&next=${encodeURIComponent(path)}`)
  } catch {
    go(plain)
  }
}

function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/"
}

export function HandoffPage() {
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    const onDone = (path: string) => window.location.replace(path)
    const params = new URLSearchParams(window.location.hash.slice(1))
    const code = params.get("code")
    const next = safeNext(params.get("next"))
    window.history.replaceState(null, "", window.location.pathname)
    if (!code) {
      onDone(useAuthStore.getState().token ? next : "/login")
      return
    }
    const base = String(api.defaults.baseURL ?? "").replace(/\/$/, "")
    fetch(`${base}/api/auth/handoff/redeem`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) })
      .then((r) => (r.ok ? (r.json() as Promise<{ access_token: string; user: UserInfo }>) : Promise.reject(r.status)))
      .then((data) => {
        useAuthStore.getState().setAuth(data.access_token, data.user)
        onDone(next)
      })
      .catch(() => onDone(useAuthStore.getState().token ? next : "/login"))
  }, [])

  return (
    <div role="status" aria-live="polite" className="flex min-h-screen items-center justify-center text-sm opacity-70">
      Signing you in…
    </div>
  )
}
