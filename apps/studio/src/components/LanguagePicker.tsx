import { useState } from "react"
import { toast } from "sonner"
import { useQueryClient } from "@tanstack/react-query"
import { api, useAuthStore } from "@klygenixvideo/auth"
import { cn } from "@klygenixvideo/ui"
import { LANG_OPTIONS, useLang, type Lang } from "../i18n"
import { detail } from "../lib/format"

export function LanguagePicker({ compact = false, onSaved }: { compact?: boolean; onSaved?: (lang: Lang) => void }) {
  const lang = useLang()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)

  async function pick(next: Lang) {
    if (next === lang) return
    const { token, user, setAuth } = useAuthStore.getState()
    if (!token || !user) return
    const before = user.settings?.language ?? null
    setAuth(token, { ...user, settings: { ...(user.settings ?? {}), language: next } })
    setBusy(true)
    try {
      await api.patch("/api/video/me", { language: next })
      qc.invalidateQueries({ queryKey: ["video-me"] })
      onSaved?.(next)
    } catch (err) {
      const now = useAuthStore.getState()
      if (now.token && now.user) now.setAuth(now.token, { ...now.user, settings: { ...(now.user.settings ?? {}), language: before } })
      toast.error(detail(err, "Could not change the language"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <select
      aria-label="Language"
      value={lang}
      disabled={busy}
      onChange={(e) => pick(e.target.value as Lang)}
      className={cn(
        "cursor-pointer rounded-lg border border-slate-200 bg-white font-semibold text-slate-700 hover:bg-slate-50",
        compact ? "px-2 py-1 text-xs" : "px-3 py-2 text-sm",
      )}
    >
      {LANG_OPTIONS.map((o) => (
        <option key={o.value} value={o.value} lang={o.value}>{o.label}</option>
      ))}
    </select>
  )
}
