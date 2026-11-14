import { useEffect, useRef } from "react"

interface GoogleId {
  initialize: (config: Record<string, unknown>) => void
  renderButton: (element: HTMLElement, config: Record<string, unknown>) => void
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleId } }
  }
}

const SCRIPT = "https://accounts.google.com/gsi/client"
let loading: Promise<GoogleId> | null = null
let current: ((credential: string) => void) | null = null
let initialised = ""

export const googleClientId: string = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ""

function loadGoogle(): Promise<GoogleId> {
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id)
  loading ??= new Promise<GoogleId>((resolve, reject) => {
    const el = document.createElement("script")
    el.src = SCRIPT
    el.async = true
    el.onload = () => (window.google?.accounts?.id ? resolve(window.google.accounts.id) : reject(new Error("gsi")))
    el.onerror = () => {
      loading = null
      reject(new Error("gsi"))
    }
    document.head.appendChild(el)
  })
  return loading
}

export interface GoogleButtonProps {
  onCredential: (credential: string) => void
  text?: "continue_with" | "signin_with" | "signup_with"
  theme?: "outline" | "filled_black" | "filled_blue"
  shape?: "rectangular" | "pill"
  locale?: string
  onUnavailable?: () => void
}

export function GoogleButton({ onCredential, text = "continue_with", theme = "outline", shape = "rectangular", locale, onUnavailable }: GoogleButtonProps) {
  const box = useRef<HTMLDivElement>(null)
  const handler = useRef(onCredential)
  handler.current = onCredential

  useEffect(() => {
    if (!googleClientId) return
    let live = true
    const mine = (credential: string) => handler.current(credential)
    current = mine
    loadGoogle()
      .then((id) => {
        if (!live || !box.current) return
        if (initialised !== googleClientId) {
          id.initialize({
            client_id: googleClientId,
            callback: (r: { credential?: string }) => r.credential && current?.(r.credential),
            ux_mode: "popup",
            context: "use",
          })
          initialised = googleClientId
        }
        const width = Math.max(200, Math.min(400, Math.floor(box.current.getBoundingClientRect().width || 320)))
        id.renderButton(box.current, { type: "standard", theme, size: "large", text, shape, logo_alignment: "center", width, locale: locale ?? document.documentElement.lang ?? "en" })
      })
      .catch(() => live && onUnavailable?.())
    return () => {
      live = false
      if (current === mine) current = null
    }
  }, [text, theme, shape, locale, onUnavailable])

  if (!googleClientId) return null
  return <div ref={box} className="flex min-h-[44px] w-full justify-center" />
}
