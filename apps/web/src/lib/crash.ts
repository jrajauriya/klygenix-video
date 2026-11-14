import { useAuthStore } from "@klygenixvideo/auth"
import { API_BASE } from "./api"

const RELOADED = "kv-chunk-reload"
const CHUNK = /dynamically imported module|Importing a module script failed|ChunkLoadError|Unable to preload CSS|error loading dynamically/i

export function isChunkError(error: unknown): boolean {
  const e = error as { message?: string; name?: string } | undefined
  return CHUNK.test(`${e?.name ?? ""} ${e?.message ?? String(error ?? "")}`)
}

export function reloadOnce(): boolean {
  try {
    if (sessionStorage.getItem(RELOADED) === location.pathname) return false
    sessionStorage.setItem(RELOADED, location.pathname)
  } catch {
    return false
  }
  location.reload()
  return true
}

export function reportClientError(error: unknown) {
  const e = error as { message?: string; name?: string; statusText?: string } | undefined
  const body = JSON.stringify({
    app: "web",
    path: location.pathname,
    user: String(useAuthStore.getState().user?.id ?? ""),
    name: e?.name ?? "",
    message: (e?.message ?? e?.statusText ?? String(error ?? "")).slice(0, 600),
  })
  void fetch(`${API_BASE}/api/observe/client-error`, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => undefined)
}

export function settleReloads() {
  window.setTimeout(() => {
    try {
      sessionStorage.removeItem(RELOADED)
    } catch {
      return
    }
  }, 10000)
}
