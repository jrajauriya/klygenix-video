import { useCallback, useSyncExternalStore, type ReactNode } from "react"
import { api, useAuthStore } from "@klygenixvideo/auth"

export type Lang = "en" | "hi"
export type Vars = Record<string, string | number>
export type T = (text: string, vars?: Vars) => string

export const LANG_OPTIONS: { value: Lang; label: string }[] = [
  { value: "en", label: "English" },
  { value: "hi", label: "हिन्दी" },
]

const KEY = "kv-tv-lang"

const HI: Record<string, string> = {
  Home: "होम",
  Search: "खोज",
  Profile: "प्रोफ़ाइल",
  Subscriptions: "सब्सक्रिप्शन",
  Main: "मुख्य",
  "Signed in as {name}": "{name} के रूप में साइन इन",
  "Not signed in": "साइन इन नहीं है",

  "Loading videos…": "वीडियो लोड हो रहे हैं…",
  "The home feed did not load. Try again in a moment.": "होम फ़ीड लोड नहीं हुई। थोड़ी देर में फिर कोशिश करें।",
  "Continue watching": "देखना जारी रखें",
  Recommended: "आपके लिए सुझाव",
  "Live now": "अभी लाइव",
  Reels: "रील्स",
  "Nothing to watch yet.": "अभी देखने के लिए कुछ नहीं है।",
  "Subscriptions · {n} new": "सब्सक्रिप्शन · {n} नए",
  New: "नया",
  "See all subscriptions": "सभी सब्सक्रिप्शन देखें",

  "{n} views": "{n} बार देखा गया",
  "{n} view": "{n} बार देखा गया",
  Members: "सदस्य",
  Paid: "सशुल्क",
  LIVE: "लाइव",
  SOON: "जल्द",
  Live: "लाइव",
  "{n} watching": "{n} देख रहे हैं",
  Scheduled: "निर्धारित",
  "Open {site} on your phone.": "अपने फ़ोन पर {site} खोलें।",
  "Paid partnership with {brand}": "{brand} के साथ सशुल्क साझेदारी",
  "AI-generated": "AI से बना",

  "{n} new since you last looked": "पिछली बार के बाद {n} नए",
  "Follow channels to see their new videos here.": "चैनल फ़ॉलो करें, उनके नए वीडियो यहाँ दिखेंगे।",
  "Sign in to see new videos from the channels you follow.": "फ़ॉलो किए गए चैनलों के नए वीडियो देखने के लिए साइन इन करें।",
  "Your subscriptions did not load. Try again in a moment.": "आपके सब्सक्रिप्शन लोड नहीं हुए। थोड़ी देर में फिर कोशिश करें।",
  "Videos from channels you follow": "आपके फ़ॉलो किए चैनलों के वीडियो",
  "Sign in": "साइन इन करें",

  "Profile and settings": "प्रोफ़ाइल और सेटिंग्स",
  "Plan:": "प्लान:",
  "Premium, memberships and purchases are managed on the web.": "Premium, सदस्यता और खरीदारी वेब पर संभाली जाती हैं।",
  "Send feedback": "सुझाव भेजें",
  "Sign out": "साइन आउट करें",
  "Sign in to see what you were watching, the channels you follow and your Premium benefits. You approve the sign-in on your phone — no typing a password on the TV.":
    "साइन इन करें और देखें कि आप क्या देख रहे थे, आपके फ़ॉलो किए चैनल और आपके Premium फ़ायदे। साइन-इन आप अपने फ़ोन पर मंज़ूर करते हैं — TV पर पासवर्ड नहीं लिखना पड़ता।",
  "Sign in with your phone": "अपने फ़ोन से साइन इन करें",
  "Klygenix Play for TV · version {v}": "TV के लिए Klygenix Play · संस्करण {v}",
  Language: "भाषा",

  "Getting a code…": "कोड मिल रहा है…",
  "Waiting for you to approve on your phone…": "आपके फ़ोन पर मंज़ूरी का इंतज़ार है…",
  "Sign-in was declined on your phone.": "आपके फ़ोन पर साइन-इन अस्वीकार किया गया।",
  "This code has expired.": "यह कोड समाप्त हो गया है।",
  "A sign-in code could not be made. Try again.": "साइन-इन कोड नहीं बन सका। फिर कोशिश करें।",
  "On your phone or computer, open {site}": "अपने फ़ोन या कंप्यूटर पर {site} खोलें",
  "Enter this code:": "यह कोड डालें:",
  "Code loading": "कोड लोड हो रहा है",
  "Approve the TV. This screen moves on by itself.": "TV को मंज़ूरी दें। यह स्क्रीन अपने आप आगे बढ़ेगी।",
  "Get a new code": "नया कोड लें",
  "QR code that opens the sign-in page with this code filled in": "QR कोड जो यह कोड भरे हुए साइन-इन पेज को खोलता है",
  "Or scan with your phone camera": "या अपने फ़ोन के कैमरे से स्कैन करें",

  "Search for": "खोजें",
  "Type with the keys below": "नीचे की कुंजियों से लिखें",
  "On-screen keyboard": "ऑन-स्क्रीन कीबोर्ड",
  "Results for “{q}”": "“{q}” के नतीजे",
  Results: "नतीजे",
  "Type two letters or more.": "दो या ज़्यादा अक्षर लिखें।",
  "Searching…": "खोज रहे हैं…",
  "Search did not work. Try again.": "खोज नहीं हो सकी। फिर कोशिश करें।",
  "Nothing matched.": "कुछ नहीं मिला।",
  "{n} videos": "{n} वीडियो",
  "Search results": "खोज के नतीजे",
  "At {label}: {snippet}": "{label} पर: {snippet}",

  Space: "स्पेस",
  Delete: "मिटाएँ",
  Clear: "साफ़ करें",
  Done: "हो गया",
  apostrophe: "अपॉस्ट्रॉफ़ी",
  comma: "अल्पविराम",
  "full stop": "पूर्ण विराम",
  "question mark": "प्रश्नचिह्न",

  "Loading channel…": "चैनल लोड हो रहा है…",
  "This channel isn't here": "यह चैनल यहाँ नहीं है",
  "The channel did not load": "चैनल लोड नहीं हुआ",
  "Try again in a moment.": "थोड़ी देर में फिर कोशिश करें।",
  "That did not work. Try again.": "यह नहीं हो सका। फिर कोशिश करें।",
  "{n} followers": "{n} फ़ॉलोअर",
  Following: "फ़ॉलो कर रहे हैं",
  Follow: "फ़ॉलो करें",
  "Sign in to follow": "फ़ॉलो करने के लिए साइन इन करें",
  "Memberships, tips and paid videos are bought on the web.": "सदस्यता, टिप और सशुल्क वीडियो वेब पर खरीदे जाते हैं।",
  Videos: "वीडियो",
  "Loading…": "लोड हो रहा है…",
  "No videos yet.": "अभी कोई वीडियो नहीं।",

  "Something is broken": "कुछ काम नहीं कर रहा",
  "An idea": "एक सुझाव",
  "Something else": "कुछ और",
  "Write at least three characters.": "कम से कम तीन अक्षर लिखें।",
  "Your feedback could not be sent. Try again.": "आपका सुझाव नहीं भेजा जा सका। फिर कोशिश करें।",
  "Tell us what went wrong or what would make Play better on your TV.": "बताइए क्या गलत हुआ, या आपके TV पर Play को क्या बेहतर बनाएगा।",
  "Kind of feedback": "सुझाव का प्रकार",
  "Thank you. Your reference is {ref}.": "धन्यवाद। आपका संदर्भ {ref} है।",
  "Your feedback": "आपका सुझाव",
  "Sending…": "भेज रहे हैं…",
  Send: "भेजें",

  "This page isn't here": "यह पेज यहाँ नहीं है",
  "The link may be old, or the video was removed.": "लिंक पुराना हो सकता है, या वीडियो हटा दिया गया।",
  "Go home": "होम पर जाएँ",

  Watch: "देखें",
  Back: "वापस",
  "This video isn't here": "यह वीडियो यहाँ नहीं है",
  "This video did not load": "यह वीडियो लोड नहीं हुआ",
  "Check your connection and try again.": "अपना कनेक्शन जाँचें और फिर कोशिश करें।",
  "This video is for channel members. To join,": "यह वीडियो चैनल सदस्यों के लिए है। जुड़ने के लिए,",
  "This is a paid video. To buy it,": "यह सशुल्क वीडियो है। इसे खरीदने के लिए,",
  "This video plays on {platform}. Watch it at {site}": "यह वीडियो {platform} पर चलता है। इसे {site} पर देखें",
  "This video isn't ready to play yet.": "यह वीडियो अभी चलने के लिए तैयार नहीं है।",
  "Starting…": "शुरू हो रहा है…",
  "Playback position": "चलने की स्थिति",
  "{at} of {total}": "{total} में से {at}",
  Pause: "रोकें",
  Play: "चलाएँ",
  "Back 10 s": "10 से. पीछे",
  "Forward 10 s": "10 से. आगे",
  "Captions on": "कैप्शन चालू",
  "Captions off": "कैप्शन बंद",
  "Danmaku on": "डानमाकू चालू",
  "Danmaku off": "डानमाकू बंद",
  Chapters: "अध्याय",
  Close: "बंद करें",

  "Advertisement from {brand}": "{brand} का विज्ञापन",
  "Ad · {brand}": "विज्ञापन · {brand}",
  "Ends in {time}": "{time} में खत्म",
  Playing: "चल रहा है",
  "Learn more at {site}": "और जानें: {site}",
  "Skip ad": "विज्ञापन छोड़ें",
  "Skip ad in {n}": "{n} में विज्ञापन छोड़ें",
  "Ad starting…": "विज्ञापन शुरू हो रहा है…",

  "This stream isn't here.": "यह स्ट्रीम यहाँ नहीं है।",
  "This stream did not load.": "यह स्ट्रीम लोड नहीं हुई।",
  "This stream is for channel members. To join,": "यह स्ट्रीम चैनल सदस्यों के लिए है। जुड़ने के लिए,",
  "The stream is starting. Stay here — it plays as soon as video arrives.": "स्ट्रीम शुरू हो रही है। यहीं रहें — वीडियो आते ही चलेगी।",
  "Starts {when}": "{when} पर शुरू",
  "This stream has ended.": "यह स्ट्रीम खत्म हो गई है।",
  "Watch the replay": "रीप्ले देखें",
  "Chat shown": "चैट दिख रही है",
  "Chat hidden": "चैट छिपी है",
  "Live chat": "लाइव चैट",
  "Chat messages": "चैट संदेश",
  "No messages yet.": "अभी कोई संदेश नहीं।",
  "Chat is read-only on TV. To chat or send a Super Chat, open {site} on your phone.":
    "TV पर चैट सिर्फ़ पढ़ने के लिए है। चैट करने या Super Chat भेजने के लिए अपने फ़ोन पर {site} खोलें।",
}

