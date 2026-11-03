import { useCallback, useEffect, useState } from "react"

export interface DanmakuPrefs {
  enabled: boolean
  density: number
  opacity: number
  blocked: string[]
  translate: boolean
}

const KEY = "kv_web_danmaku"
const DEFAULTS: DanmakuPrefs = { enabled: true, density: 1, opacity: 0.9, blocked: [], translate: false }

function read(): DanmakuPrefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULTS
    const parsed = JSON.parse(raw) as Partial<DanmakuPrefs>
    return {
      enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : DEFAULTS.enabled,
      density: typeof parsed.density === "number" ? Math.min(1, Math.max(0.1, parsed.density)) : DEFAULTS.density,
      opacity: typeof parsed.opacity === "number" ? Math.min(1, Math.max(0.2, parsed.opacity)) : DEFAULTS.opacity,
      blocked: Array.isArray(parsed.blocked) ? parsed.blocked.filter((w) => typeof w === "string").slice(0, 100) : [],
      translate: parsed.translate === true,
    }
  } catch {
    return DEFAULTS
  }
}

export function useDanmakuPrefs() {
  const [prefs, setPrefs] = useState<DanmakuPrefs>(read)

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(prefs))
    } catch {
      return
    }
  }, [prefs])

  const update = useCallback((patch: Partial<DanmakuPrefs>) => setPrefs((p) => ({ ...p, ...patch })), [])
  return [prefs, update] as const
}

export function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const on = () => setMatch(mq.matches)
    on()
    mq.addEventListener("change", on)
    return () => mq.removeEventListener("change", on)
  }, [query])
  return match
}

export const TRANSLATE_LANGS = ["en", "hi", "mr", "bn", "ta", "te"] as const

const LANG_KEY = "kv_web_translate_lang"

export function useTranslateLang(fallback?: string | null) {
  const [lang, setLang] = useState<string | null>(() => {
    try {
      return localStorage.getItem(LANG_KEY)
    } catch {
      return null
    }
  })
  const pick = useCallback((next: string) => {
    setLang(next)
    try {
      localStorage.setItem(LANG_KEY, next)
    } catch {
      return
    }
  }, [])
  const value = lang && (TRANSLATE_LANGS as readonly string[]).includes(lang) ? lang : fallback && (TRANSLATE_LANGS as readonly string[]).includes(fallback) ? fallback : "en"
  return [value, pick] as const
}
