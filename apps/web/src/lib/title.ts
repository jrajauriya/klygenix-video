import { useEffect } from "react"
import { tr, useLang } from "../i18n"

export function useTitle(title: string | null | undefined) {
  const lang = useLang()
  useEffect(() => {
    document.title = title ? `${tr(title)} · Klygenix Play` : "Klygenix Play"
  }, [title, lang])
}
