import { useQuery } from "@tanstack/react-query"
import { router } from "expo-router"
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native"

import { compact } from "../lib/format"
import { useT } from "../lib/i18n"
import { liveNow } from "../lib/live"
import { colour } from "../lib/theme"

export function LiveNowRow({ top }: { top: number }) {
  const { t } = useT()
  const { data: rows = [] } = useQuery({ queryKey: ["live-now"], queryFn: liveNow, refetchInterval: 60_000 })
  if (rows.length === 0) return null

  return (
    <View style={[st.wrap, { top }]}>
      <Text style={st.heading}>{t("feed.liveNow")}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 8 }}>
        {rows.map((l) => (
          <Pressable
            key={l.id}
            onPress={() => router.push(`/live/${l.id}`)}
            style={st.chip}
            accessibilityRole="button"
            accessibilityLabel={`${t("live.badge")}: ${l.channel?.name ?? ""}, ${l.title}`}
          >
            <View style={st.badge}>
              <Text style={st.badgeText}>{t("live.badge")}</Text>
            </View>
            <View style={{ maxWidth: 160 }}>
              <Text style={st.name} numberOfLines={1}>
                {l.channel?.name ?? l.title}
              </Text>
              <Text style={st.title} numberOfLines={1}>
                {l.title} · {t("live.viewers", { n: compact(l.viewers) })}
              </Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  )
}

const st = StyleSheet.create({
  wrap: { position: "absolute", left: 12, right: 96 },
  heading: { marginBottom: 6, fontSize: 12, fontWeight: "700", color: colour.white, textTransform: "uppercase", letterSpacing: 0.6 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 999,
    backgroundColor: "rgba(11,11,18,0.72)",
    paddingLeft: 6,
    paddingRight: 12,
    paddingVertical: 6,
  },
  badge: { borderRadius: 999, backgroundColor: colour.red600, paddingHorizontal: 7, paddingVertical: 2 },
  badgeText: { fontSize: 10, fontWeight: "800", color: colour.white },
  name: { fontSize: 13, fontWeight: "700", color: colour.white },
  title: { fontSize: 11, color: colour.slate300 },
})
