import { useEffect, useMemo, useSyncExternalStore } from "react"
import { api, useAuthStore } from "@klygenixvideo/auth"

export type Lang = "en" | "hi"
export type Vars = Record<string, string | number>
export type T = (text: string, vars?: Vars) => string
type Dict = Record<string, string>

const LOADERS = {
  common: () => import("./hi/common"),
  home: () => import("./hi/home"),
  reels: () => import("./hi/reels"),
  watch: () => import("./hi/watch"),
  watchx: () => import("./hi/watchx"),
  live: () => import("./hi/live"),
  support: () => import("./hi/support"),
  channel: () => import("./hi/channel"),
  account: () => import("./hi/account"),
  auth: () => import("./hi/auth"),
  plans: () => import("./hi/plans"),
  legal: () => import("./hi/legal"),
} satisfies Record<string, () => Promise<{ default: Dict }>>

export type Area = keyof typeof LOADERS

export const LANGS: { value: Lang; label: string; short: string }[] = [
  { value: "en", label: "English", short: "EN" },
  { value: "hi", label: "हिन्दी", short: "हिन्दी" },
]

const KEY = "kv_web_lang"
const loaded = new Set<Area>()
const pending = new Set<Area>()
const listeners = new Set<() => void>()
let words: Dict = {}
let wanted: Lang = "en"
let version = 0

function emit() {
  version += 1
  for (const l of listeners) l()
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

const snapshot = () => version

export function currentLang(): Lang {
  return wanted === "hi" && loaded.has("common") ? "hi" : "en"
}

function interpolate(text: string, vars?: Vars): string {
  return vars ? text.replace(/\{(\w+)\}/g, (all, k: string) => (k in vars ? String(vars[k]) : all)) : text
}

export const tr: T = (text, vars) => interpolate(currentLang() === "hi" ? words[text] ?? text : text, vars)

function sync() {
  document.documentElement.lang = currentLang()
  api.defaults.headers["Accept-Language"] = wanted
}

export function ensure(area: Area) {
  if (wanted !== "hi" || loaded.has(area) || pending.has(area)) return
  pending.add(area)
  LOADERS[area]()
    .then((m) => {
      words = { ...words, ...m.default }
      loaded.add(area)
      if (area === "common") sync()
      emit()
    })
    .catch(() => undefined)
    .finally(() => pending.delete(area))
}

function stored(): Lang | null {
  try {
    const v = localStorage.getItem(KEY)
    return v === "hi" || v === "en" ? v : null
  } catch {
    return null
  }
}

function resolve(): Lang {
  const { token, user } = useAuthStore.getState()
  const own = token && user ? user.settings?.language : undefined
  if (own === "hi" || own === "en") return own
  const saved = stored()
  if (saved) return saved
  return typeof navigator !== "undefined" && /^hi\b/i.test(navigator.language || "") ? "hi" : "en"
}

function want(next: Lang) {
  if (next === wanted && (next === "en" || loaded.has("common"))) return
  wanted = next
  if (next === "hi") ensure("common")
  sync()
  emit()
}

export function setLang(next: Lang) {
  want(next)
  try {
    localStorage.setItem(KEY, next)
  } catch {
    return
  }
}

function initLang() {
  want(resolve())
  let last = useAuthStore.getState().user?.settings?.language
  useAuthStore.subscribe((s) => {
    const lang = s.user?.settings?.language
    if (lang === last) return
    last = lang
    want(resolve())
  })
}

export function useLang(): Lang {
  useSyncExternalStore(subscribe, snapshot)
  return currentLang()
}

export function useT(area: Area = "common", load = true): T {
  const v = useSyncExternalStore(subscribe, snapshot)
  useEffect(() => {
    if (load) ensure(area)
  }, [area, v, load])
  return useMemo<T>(() => (text, vars) => tr(text, vars), [v])
}

if (typeof window !== "undefined") initLang()
