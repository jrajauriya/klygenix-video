import { useQuery } from "@tanstack/react-query"
import { router } from "expo-router"
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import { detail } from "../../lib/api"
import { useAuth } from "../../lib/auth"
import { day } from "../../lib/format"
import { useT } from "../../lib/i18n"
import { myStudy, watchHistory } from "../../lib/study"
import { colour, s } from "../../lib/theme"

interface Item {
  id: string
  title: string
  line: string
}

function Row({ item }: { item: Item }) {
  const { t } = useT()
  return (
    <Pressable
      onPress={() => router.push(`/study/${item.id}`)}
      style={[s.card, s.row, { gap: 12 }]}
      accessibilityRole="button"
      accessibilityLabel={`${t("study.title")}: ${item.title}`}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ fontWeight: "600", color: colour.navy }} numberOfLines={2}>
          {item.title}
        </Text>
        {item.line ? (
          <Text style={{ marginTop: 2, fontSize: 12, color: colour.slate500 }} numberOfLines={1}>
            {item.line}
          </Text>
        ) : null}
      </View>
      <Text style={s.link}>›</Text>
    </Pressable>
  )
}

export default function Study() {
  const { user } = useAuth()
  const { t } = useT()
  const mine = useQuery({ queryKey: ["my-study", user?.id], queryFn: myStudy, enabled: Boolean(user) })
  const fallback = mine.isSuccess && mine.data.length === 0
  const history = useQuery({ queryKey: ["study-history", user?.id], queryFn: watchHistory, enabled: Boolean(user) && fallback })

  const header = (
    <View>
      <Text style={s.title}>{t("study.title")}</Text>
      <Text style={s.subtitle}>{t("study.subtitle")}</Text>
    </View>
  )

  if (!user) {
    return (
      <SafeAreaView style={s.sheet} edges={["top"]}>
        <View style={s.body}>
          {header}
          <Text style={[s.text, { marginTop: 24 }]}>{t("study.signIn")}</Text>
          <Pressable onPress={() => router.push("/profile")} style={s.button} accessibilityRole="button">
            <Text style={s.buttonText}>{t("common.signIn")}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    )
  }

  const items: Item[] = fallback
    ? (history.data ?? []).map((v) => ({
        id: v.id,
        title: v.title,
        line: [v.channel.name, v.watched_at ? t("study.watched", { day: day(v.watched_at) }) : ""].filter(Boolean).join(" · "),
      }))
    : (mine.data ?? []).map((r) => ({
        id: r.video.id,
        title: r.video.title,
        line: [
          r.notes ? t("study.notesCount", { n: r.notes }) : "",
          r.best_score !== null && r.best_total ? t("study.bestQuiz", { score: r.best_score, total: r.best_total }) : "",
          r.last_activity_at ? t("study.active", { day: day(r.last_activity_at) }) : "",
        ]
          .filter(Boolean)
          .join(" · "),
      }))
  const active = fallback ? history : mine

  return (
    <SafeAreaView style={s.sheet} edges={["top"]}>
      <FlatList
        data={items}
        keyExtractor={(v) => v.id}
        renderItem={({ item }) => <Row item={item} />}
        contentContainerStyle={s.body}
        ListHeaderComponent={
          <View>
            {header}
            {items.length > 0 && <Text style={s.label}>{fallback ? t("study.recent") : t("study.yours")}</Text>}
          </View>
        }
        ListEmptyComponent={
          mine.isLoading || active.isLoading ? (
            <ActivityIndicator style={{ marginTop: 32 }} color={colour.brand} />
          ) : active.isError ? (
            <View>
              <Text style={s.error}>{detail(active.error, t("study.failed"))}</Text>
              <Pressable onPress={() => active.refetch()} style={s.outline}>
                <Text style={s.outlineText}>{t("common.tryAgain")}</Text>
              </Pressable>
            </View>
          ) : (
            <Text style={[s.note, { marginTop: 24 }]}>{t("study.empty")}</Text>
          )
        }
        refreshing={mine.isRefetching || history.isRefetching}
        onRefresh={() => {
          mine.refetch()
          if (fallback) history.refetch()
        }}
      />
    </SafeAreaView>
  )
}
