import { useCallback, useEffect, useState } from "react"
import { api } from "./api"
import { useAuthStore } from "./store"

export function useThemePreference(app: string) {
  const { token, user, setAuth } = useAuthStore()
  const [saving, setSaving] = useState(false)

  const current = user?.settings?.theme?.[app]

  useEffect(() => {
    if (!token) return
    let live = true
    api
      .get("/api/auth/me/settings")
      .then(({ data }) => {
        const state = useAuthStore.getState()
        if (!live || !state.user || !state.token) return
        const theirs = data?.theme ?? {}
        if (JSON.stringify(theirs) !== JSON.stringify(state.user.settings?.theme ?? {})) {
          state.setAuth(state.token, { ...state.user, settings: { ...(state.user.settings ?? {}), theme: theirs } })
        }
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [token])

  const save = useCallback(
    async (theme: string) => {
      if (!user || !token) return
      const nextThemes = { ...(user.settings?.theme ?? {}), [app]: theme }
      setAuth(token, { ...user, settings: { ...(user.settings ?? {}), theme: nextThemes } })
      setSaving(true)
      try {
        await api.put("/api/auth/me/settings", { theme: { [app]: theme } })
      } finally {
        setSaving(false)
      }
    },
    [app, token, user, setAuth],
  )

  return { current, save, saving }
}
