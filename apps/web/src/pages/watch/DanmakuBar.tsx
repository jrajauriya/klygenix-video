import { Suspense, lazy, useEffect, useRef, useState, type FormEvent } from "react"
import { Link } from "react-router-dom"
import { toast } from "sonner"
import { Languages, MessageSquareText, MessageSquareOff, Rocket, Send, SlidersHorizontal, Users, X } from "lucide-react"
import { cn } from "@klygenixvideo/ui"
import type { DanmakuMode } from "@klygenixvideo/player"
import { errText, loginPath, useSignedIn } from "../../lib/api"
import { langName } from "../../lib/format"
import type { BoostTier } from "../../lib/types"
import { TRANSLATE_LANGS, type DanmakuPrefs } from "../../lib/prefs"
import { Sheet } from "../../components/Sheet"
import { Btn, INPUT } from "../../components/bits"
import { useT } from "../../i18n"

const COLORS = ["#FFFFFF", "#FE0302", "#FF7204", "#FFD302", "#00CD00", "#00A0EA", "#89D5FF", "#CC0273", "#E879F9"]
const MODES: { key: DanmakuMode; label: string }[] = [
  { key: "scroll", label: "Scroll" },
  { key: "top", label: "Top" },
  { key: "bottom", label: "Bottom" },
]

const BoostSheet = lazy(() => import("./BoostSheet"))

export interface BoostOptions {
  videoId: string
  tiers: BoostTier[]
  positionMs: () => number
}

