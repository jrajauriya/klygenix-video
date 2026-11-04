import { useEffect, useState } from "react"
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { router } from "expo-router"

import { api, statusOf } from "../lib/api"
import { useAuth } from "../lib/auth"
import { useT } from "../lib/i18n"
import type { Key } from "../lib/strings"
import { colour, s } from "../lib/theme"

export interface ReportTarget {
  type: "live" | "live_message"
  id: string
  title: string
}

const REASONS = [
  "spam", "sexual", "violence", "hate", "harassment", "self_harm",
  "child_safety", "copyright", "misinformation", "scam", "impersonation", "other",
] as const

export function ReportSheet({ target, onClose }: { target: ReportTarget | null; onClose: () => void }) {
  const { user } = useAuth()
  const { t } = useT()
  const [busy, setBusy] = useState<string | null>(null)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    setBusy(null)
    setResult(null)
  }, [target?.type, target?.id])

  async function send(reason: string) {
    if (!target || busy) return
    setBusy(reason)
    try {
      await api.post("/api/video/reports", { target_type: target.type, target_id: target.id, reason })
      setResult({ ok: true, text: t("report.sent") })
    } catch (err) {
      const code = statusOf(err)
      setResult({ ok: code === 409, text: code === 409 ? t("report.already") : t("report.failed") })
    } finally {
      setBusy(null)
    }
  }

  return (
    <Modal visible={target !== null} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={st.scrim} onPress={onClose} accessibilityRole="button" accessibilityLabel={t("report.cancel")} />
      <View style={st.panel} accessibilityViewIsModal>
        <Text style={s.title} accessibilityRole="header">{target?.type === "live" ? t("report.stream") : t("report.message")}</Text>
        {target ? <Text style={s.subtitle} numberOfLines={2}>{target.title}</Text> : null}
        {!user ? (
          <>
            <Text style={[s.text, { marginTop: 16 }]}>{t("report.signIn")}</Text>
            <Pressable
              onPress={() => {
                onClose()
                router.push("/profile")
              }}
              style={s.button}
              accessibilityRole="button"
            >
              <Text style={s.buttonText}>{t("common.signIn")}</Text>
            </Pressable>
          </>
        ) : result ? (
          <Text style={[s.text, { marginTop: 16, color: result.ok ? colour.green700 : colour.red600 }]} accessibilityLiveRegion="polite">
            {result.text}
          </Text>
        ) : (
          <>
            <Text style={s.label}>{t("report.why")}</Text>
            <ScrollView style={{ maxHeight: 360 }}>
              {REASONS.map((r) => (
                <Pressable
                  key={r}
                  onPress={() => send(r)}
                  disabled={busy !== null}
                  style={[st.reason, busy !== null && busy !== r && s.disabled]}
                  accessibilityRole="button"
                  accessibilityState={{ busy: busy === r, disabled: busy !== null }}
                >
                  <Text style={s.text}>{t(`report.r.${r}` as Key)}</Text>
                  {busy === r ? <ActivityIndicator color={colour.brand} /> : null}
                </Pressable>
              ))}
            </ScrollView>
          </>
        )}
        <Pressable onPress={onClose} style={s.quiet} accessibilityRole="button">
          <Text style={s.quietText}>{result ? t("report.done") : t("report.cancel")}</Text>
        </Pressable>
      </View>
    </Modal>
  )
}

const st = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)" },
  panel: { backgroundColor: colour.white, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 32 },
  reason: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colour.slate200,
  },
})
