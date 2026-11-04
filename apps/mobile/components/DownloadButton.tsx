import { useEffect, useState } from "react"
import { router } from "expo-router"
import { Pressable, Text, View } from "react-native"

import { openWeb } from "../lib/api"
import { cancelDownload, loadDownloads, startDownload, useDownloads, type StartResult } from "../lib/downloads"
import { useT } from "../lib/i18n"
import { colour, s } from "../lib/theme"
import type { VideoCard } from "../lib/types"

export function DownloadButton({ video }: { video: VideoCard }) {
  const { t } = useT()
  const { items, progress } = useDownloads()
  const [result, setResult] = useState<StartResult | null>(null)

  useEffect(() => {
    loadDownloads().catch(() => null)
  }, [])

  const saved = items.some((d) => d.id === video.id)
  const pct = progress[video.id]
  const busy = pct !== undefined

  async function go() {
    setResult(null)
    setResult(await startDownload(video))
  }

  if (saved) {
    return (
      <Pressable onPress={() => router.push("/downloads")} style={[s.outline, { backgroundColor: colour.brandLight }]} accessibilityRole="button" accessibilityLabel={t("download.done")}>
        <Text style={s.outlineText}>✓ {t("download.done")}</Text>
      </Pressable>
    )
  }

  return (
    <View>
      {busy ? (
        <View style={[s.outline, s.row]}>
          <Text style={[s.outlineText, { flex: 1, textAlign: "left" }]} accessibilityLiveRegion="polite">
            {t("download.downloading", { pct: Math.round(pct * 100) })}
          </Text>
          <Pressable onPress={() => cancelDownload(video.id)} accessibilityRole="button" accessibilityLabel={t("download.cancel")} hitSlop={8}>
            <Text style={s.link}>{t("download.cancel")}</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable onPress={go} style={s.outline} accessibilityRole="button" accessibilityLabel={t("download.button")}>
          <Text style={s.outlineText}>↓ {t("download.button")}</Text>
        </Pressable>
      )}
      {busy && (
        <View style={{ marginTop: 6, height: 4, borderRadius: 2, backgroundColor: colour.slate200, overflow: "hidden" }}>
          <View style={{ width: `${Math.round(pct * 100)}%`, height: 4, backgroundColor: colour.brand }} />
        </View>
      )}
      {result === "premium" && (
        <View style={[s.card, { borderColor: "#fde68a", backgroundColor: "#fffbeb" }]}>
          <Text style={s.text}>{t("download.premium")}</Text>
          <Pressable onPress={() => openWeb("/plans")} style={{ marginTop: 6 }} accessibilityRole="link" accessibilityLabel={t("download.getPremium")}>
            <Text style={s.link}>{t("download.getPremium")} ↗</Text>
          </Pressable>
        </View>
      )}
      {result === "not_allowed" && <Text style={s.error}>{t("download.notAllowed")}</Text>}
      {result === "failed" && <Text style={s.error}>{t("download.failed")}</Text>}
    </View>
  )
}
