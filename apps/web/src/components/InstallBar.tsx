import { useEffect, useState } from "react"
import { X } from "lucide-react"
import { Btn } from "./bits"
import { isPhoneOrTablet, useInstallPrompt, useInstallSheetOpen } from "../pwa"
import { useT } from "../i18n"

const VISITS = "kv:install:visits"
const HIDDEN = "kv:install:hidden-until"
const DAY = 86_400_000

function read(key: string): number {
  try {
    return Number(window.localStorage.getItem(key) || 0)
  } catch {
    return 0
  }
}

function write(key: string, value: number) {
  try {
    window.localStorage.setItem(key, String(value))
  } catch {
    return
  }
}

export function InstallBar() {
  const t = useT()
  const { available, install } = useInstallPrompt()
  const [show, setShow] = useState(false)
  const sheet = useInstallSheetOpen()

  useEffect(() => {
    if (sheet) setShow(false)
  }, [sheet])

  useEffect(() => {
    if (!available || !isPhoneOrTablet()) return
    const visits = firstViewThisVisit() ? read(VISITS) + 1 : read(VISITS)
    write(VISITS, visits)
    if (visits >= 2 && read(HIDDEN) < Date.now()) setShow(true)
  }, [available])

  if (!show || !available) return null
  return (
    <div role="region" aria-label={t("Get the app")} className="fixed inset-x-2 bottom-[calc(3.75rem+env(safe-area-inset-bottom))] z-30 flex items-center gap-3 rounded-2xl border border-line bg-panel/95 p-2.5 shadow-2xl backdrop-blur-md md:hidden">
      <img src="/icon-192.png" alt="" width={40} height={40} className="size-10 rounded-xl" />
      <p className="min-w-0 flex-1 text-sm font-semibold leading-tight">
        {t("Get the Klygenix Play app")}
        <span className="block text-xs font-normal text-muted">{t("Free, opens like an app")}</span>
      </p>
      <Btn tone="brand" size="sm" onClick={() => void install()}>{t("Install")}</Btn>
      <button
        type="button"
        onClick={() => { write(HIDDEN, Date.now() + 30 * DAY); setShow(false) }}
        aria-label={t("Not now")}
        className="rounded-full p-1.5 text-muted hover:bg-white/10 hover:text-ink"
      >
        <X size={18} aria-hidden="true" />
      </button>
    </div>
  )
}

function firstViewThisVisit(): boolean {
  try {
    if (window.sessionStorage.getItem("kv:install:counted")) return false
    window.sessionStorage.setItem("kv:install:counted", "1")
    return true
  } catch {
    return false
  }
}