export function DanmakuBar({
  prefs, onPrefs, watchers, onPost, disabledReason, boost, translateLang = "en", onTranslateLang, translateOff = false,
}: {
  prefs: DanmakuPrefs
  onPrefs: (patch: Partial<DanmakuPrefs>) => void
  watchers: number
  onPost: (text: string, mode: DanmakuMode, color: string) => Promise<unknown>
  disabledReason?: string
  boost?: BoostOptions
  translateLang?: string
  onTranslateLang?: (lang: string) => void
  translateOff?: boolean
}) {
  const t = useT("watch")
  const signedIn = useSignedIn()
  const [text, setText] = useState("")
  const [mode, setMode] = useState<DanmakuMode>("scroll")
  const [color, setColor] = useState("#FFFFFF")
  const [style, setStyle] = useState(false)
  const [settings, setSettings] = useState(false)
  const [pending, setPending] = useState(false)
  const [boosting, setBoosting] = useState<{ t_ms: number } | null>(null)
  const pop = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!style) return
    const onDown = (e: PointerEvent) => {
      if (!pop.current?.contains(e.target as Node)) setStyle(false)
    }
    document.addEventListener("pointerdown", onDown)
    return () => document.removeEventListener("pointerdown", onDown)
  }, [style])

  async function submit(e: FormEvent) {
    e.preventDefault()
    const value = text.trim()
    if (!value) return
    setPending(true)
    try {
      await onPost(value, mode, color)
      setText("")
      if (!prefs.enabled) onPrefs({ enabled: true })
    } catch (err) {
      toast.error(errText(err, t("That danmaku could not be sent.")))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex items-center gap-2 border-b border-line bg-panel px-2 py-2 sm:rounded-b-2xl sm:px-3">
      <button
        type="button"
        onClick={() => onPrefs({ enabled: !prefs.enabled })}
        aria-pressed={prefs.enabled}
        title={prefs.enabled ? t("Hide danmaku (d)") : t("Show danmaku (d)")}
        aria-label={prefs.enabled ? t("Hide danmaku") : t("Show danmaku")}
        className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition", prefs.enabled ? "bg-brand/25 text-brand-soft" : "bg-white/[0.07] text-muted")}
      >
        {prefs.enabled ? <MessageSquareText size={18} /> : <MessageSquareOff size={18} />}
      </button>
      <button type="button" onClick={() => setSettings(true)} aria-label={t("Danmaku settings")} title={t("Danmaku settings")} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/[0.07] text-muted hover:text-ink">
        <SlidersHorizontal size={17} />
      </button>
      {watchers > 0 && (
        <span className="hidden shrink-0 items-center gap-1 text-xs text-muted sm:inline-flex" title={t("Watching now")}>
          <Users size={14} aria-hidden="true" /> {t("{n} watching", { n: watchers })}
        </span>
      )}

      {disabledReason ? (
        <p className="min-w-0 flex-1 truncate px-2 text-xs text-muted">{disabledReason}</p>
      ) : signedIn ? (
        <form onSubmit={submit} className="flex min-w-0 flex-1 items-center gap-2">
          <div ref={pop} className="relative shrink-0">
            <button
              type="button"
              onClick={() => setStyle(!style)}
              aria-label={t("Danmaku style: {style}", { style: t(MODES.find((m) => m.key === mode)?.label ?? "") })}
              aria-expanded={style}
              className="flex h-9 items-center gap-1.5 rounded-full bg-white/[0.07] px-2.5 text-xs font-semibold text-ink hover:bg-white/15"
            >
              <span className="h-3.5 w-3.5 rounded-full ring-1 ring-white/40" style={{ background: color }} />
              <span className="hidden sm:inline">{t(MODES.find((m) => m.key === mode)?.label ?? "")}</span>
            </button>
            {style && (
              <div className="absolute bottom-11 left-0 z-30 w-60 rounded-xl border border-line bg-panel-2 p-3 shadow-2xl">
                <p className="mb-2 text-xs font-semibold text-muted">{t("Position")}</p>
                <div className="mb-3 grid grid-cols-3 gap-1">
                  {MODES.map((m) => (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() => setMode(m.key)}
                      aria-pressed={mode === m.key}
                      className={cn("h-8 rounded-lg text-xs font-semibold", mode === m.key ? "bg-brand text-white" : "bg-white/[0.07] text-ink hover:bg-white/15")}
                    >
                      {t(m.label)}
                    </button>
                  ))}
                </div>
                <p className="mb-2 text-xs font-semibold text-muted">{t("Colour")}</p>
                <div className="flex flex-wrap gap-2">
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setColor(c)}
                      aria-label={t("Colour {c}", { c })}
                      aria-pressed={color === c}
                      className={cn("h-7 w-7 rounded-full ring-offset-2 ring-offset-panel-2", color === c ? "ring-2 ring-white" : "ring-1 ring-white/25")}
                      style={{ background: c }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="relative min-w-0 flex-1">
            <input
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, 60))}
              maxLength={60}
              placeholder={t("Send a danmaku…")}
              aria-label={t("Danmaku text")}
              className="h-9 w-full rounded-full border border-line bg-panel-2 pl-3.5 pr-12 text-sm text-ink placeholder:text-faint outline-none focus:border-brand"
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] tabular-nums text-faint">{text.length}/60</span>
          </div>
          {boost && (
            <button
              type="button"
              onClick={() => setBoosting({ t_ms: boost.positionMs() })}
              title={t("Boost a danmaku")}
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-[#FACC15] px-3 text-sm font-semibold text-black hover:bg-[#fde047]"
            >
              <Rocket size={15} aria-hidden="true" />
              <span className="sr-only sm:not-sr-only">{t("Boost")}</span>
            </button>
          )}
          <button type="submit" disabled={!text.trim() || pending} aria-label={t("Send danmaku")} className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-brand px-3 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-50">
            <Send size={15} aria-hidden="true" />
            <span className="hidden sm:inline">{t("Send")}</span>
          </button>
        </form>
      ) : (
        <Link to={loginPath()} className="flex h-9 min-w-0 flex-1 items-center rounded-full border border-line bg-panel-2 px-3.5 text-sm text-muted hover:border-brand/60">
          <span className="truncate">{t("Sign in to send danmaku")}</span>
        </Link>
      )}

      <DanmakuSettings
        open={settings}
        onClose={() => setSettings(false)}
        prefs={prefs}
        onPrefs={onPrefs}
        lang={translateLang}
        onLang={onTranslateLang}
        translateOff={translateOff}
      />
      {boost && boosting !== null && (
        <Suspense fallback={null}>
        <BoostSheet
          open={boosting !== null}
          onClose={() => setBoosting(null)}
          boost={boost}
          tMs={boosting?.t_ms ?? 0}
          initial={text}
          onPaid={() => {
            setText("")
            if (!prefs.enabled) onPrefs({ enabled: true })
          }}
        />
        </Suspense>
      )}
    </div>
  )
}

