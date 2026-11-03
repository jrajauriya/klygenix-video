import { useState } from "react"
import { router } from "expo-router"
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native"

import { api, detail, statusOf } from "../lib/api"
import { useAuth } from "../lib/auth"
import { useT } from "../lib/i18n"
import { clock } from "../lib/format"
import { colour, s } from "../lib/theme"
import type { AskAnswer } from "../lib/types"

export function AskBox({ publicId, onSeek }: { publicId: string; onSeek: (ms: number) => void }) {
  const { user } = useAuth()
  const { t } = useT()
  const [question, setQuestion] = useState("")
  const [answer, setAnswer] = useState<AskAnswer | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function ask() {
    if (!user) {
      router.push("/profile")
      return
    }
    setBusy(true)
    setError(null)
    try {
      const { data } = await api.post<AskAnswer>(`/api/video/videos/${publicId}/ask`, { question: question.trim() })
      setAnswer(data)
    } catch (err) {
      setError(
        statusOf(err) === 402
          ? t("ask.quota")
          : detail(err, t("ask.failed")),
      )
    } finally {
      setBusy(false)
    }
  }

  const blocked = busy || question.trim().length < 2

  return (
    <View>
      <Text style={s.heading}>{t("ask.title")}</Text>
      <TextInput
        style={s.field}
        placeholder={user ? t("ask.placeholder") : t("ask.signInPlaceholder")}
        value={question}
        onChangeText={setQuestion}
        maxLength={500}
        onSubmitEditing={() => !blocked && ask()}
        returnKeyType="send"
      />
      <Pressable onPress={ask} disabled={blocked} style={[s.button, { marginTop: 10 }, blocked && s.disabled]}>
        {busy ? <ActivityIndicator color={colour.white} /> : <Text style={s.buttonText}>{t("ask.button")}</Text>}
      </Pressable>
      {error && <Text style={s.error}>{error}</Text>}
      {answer && (
        <View style={s.card}>
          <Text style={s.text}>{answer.answer}</Text>
          {answer.citations.map((c, i) => (
            <Pressable key={`${c.start_ms}-${i}`} onPress={() => onSeek(c.start_ms)} style={{ marginTop: 10 }}>
              <Text style={s.link}>{c.label || clock(c.start_ms)}</Text>
              <Text style={{ fontSize: 13, color: colour.slate500 }} numberOfLines={2}>
                {c.text}
              </Text>
            </Pressable>
          ))}
          {answer.quota && (
            <Text style={s.note}>
              {t("ask.used", { used: answer.quota.used, limit: answer.quota.limit })}
            </Text>
          )}
        </View>
      )}
    </View>
  )
}
