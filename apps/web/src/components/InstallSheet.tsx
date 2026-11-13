import { useEffect, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { ArrowDown, ArrowUp, Copy, EllipsisVertical, MonitorDown, Share, SquarePlus } from "lucide-react"
import { toast } from "sonner"
import { Sheet } from "./Sheet"
import { Btn } from "./bits"
import { closeInstallSheet, useInstallPrompt, useInstallSheetOpen, type InstallMode } from "../pwa"
import { useT } from "../i18n"

function Key({ children }: { children: ReactNode }) {
  return <span className="mx-0.5 inline-flex items-center gap-1 rounded-md border border-line bg-white/10 px-1.5 py-0.5 align-middle text-[13px] font-semibold text-ink">{children}</span>
}

function Steps({ items }: { items: ReactNode[] }) {
  return (
    <ol className="space-y-3">
      {items.map((s, i) => (
        <li key={i} className="flex gap-3 text-sm leading-relaxed">
          <span aria-hidden="true" className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-bold text-white">{i + 1}</span>
          <span>{s}</span>
        </li>
      ))}
    </ol>
  )
}

function ipad() {
  return /iPad/i.test(navigator.userAgent) || (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
}

function Pointer({ mode, onDone }: { mode: InstallMode; onDone: () => void }) {
  const t = useT()
  const done = useRef(onDone)
  done.current = onDone
  useEffect(() => {
    const id = window.setTimeout(() => done.current(), 9000)
    return () => window.clearTimeout(id)
  }, [])
  const top = mode === "ios-other" || ipad()
  return createPortal(
    <button
      type="button"
      onClick={onDone}
      className={`fixed z-[1600] flex flex-col items-center gap-1 rounded-2xl bg-brand px-4 py-2 text-sm font-semibold text-white shadow-2xl ${top ? "right-3 top-2" : "bottom-3 left-1/2 -translate-x-1/2"}`}
    >
      {top && <ArrowUp size={22} className="animate-bounce" aria-hidden="true" />}
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">{t("Tap")} <Share size={16} aria-hidden="true" /> {t("Share, then Add to Home Screen")}</span>
      {!top && <ArrowDown size={22} className="animate-bounce" aria-hidden="true" />}
    </button>,
    document.body,
  )
}

export function InstallSheet() {
  const t = useT()
  const open = useInstallSheetOpen()
  const { mode } = useInstallPrompt()
  const [pointing, setPointing] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/?source=pwa`)
      toast.success(t("Link copied. Paste it in Safari or Chrome."))
    } catch {
      toast.error(t("Could not copy the link"))
    }
  }

  const share = <Key><Share size={14} aria-hidden="true" /> {t("Share")}</Key>
  const add = <Key><SquarePlus size={14} aria-hidden="true" /> {t("Add to Home Screen")}</Key>
  const menu = <Key><EllipsisVertical size={14} aria-hidden="true" /> {t("menu")}</Key>

  const body: Record<string, { lead: string; steps: ReactNode[] }> = {
    ios: {
      lead: t("Add Klygenix Play to your home screen. It opens full screen, like an app."),
      steps: [
        <>{t("Tap")} {share} {ipad() ? t("at the top of Safari.") : t("in Safari's bar at the bottom of the screen.")}</>,
        <>{t("Scroll down and tap")} {add}.</>,
        <>{t("Tap")} <Key>{t("Add")}</Key>. {t("Play is now on your home screen.")}</>,
      ],
    },
    "ios-other": {
      lead: t("Add Klygenix Play to your home screen. It opens full screen, like an app."),
      steps: [
        <>{t("Tap")} {share} {t("in the address bar at the top right.")}</>,
        <>{t("Tap")} {add}. {t("If you don't see it, tap More or open this page in Safari.")}</>,
        <>{t("Tap")} <Key>{t("Add")}</Key>. {t("Play is now on your home screen.")}</>,
      ],
    },
    "android-manual": {
      lead: t("Install Klygenix Play on your phone. It opens like any other app."),
      steps: [
        <>{t("Open the browser")} {menu} {t("at the top right.")}</>,
        <>{t("Tap")} <Key>{t("Install app")}</Key> {t("or")} <Key>{t("Add to Home screen")}</Key>.</>,
        <>{t("Confirm. Play appears with your other apps.")}</>,
      ],
    },
    "mac-safari": {
      lead: t("Add Klygenix Play to your Dock. It opens in its own window, like an app."),
      steps: [
        <>{t("In the menu bar, choose")} <Key>{t("File")}</Key> → <Key>{t("Add to Dock")}</Key>.</>,
        <>{t("Click")} <Key>{t("Add")}</Key>. {t("Play opens from the Dock and Launchpad.")}</>,
      ],
    },
    "desktop-other": {
      lead: t("Install Klygenix Play on this computer. It opens in its own window, like an app."),
      steps: [
        <>{t("In Chrome or Edge, click")} <Key><MonitorDown size={14} aria-hidden="true" /> {t("Install")}</Key> {t("at the right end of the address bar.")}</>,
        <>{t("Or open the browser")} {menu} {t("and choose Install Klygenix Play (Chrome: Cast, save and share → Install page as app).")}</>,
        <>{t("Firefox can't install apps — open play.klygenix.com in Chrome or Edge.")}</>,
      ],
    },
    "in-app": {
      lead: t("This app's built-in browser can't install apps."),
      steps: [
        <>{t("Tap")} {menu} {t("or the share button and choose Open in browser (Safari or Chrome).")}</>,
        <>{t("Tap Install app again there.")}</>,
      ],
    },
  }
  const content = body[mode] ?? body["desktop-other"]
  const ios = mode === "ios" || mode === "ios-other"

  return (
    <>
      <Sheet
        open={open}
        onClose={closeInstallSheet}
        title={t("Install Klygenix Play")}
        footer={
          <>
            {mode === "in-app" && <Btn onClick={() => void copy()}><Copy size={15} aria-hidden="true" /> {t("Copy link")}</Btn>}
            {ios
              ? <Btn tone="brand" onClick={() => { closeInstallSheet(); setPointing(true) }}>{t("Show me")}</Btn>
              : <Btn tone="brand" onClick={closeInstallSheet}>{t("Got it")}</Btn>}
          </>
        }
      >
        <div className="flex items-center gap-3">
          <img src="/icon-192.png" alt="" width={48} height={48} className="size-12 rounded-xl" />
          <p className="text-sm text-muted">{content.lead}</p>
        </div>
        <div className="mt-4"><Steps items={content.steps} /></div>
        <p className="mt-4 text-xs text-faint">{t("Free, no app store needed. Uses the same account as the website.")}</p>
      </Sheet>
      {pointing && <Pointer mode={mode} onDone={() => setPointing(false)} />}
    </>
  )
}

export default InstallSheet
