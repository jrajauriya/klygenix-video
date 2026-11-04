import { useSyncExternalStore } from "react"

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

let deferred: InstallPromptEvent | null = null
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault()
    deferred = e as InstallPromptEvent
    emit()
  })
  window.addEventListener("appinstalled", () => {
    deferred = null
    emit()
  })
}

export function registerServiceWorker() {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return
  const start = () => window.setTimeout(() => navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined), 4000)
  if (document.readyState === "complete") start()
  else window.addEventListener("load", start, { once: true })
}

export function useInstallPrompt() {
  const available = useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => {
        listeners.delete(l)
      }
    },
    () => deferred !== null,
    () => false,
  )
  async function install() {
    const e = deferred
    if (!e) return
    deferred = null
    emit()
    await e.prompt().catch(() => undefined)
  }
  return { available, install }
}
