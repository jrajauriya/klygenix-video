import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { router } from "expo-router"
import { AppState, Linking, Pressable, Switch, Text, View } from "react-native"

import { detail } from "../lib/api"
import { useAuth } from "../lib/auth"
import { day } from "../lib/format"
import { useT } from "../lib/i18n"
import { NOTIFY_KINDS, appPath, notifyHistory, notifyPrefs, saveNotifyPrefs } from "../lib/notifications"
import { pushAllowed } from "../lib/push"
import { colour, s } from "../lib/theme"
import type { NotifyKind, NotifyPrefs, PushRecord } from "../lib/types"

const SHORT = 5

function useOsAllowed() {
  const [allowed, setAllowed] = useState(true)
  useEffect(() => {
    pushAllowed().then(setAllowed)
    const sub = AppState.addEventListener("change", (state) => state === "active" && pushAllowed().then(setAllowed))
    return () => sub.remove()
  }, [])
  return allowed
}

function HistoryRow({ m }: { m: PushRecord }) {
  const { t } = useT()
  const path = appPath(m.data?.url)
  const flag = m.status === "skipped" ? t("notify.skipped") : m.status === "failed" ? t("notify.failed") : null
  return (
    <Pressable
      onPress={() => path && router.push(path as never)}
      disabled={!path}
      style={{ marginTop: 12 }}
      accessibilityRole={path ? "button" : "text"}
    >
      <View style={[s.row, { gap: 8 }]}>
        <Text style={{ flex: 1, fontWeight: "600", color: colour.navy }} numberOfLines={1}>
          {m.title}
        </Text>
        <Text style={{ fontSize: 12, color: colour.slate400 }}>{day(m.created_at)}</Text>
      </View>
      <Text style={{ marginTop: 2, fontSize: 13, color: colour.slate500 }} numberOfLines={2}>
        {m.body}
        {flag ? ` · ${flag}` : ""}
      </Text>
    </Pressable>
  )
}

export function NotificationSettings() {
  const { user } = useAuth()
  const { t } = useT()
  const qc = useQueryClient()
  const allowed = useOsAllowed()
  const [all, setAll] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const key = ["notify-prefs", user?.id]

  const prefs = useQuery({ queryKey: key, queryFn: notifyPrefs })
  const history = useQuery({ queryKey: ["notify-history", user?.id], queryFn: notifyHistory })

  const save = useMutation({
    mutationFn: (patch: Partial<NotifyPrefs>) => saveNotifyPrefs(patch),
    onMutate: (patch) => {
      setError(null)
      const before = qc.getQueryData<NotifyPrefs>(key)
      if (before) qc.setQueryData<NotifyPrefs>(key, { ...before, ...patch })
      return { before }
    },
    onSuccess: (next) => qc.setQueryData(key, next),
    onError: (err, _patch, ctx) => {
      if (ctx?.before) qc.setQueryData(key, ctx.before)
      setError(detail(err, t("notify.saveFailed")))
    },
  })

  const rows = history.data ?? []
  const shown = all ? rows : rows.slice(0, SHORT)

  return (
    <View>
      <Text style={s.heading}>{t("notify.title")}</Text>
      {!allowed && (
        <View style={[s.card, { borderColor: "#fde68a", backgroundColor: "#fffbeb" }]}>
          <Text style={s.text}>{t("notify.osOff")}</Text>
          <Pressable onPress={() => Linking.openSettings().catch(() => null)} style={{ marginTop: 6 }} accessibilityRole="button">
            <Text style={s.link}>{t("notify.openSettings")}</Text>
          </Pressable>
        </View>
      )}
      {prefs.data &&
        NOTIFY_KINDS.map((k: NotifyKind) => (
          <View key={k} style={[s.row, { marginTop: 14 }]}>
            <Text style={[s.text, { flex: 1, paddingRight: 12 }]}>{t(`notify.${k}`)}</Text>
            <Switch
              value={prefs.data[k] ?? true}
              onValueChange={(on) => save.mutate({ [k]: on })}
              trackColor={{ true: colour.brand }}
              accessibilityLabel={t(`notify.${k}`)}
            />
          </View>
        ))}
      {prefs.isError && <Text style={s.error}>{detail(prefs.error, t("notify.saveFailed"))}</Text>}
      {error && <Text style={s.error}>{error}</Text>}

      <Text style={[s.label, { marginTop: 24 }]}>{t("notify.history")}</Text>
      {history.isLoading ? (
        <Text style={s.note}>{t("notify.loading")}</Text>
      ) : rows.length === 0 ? (
        <Text style={s.note}>{t("notify.empty")}</Text>
      ) : (
        <>
          {shown.map((m) => (
            <HistoryRow key={m.id} m={m} />
          ))}
          {rows.length > SHORT && (
            <Pressable onPress={() => setAll(!all)} style={{ marginTop: 10 }} accessibilityRole="button">
              <Text style={s.link}>{all ? t("common.showLess") : t("common.showMore")}</Text>
            </Pressable>
          )}
        </>
      )}
    </View>
  )
}
