import { useSyncExternalStore } from "react"

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

export type InstallMode = "prompt" | "ios" | "ios-other" | "mac-safari" | "android-manual" | "in-app" | "desktop-other" | "installed"

let deferred: InstallPromptEvent | null = null
let installed = false
let sheetOpen = false
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

function standalone(): boolean {
  if (typeof window === "undefined") return false
  const nav = navigator as Navigator & { standalone?: boolean }
  return nav.standalone === true || window.matchMedia("(display-mode: standalone)").matches
    || window.matchMedia("(display-mode: window-controls-overlay)").matches
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault()
    deferred = e as InstallPromptEvent
    emit()
  })
  window.addEventListener("appinstalled", () => {
    deferred = null
    installed = true
    sheetOpen = false
    emit()
  })
  window.matchMedia("(display-mode: standalone)").addEventListener?.("change", emit)
}

export function detectMode(ua: string, touchMac: boolean, hasPrompt: boolean, isStandalone: boolean): InstallMode {
  if (isStandalone) return "installed"
  if (/FBAN|FBAV|FB_IAB|Instagram|Line\/|LinkedInApp|Snapchat|WhatsApp|Twitter|MicroMessenger|GSA\//i.test(ua)) return "in-app"
  if (hasPrompt) return "prompt"
  const ios = /iPhone|iPad|iPod/i.test(ua) || touchMac
  if (ios) return /CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua) ? "ios-other" : "ios"
  if (/Android/i.test(ua)) return "android-manual"
  if (/Macintosh/i.test(ua) && /Safari/i.test(ua) && !/Chrome|Chromium|Edg|Firefox/i.test(ua)) return "mac-safari"
  return "desktop-other"
}

function currentMode(): InstallMode {
  if (typeof window === "undefined") return "installed"
  const touchMac = /Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1
  return detectMode(navigator.userAgent, touchMac, deferred !== null, installed || standalone())
}

export function isPhoneOrTablet(): boolean {
  const m = currentMode()
  return m === "ios" || m === "ios-other" || m === "android-manual" || m === "in-app" || (m === "prompt" && /Android/i.test(navigator.userAgent))
}

export function registerServiceWorker() {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return
  const start = () => window.setTimeout(() => navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined), 4000)
  if (document.readyState === "complete") start()
  else window.addEventListener("load", start, { once: true })
}

export function closeInstallSheet() {
  sheetOpen = false
  emit()
}

export function useInstallSheetOpen() {
  return useSyncExternalStore(subscribe, () => sheetOpen, () => false)
}

export function useInstallPrompt() {
  const mode = useSyncExternalStore(subscribe, currentMode, () => "installed" as InstallMode)
  async function install() {
    const e = deferred
    if (!e) {
      sheetOpen = true
      emit()
      return
    }
    await e.prompt().catch(() => undefined)
    const choice = await e.userChoice.catch(() => null)
    if (choice?.outcome === "accepted") installed = true
    deferred = null
    emit()
  }
  return { mode, available: mode !== "installed", install }
}
