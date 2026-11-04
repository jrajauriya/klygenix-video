import { useEffect, useState } from "react"
import { Stack } from "expo-router"
import { FlatList, Image, Pressable, Text, View } from "react-native"
import { useVideoPlayer, VideoView } from "expo-video"

import { useAuth } from "../lib/auth"
import { isExpired, loadDownloads, removeDownloads, sweepDownloads, useDownloads, type Download } from "../lib/downloads"
import { clock, day } from "../lib/format"
import { useT } from "../lib/i18n"
import { colour, s } from "../lib/theme"

function OfflinePlayer({ item }: { item: Download }) {
  const player = useVideoPlayer(item.file, (p) => {
    p.staysActiveInBackground = true
    p.showNowPlayingNotification = true
    p.play()
  })
  return (
    <View style={{ width: "100%", aspectRatio: item.kind === "reel" ? 9 / 12 : 16 / 9, backgroundColor: colour.night }}>
      <VideoView player={player} style={{ flex: 1 }} contentFit="contain" nativeControls allowsPictureInPicture startsPictureInPictureAutomatically />
    </View>
  )
}

export default function Downloads() {
  const { user } = useAuth()
  const { t } = useT()
  const { items } = useDownloads()
  const [playing, setPlaying] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    loadDownloads()
      .then(() => sweepDownloads(Boolean(user)))
      .catch(() => null)
  }, [user])

  const current = items.find((d) => d.id === playing) ?? null

  function play(d: Download) {
    if (isExpired(d)) {
      removeDownloads([d.id])
      setNotice(t("download.expired"))
      return
    }
    setNotice(null)
    setPlaying(d.id)
  }

  function remove(d: Download) {
    if (playing === d.id) setPlaying(null)
    removeDownloads([d.id])
  }

  return (
    <View style={s.sheet}>
      <Stack.Screen options={{ title: t("download.title") }} />
      {current && <OfflinePlayer key={current.id} item={current} />}
      <FlatList
        data={items}
        keyExtractor={(d) => d.id}
        contentContainerStyle={s.body}
        ListHeaderComponent={
          <>
            {current && <Text style={s.title}>{current.title}</Text>}
            {notice && <Text style={s.error}>{notice}</Text>}
            <Text style={s.note}>{t("download.policy")}</Text>
          </>
        }
        ListEmptyComponent={<Text style={[s.text, { marginTop: 24, color: colour.slate500 }]}>{t("download.empty")}</Text>}
        renderItem={({ item: d }) => (
          <View style={[s.card, { flexDirection: "row", gap: 12, alignItems: "center" }, playing === d.id && { borderColor: colour.brand }]}>
            <Pressable
              onPress={() => play(d)}
              style={{ flex: 1, flexDirection: "row", gap: 12, alignItems: "center" }}
              accessibilityRole="button"
              accessibilityLabel={t("download.play", { title: d.title })}
            >
              {d.thumbnail ? (
                <Image source={{ uri: d.thumbnail }} style={{ width: 80, height: 45, borderRadius: 6, backgroundColor: colour.slate200 }} />
              ) : (
                <View style={{ width: 80, height: 45, borderRadius: 6, backgroundColor: colour.slate200 }} />
              )}
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: "600", color: colour.navy }} numberOfLines={2}>
                  {d.title}
                </Text>
                <Text style={{ marginTop: 2, fontSize: 12, color: colour.slate500 }} numberOfLines={1}>
                  {[d.channel, clock(d.duration_ms), d.quality].filter(Boolean).join(" · ")}
                </Text>
                <Text style={{ marginTop: 2, fontSize: 12, color: colour.slate400 }}>
                  {t("download.expires", { day: day(new Date(d.license_expires_at * 1000).toISOString()) })}
                </Text>
              </View>
            </Pressable>
            <Pressable onPress={() => remove(d)} accessibilityRole="button" accessibilityLabel={t("download.deleteLabel", { title: d.title })} hitSlop={8}>
              <Text style={[s.link, { color: colour.red600 }]}>{t("download.delete")}</Text>
            </Pressable>
          </View>
        )}
      />
    </View>
  )
}
