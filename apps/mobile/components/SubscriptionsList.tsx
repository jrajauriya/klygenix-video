import { useEffect } from "react"
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query"
import { router } from "expo-router"
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, Text, View } from "react-native"

import { api, detail } from "../lib/api"
import { useAuth } from "../lib/auth"
import { compact } from "../lib/format"
import { useT } from "../lib/i18n"
import { colour, s } from "../lib/theme"
import type { Subscriptions, VideoCard } from "../lib/types"
import { AccessBadge } from "./AccessBadge"
import { PaidPartnership } from "./PaidPartnership"

const PAGE = 20

function Card({ video }: { video: VideoCard }) {
  const { t } = useT()
  const reel = video.kind === "reel"
  const meta = t("card.meta", { channel: video.channel.name, views: compact(video.views) })
  return (
    <Pressable
      onPress={() => router.push(`/watch/${video.id}`)}
      style={st.card}
      accessibilityRole="button"
      accessibilityLabel={`${video.new ? `${t("feed.new")}: ` : ""}${video.title}, ${meta}`}
    >
      <View style={[st.thumb, reel ? st.reel : null]}>
        {video.thumbnail ? <Image source={{ uri: video.thumbnail }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
        <Text style={st.duration}>{video.duration}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 4 }}>
          {video.new && (
            <View style={st.new}>
              <Text style={st.newText}>{t("feed.new")}</Text>
            </View>
          )}
          <AccessBadge access={video.access} priceMinor={video.price_minor} dark />
        </View>
        <Text style={st.title} numberOfLines={2}>
          {video.title}
        </Text>
        <Text style={st.meta} numberOfLines={1}>
          {meta}
        </Text>
        {video.paid_partnership ? (
          <View style={{ marginTop: 6 }}>
            <PaidPartnership deal={video.paid_partnership} dark />
          </View>
        ) : null}
      </View>
    </Pressable>
  )
}

export function SubscriptionsList({ top }: { top: number }) {
  const { user } = useAuth()
  const { t } = useT()
  const qc = useQueryClient()

  const feed = useInfiniteQuery({
    queryKey: ["feed-subscriptions", user?.id ?? null],
    enabled: Boolean(user),
    initialPageParam: 0,
    staleTime: 0,
    queryFn: async ({ pageParam }) => {
      const { data } = await api.get<Subscriptions>("/api/video/feed/subscriptions", { params: { limit: PAGE, offset: pageParam } })
      return { ...data, offset: pageParam }
    },
    getNextPageParam: (last) => (last.items.length < PAGE ? undefined : last.offset + last.items.length),
  })

  const first = feed.data?.pages[0]
  useEffect(() => {
    if (first) qc.setQueryData(["subs-count", user?.id], 0)
  }, [first, qc, user?.id])

  if (!user) {
    return (
      <View style={[s.centred, { paddingTop: top }]}>
        <Text style={st.empty}>{t("feed.subsSignIn")}</Text>
        <Pressable onPress={() => router.push("/profile")} style={s.button} accessibilityRole="button">
          <Text style={s.buttonText}>{t("common.signIn")}</Text>
        </Pressable>
      </View>
    )
  }

  if (feed.isLoading) {
    return (
      <View style={s.centred}>
        <ActivityIndicator color={colour.brand} />
      </View>
    )
  }

  if (feed.isError) {
    return (
      <View style={[s.centred, { paddingTop: top }]}>
        <Text style={st.empty}>{detail(feed.error, t("feed.subsFailed"))}</Text>
        <Pressable onPress={() => feed.refetch()} style={s.button} accessibilityRole="button">
          <Text style={s.buttonText}>{t("common.tryAgain")}</Text>
        </Pressable>
      </View>
    )
  }

  const rows = feed.data?.pages.flatMap((p) => p.items) ?? []

  return (
    <FlatList
      data={rows}
      keyExtractor={(v) => v.id}
      renderItem={({ item }) => <Card video={item} />}
      contentContainerStyle={{ paddingTop: top, paddingHorizontal: 12, paddingBottom: 24 }}
      ListHeaderComponent={first && first.new_count > 0 ? <Text style={st.header}>{t("feed.subsNew", { n: first.new_count })}</Text> : undefined}
      ListEmptyComponent={<Text style={[st.empty, { marginTop: 48 }]}>{t("feed.subsEmpty")}</Text>}
      onEndReached={() => feed.hasNextPage && !feed.isFetchingNextPage && feed.fetchNextPage()}
      onEndReachedThreshold={0.5}
      refreshing={feed.isRefetching && !feed.isFetchingNextPage}
      onRefresh={() => feed.refetch()}
    />
  )
}

const st = StyleSheet.create({
  card: { flexDirection: "row", gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colour.nightCard },
  thumb: { width: 144, aspectRatio: 16 / 9, borderRadius: 8, overflow: "hidden", backgroundColor: colour.nightCard },
  reel: { width: 72, aspectRatio: 9 / 16 },
  duration: {
    position: "absolute",
    right: 4,
    bottom: 4,
    backgroundColor: "rgba(0,0,0,0.8)",
    color: colour.white,
    fontSize: 11,
    fontWeight: "600",
    paddingHorizontal: 4,
    borderRadius: 4,
    overflow: "hidden",
  },
  new: { borderRadius: 6, backgroundColor: colour.brand, paddingHorizontal: 8, paddingVertical: 3 },
  newText: { color: colour.white, fontSize: 11, fontWeight: "800" },
  title: { color: colour.white, fontSize: 15, fontWeight: "600" },
  meta: { marginTop: 2, color: colour.slate400, fontSize: 12 },
  header: { marginBottom: 6, color: colour.slate300, fontSize: 13, fontWeight: "600" },
  empty: { color: colour.white, textAlign: "center", fontSize: 15 },
})
