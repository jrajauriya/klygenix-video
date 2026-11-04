import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import * as SecureStore from "expo-secure-store"

import { api } from "./api"
import { useAuth } from "./auth"
import { language, toLang, type Lang } from "./lang"
import { session } from "./session"
import { en, hi, type Key } from "./strings"

const STORE = "kv-lang"
const tables: Record<Lang, Record<Key, string>> = { en, hi }

export type Vars = Record<string, string | number>
export type T = (key: Key, vars?: Vars) => string

export function translate(lang: Lang, key: Key, vars?: Vars): string {
  const text = tables[lang][key] ?? en[key]
  if (!vars) return text
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole))
}

interface I18n {
  lang: Lang
  t: T
  setLang: (next: Lang) => Promise<void>
}

const I18nContext = createContext<I18n>({
  lang: "en",
  t: (key, vars) => translate("en", key, vars),
  setLang: async () => {},
})

export function LanguageProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [lang, setState] = useState<Lang>(language.get())

  const apply = useCallback((next: Lang) => {
    language.set(next)
    setState(next)
  }, [])

  useEffect(() => {
    SecureStore.getItemAsync(STORE)
      .then((stored) => stored && apply(toLang(stored)))
      .catch(() => null)
  }, [apply])

  useEffect(() => {
    const fromAccount = user?.settings?.language
    if (fromAccount !== "en" && fromAccount !== "hi") return
    apply(toLang(fromAccount))
    SecureStore.setItemAsync(STORE, toLang(fromAccount)).catch(() => null)
  }, [user?.id, user?.settings?.language, apply])

  const setLang = useCallback(
    async (next: Lang) => {
      apply(next)
      await SecureStore.setItemAsync(STORE, next).catch(() => null)
      const account = user?.settings?.language
      if (!user || (account && account !== "en" && account !== "hi")) return
      await session.remember({ settings: { ...user.settings, language: next } })
      await api.patch("/api/video/me", { language: next }).catch(() => null)
    },
    [apply, user],
  )

  const value = useMemo<I18n>(() => ({ lang, setLang, t: (key, vars) => translate(lang, key, vars) }), [lang, setLang])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useT(): I18n {
  return useContext(I18nContext)
}
