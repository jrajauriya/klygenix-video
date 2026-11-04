import { useCallback, useEffect, useSyncExternalStore } from "react"
import { useAuthStore } from "@klygenixvideo/auth"

export type Lang = "en" | "hi"

export const LANG_OPTIONS: { value: Lang; label: string }[] = [
  { value: "en", label: "English" },
  { value: "hi", label: "हिन्दी" },
]

const HI: Record<string, string> = {
  "Klygenix Play Studio": "Klygenix Play स्टूडियो",
  Studio: "स्टूडियो",
  Create: "बनाएँ",
  Audience: "दर्शक",
  Account: "खाता",
  Dashboard: "डैशबोर्ड",
  Videos: "वीडियो",
  "Clip maker": "क्लिप मेकर",
  Live: "लाइव",
  Channel: "चैनल",
  "Comments & danmaku": "टिप्पणियाँ और डानमाकू",
  Community: "कम्युनिटी",
  Analytics: "एनालिटिक्स",
  Earnings: "कमाई",
  Billing: "प्लान और बिलिंग",
  Moderation: "मॉडरेशन सूचनाएँ",
  Settings: "सेटिंग्स",
  "View channel": "चैनल देखें",
  Upload: "अपलोड करें",
  "Change password": "पासवर्ड बदलें",
  "Two-step sign-in": "दो-चरण साइन-इन",
  "(on)": "(चालू)",
  Language: "भाषा",
  Theme: "थीम",
  "Password changed": "पासवर्ड बदल गया",
  "Language saved": "भाषा सहेजी गई",
  "Send the link again": "लिंक दोबारा भेजें",
  "Set it up now": "अभी सेट करें",
  "Confirm your email address. The link is in your inbox.": "अपना ईमेल पता पुष्टि करें। लिंक आपके इनबॉक्स में है।",
  "Your organisation requires two-step sign-in. Set it up to carry on working.":
    "आपके संगठन को दो-चरण साइन-इन चाहिए। काम जारी रखने के लिए इसे सेट करें।",
  "Your channel is suspended. Your videos are hidden until the suspension is lifted. See moderation notices for details.":
    "आपका चैनल निलंबित है। निलंबन हटने तक आपके वीडियो छिपे रहेंगे। विवरण के लिए मॉडरेशन सूचनाएँ देखें।",
  "Page not found": "पेज नहीं मिला",
  Brand: "ब्रांड",
  "Brand profile": "ब्रांड प्रोफ़ाइल",
  "Ad campaigns": "विज्ञापन अभियान",
  "Sponsorship briefs": "स्पॉन्सरशिप ब्रीफ़",
  "Brand deals": "ब्रांड डील",
  Sponsorships: "स्पॉन्सरशिप",
  Feedback: "सुझाव",
  Calendar: "कैलेंडर",
}

export type Vars = Record<string, string | number>

let full: Record<string, string> | null = null
let loading: Promise<void> | null = null
const listeners = new Set<() => void>()

export function loadHindi(): Promise<void> {
  if (!loading) {
    loading = import("./locales/hi").then((m) => {
      full = { ...m.default, ...HI }
      listeners.forEach((l) => l())
    }).catch(() => {
      loading = null
    })
  }
  return loading
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

const snapshot = () => full

function fill(text: string, vars?: Vars): string {
  if (!vars) return text
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m))
}

function lookup(lang: Lang, text: string): string {
  const plain = text.includes("|") ? text.slice(0, text.indexOf("|")) : text
  if (lang !== "hi") return plain
  return full?.[text] ?? HI[text] ?? full?.[plain] ?? HI[plain] ?? plain
}

export function useLang(): Lang {
  const lang = useAuthStore((s) => s.user?.settings?.language)
  return lang === "hi" ? "hi" : "en"
}

export type T = (text: string, vars?: Vars) => string

export function useT(): T {
  const lang = useLang()
  const dict = useSyncExternalStore(subscribe, snapshot)
  useEffect(() => {
    if (lang === "hi" && !dict) loadHindi()
  }, [lang, dict])
  return useCallback((text: string, vars?: Vars) => fill(lookup(lang, text), vars), [lang, dict])
}

export function tr(text: string, vars?: Vars): string {
  const lang = useAuthStore.getState().user?.settings?.language === "hi" ? "hi" : "en"
  if (lang === "hi" && !full) loadHindi()
  return fill(lookup(lang, text), vars)
}

export function useHtmlLang() {
  const lang = useLang()
  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])
}
