import { useState } from "react"
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native"
import Constants from "expo-constants"

import { api, detail } from "../lib/api"
import { useAuth } from "../lib/auth"
import { useT } from "../lib/i18n"
import { colour, s } from "../lib/theme"

const KINDS = ["bug", "idea", "other"] as const

export function FeedbackForm() {
  const { user } = useAuth()
  const { t } = useT()
  const [kind, setKind] = useState<(typeof KINDS)[number]>("bug")
  const [body, setBody] = useState("")
  const [email, setEmail] = useState("")
  const [sending, setSending] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)

  async function send() {
    if (body.trim().length < 3) {
      setNote({ ok: false, text: t("feedback.short") })
      return
    }
    setSending(true)
    setNote(null)
    try {
      const { data } = await api.post<{ reference: string }>("/api/video/feedback", {
        kind,
        body: body.trim(),
        page: "/profile",
        app: "mobile",
        app_version: Constants.expoConfig?.version ?? "",
        ...(!user && email.trim() ? { email: email.trim() } : {}),
      })
      setBody("")
      setNote({ ok: true, text: t("feedback.thanks", { ref: data.reference }) })
    } catch (err) {
      setNote({ ok: false, text: detail(err, t("feedback.failed")) })
    } finally {
      setSending(false)
    }
  }

  return (
    <View>
      <Text style={s.heading} accessibilityRole="header">{t("feedback.title")}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 }} accessibilityRole="radiogroup">
        {KINDS.map((k) => (
          <Pressable
            key={k}
            onPress={() => setKind(k)}
            style={[s.chip, kind === k ? { backgroundColor: colour.brand } : null]}
            accessibilityRole="radio"
            accessibilityState={{ checked: kind === k }}
          >
            <Text style={[s.chipText, kind === k ? { color: colour.white } : null]}>{t(`feedback.kind.${k}`)}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        style={[s.field, { minHeight: 96, textAlignVertical: "top" }]}
        value={body}
        onChangeText={setBody}
        placeholder={t("feedback.placeholder")}
        multiline
        maxLength={2000}
        accessibilityLabel={t("feedback.title")}
      />
      {!user && (
        <TextInput
          style={s.field}
          value={email}
          onChangeText={setEmail}
          placeholder={t("feedback.email")}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          accessibilityLabel={t("feedback.email")}
        />
      )}
      {note && (
        <Text style={[s.note, { color: note.ok ? colour.green700 : colour.red600, fontSize: 14 }]} accessibilityLiveRegion="polite">
          {note.text}
        </Text>
      )}
      <Pressable
        onPress={send}
        disabled={sending}
        style={[s.button, sending && s.disabled]}
        accessibilityRole="button"
        accessibilityState={{ busy: sending }}
      >
        {sending ? <ActivityIndicator color={colour.white} /> : <Text style={s.buttonText}>{t("feedback.send")}</Text>}
      </Pressable>
    </View>
  )
}
