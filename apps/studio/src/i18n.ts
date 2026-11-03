import { useCallback, useEffect } from "react"
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
  Channel: "चैनल",
  "Comments & danmaku": "टिप्पणियाँ और डानमाकू",
  Analytics: "एनालिटिक्स",
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
}

export function useLang(): Lang {
  const lang = useAuthStore((s) => s.user?.settings?.language)
  return lang === "hi" ? "hi" : "en"
}

export function useT() {
  const lang = useLang()
  return useCallback((text: string) => (lang === "hi" ? HI[text] ?? text : text), [lang])
}

export function useHtmlLang() {
  const lang = useLang()
  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])
}