function stored(): Lang | null {
  try {
    const v = window.localStorage.getItem(KEY)
    return v === "hi" || v === "en" ? v : null
  } catch {
    return null
  }
}

let current: Lang = stored() ?? (useAuthStore.getState().user?.settings?.language === "hi" ? "hi" : "en")
const listeners = new Set<() => void>()

function apply() {
  document.documentElement.lang = current
  api.defaults.headers["Accept-Language"] = current
}

export function initLang(): void {
  apply()
}

function remember(next: Lang) {
  try {
    window.localStorage.setItem(KEY, next)
  } catch {
    return
  }
}

export function setLang(next: Lang): void {
  current = next
  remember(next)
  apply()
  listeners.forEach((l) => l())
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export function fill(text: string, vars?: Vars): string {
  if (!vars) return text
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m))
}

export function translate(lang: Lang, text: string, vars?: Vars): string {
  return fill(lang === "hi" ? (HI[text] ?? text) : text, vars)
}

export function useLang(): Lang {
  return useSyncExternalStore(subscribe, () => current)
}

export function useT(): T {
  const lang = useLang()
  return useCallback((text: string, vars?: Vars) => translate(lang, text, vars), [lang])
}

export function slot(text: string, name: string, node: ReactNode): ReactNode {
  const at = text.indexOf(`{${name}}`)
  if (at < 0) return text
  return (
    <>
      {text.slice(0, at)}
      {node}
      {text.slice(at + name.length + 2)}
    </>
  )
}