function DanmakuSettings({ open, onClose, prefs, onPrefs, lang, onLang, translateOff }: {
  open: boolean
  onClose: () => void
  prefs: DanmakuPrefs
  onPrefs: (patch: Partial<DanmakuPrefs>) => void
  lang: string
  onLang?: (lang: string) => void
  translateOff: boolean
}) {
  const t = useT("watch")
  const [word, setWord] = useState("")

  function addWord(e: FormEvent) {
    e.preventDefault()
    const w = word.trim()
    if (!w || prefs.blocked.includes(w)) return
    onPrefs({ blocked: [...prefs.blocked, w].slice(0, 100) })
    setWord("")
  }

  return (
    <Sheet open={open} onClose={onClose} title={t("Danmaku settings")} footer={<Btn tone="brand" onClick={onClose}>{t("Done")}</Btn>}>
      <div className="space-y-6">
        <label className="flex items-center justify-between gap-4">
          <span>
            <span className="block text-sm font-semibold">{t("Show danmaku")}</span>
            <span className="block text-xs text-muted">{t("Press D while watching to switch quickly.")}</span>
          </span>
          <input type="checkbox" role="switch" checked={prefs.enabled} onChange={(e) => onPrefs({ enabled: e.target.checked })} className="h-5 w-9 accent-[#A21CAF]" />
        </label>
        {onLang && (
          <div className="space-y-2">
            <label className="flex items-center justify-between gap-4">
              <span>
                <span className="flex items-center gap-1.5 text-sm font-semibold"><Languages size={15} aria-hidden="true" /> {t("Translate danmaku")}</span>
                <span className="block text-xs text-muted">{t("Lines on screen now and in the next few seconds, translated by AI.")}</span>
              </span>
              <input type="checkbox" role="switch" checked={prefs.translate} onChange={(e) => onPrefs({ translate: e.target.checked })} className="h-5 w-9 accent-[#A21CAF]" />
            </label>
            <label className="flex items-center justify-between gap-4 text-sm">
              <span className="text-muted">{t("Translate to")}</span>
              <select value={lang} onChange={(e) => onLang(e.target.value)} className="h-9 rounded-lg border border-line bg-panel-2 px-2 text-sm text-ink outline-none focus:border-brand">
                {TRANSLATE_LANGS.map((l) => <option key={l} value={l}>{langName(l)}</option>)}
              </select>
            </label>
            {translateOff && <p role="status" className="rounded-lg bg-white/[0.06] px-3 py-2 text-xs text-muted">{t("Machine translation is off in this environment. Showing the original lines.")}</p>}
          </div>
        )}
        <label className="block">
          <span className="mb-2 flex justify-between text-sm font-semibold">{t("Density")} <span className="font-normal text-muted">{Math.round(prefs.density * 100)}%</span></span>
          <input type="range" min={0.1} max={1} step={0.05} value={prefs.density} onChange={(e) => onPrefs({ density: Number(e.target.value) })} className="w-full accent-[#C026D3]" />
        </label>
        <label className="block">
          <span className="mb-2 flex justify-between text-sm font-semibold">{t("Opacity")} <span className="font-normal text-muted">{Math.round(prefs.opacity * 100)}%</span></span>
          <input type="range" min={0.2} max={1} step={0.05} value={prefs.opacity} onChange={(e) => onPrefs({ opacity: Number(e.target.value) })} className="w-full accent-[#C026D3]" />
        </label>
        <div>
          <p className="text-sm font-semibold">{t("Blocked words")}</p>
          <p className="mb-2 text-xs text-muted">{t("Danmaku containing these words are hidden for you. Saved on this device.")}</p>
          <form onSubmit={addWord} className="flex gap-2">
            <input value={word} onChange={(e) => setWord(e.target.value)} maxLength={40} placeholder={t("Add a word")} aria-label={t("Word to block")} className={INPUT} />
            <Btn tone="soft" type="submit" disabled={!word.trim()}>{t("Add")}</Btn>
          </form>
          {prefs.blocked.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2">
              {prefs.blocked.map((w) => (
                <li key={w} className="inline-flex items-center gap-1 rounded-full bg-white/10 py-1 pl-3 pr-1 text-xs">
                  {w}
                  <button type="button" aria-label={t("Unblock {word}", { word: w })} onClick={() => onPrefs({ blocked: prefs.blocked.filter((x) => x !== w) })} className="rounded-full p-0.5 hover:bg-white/15">
                    <X size={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Sheet>
  )
}
