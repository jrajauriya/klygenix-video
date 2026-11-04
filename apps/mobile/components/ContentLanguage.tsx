import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Pressable, Text, View } from "react-native"

import { api, detail } from "../lib/api"
import { useAuth } from "../lib/auth"
import { useT } from "../lib/i18n"
import { CONTENT_LANGUAGES } from "../lib/languages"
import { session } from "../lib/session"
import { colour, s } from "../lib/theme"

export function ContentLanguage({ current }: { current: string | undefined }) {
  const { user } = useAuth()
  const { t } = useT()
  const qc = useQueryClient()
  const [picked, setPicked] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const value = picked ?? current ?? "en"

  async function choose(code: string) {
    if (!user || code === value) return
    const before = value
    setPicked(code)
    setError(null)
    try {
      await api.patch("/api/video/me", { language: code })
      await session.remember({ settings: { ...user.settings, language: code } })
      qc.invalidateQueries({ queryKey: ["me", user.id] })
    } catch (err) {
      setPicked(before)
      setError(detail(err, t("notify.saveFailed")))
    }
  }

  return (
    <View>
      <Text style={s.heading}>{t("profile.contentLanguage")}</Text>
      <Text style={[s.note, { marginTop: 4 }]}>{t("profile.contentLanguageHint")}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 }} accessibilityRole="radiogroup">
        {CONTENT_LANGUAGES.map((o) => {
          const on = o.code === value
          return (
            <Pressable
              key={o.code}
              onPress={() => choose(o.code)}
              style={[s.chip, on && { backgroundColor: colour.brand }]}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
            >
              <Text style={[s.chipText, on && { color: colour.white }]}>{o.label}</Text>
            </Pressable>
          )
        })}
      </View>
      {error && <Text style={s.error}>{error}</Text>}
    </View>
  )
}
