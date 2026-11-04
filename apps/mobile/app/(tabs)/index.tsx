import { useCallback, useRef, useState } from "react"
import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import { useIsFocused } from "expo-router"
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { InboxBell } from "../../components/InboxBell"
import { LiveNowRow } from "../../components/LiveNowRow"
import { ReelItem } from "../../components/ReelItem"
import { SubscriptionsList } from "../../components/SubscriptionsList"
import { api, detail } from "../../lib/api"
import { useAuth } from "../../lib/auth"
import { useT } from "../../lib/i18n"
import { colour, s } from "../../lib/theme"
import type { Subscriptions, VideoCard } from "../../lib/types"

const PAGE = 6
const HEADER = 48

type Mode = "reels" | "subs"

function Segments({ mode, onChange, fresh }: { mode: Mode; onChange: (m: Mode) => void; fresh: number }) {
  const { t } = useT()
  const tabs: { key: Mode; label: string }[] = [
    { key: "reels", label: t("feed.forYou") },
    { key: "subs", label: t("feed.subscriptions") },
  ]
  return (
    <View style={st.segments} accessibilityRole="tablist">
      {tabs.map((tab) => {
        const on = mode === tab.key
        const badge = tab.key === "subs" && fresh > 0 ? t("feed.newCount", { n: fresh }) : null
        return (
          <Pressable
            key={tab.key}
            onPress={() => onChange(tab.key)}
            style={[st.segment, on && st.segmentOn]}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={badge ? `${tab.label}, ${badge}` : tab.label}
          >
            <Text style={[st.segmentText, on && st.segmentTextOn]}>{tab.label}</Text>
            {badge && (
              <View style={st.fresh}>
                <Text style={st.freshText}>{fresh > 99 ? "99+" : fresh}</Text>
              </View>
            )}
          </Pressable>
        )
      })}
    </View>
  )
}

export default function Feed() {
  const focused = useIsFocused()
  const [height, setHeight] = useState(0)
  const [active, setActive] = useState(0)
  const [muted, setMuted] = useState(true)
  const { user } = useAuth()
  const { t } = useT()
  const insets = useSafeAreaInsets()
  const [mode, setMode] = useState<Mode>("reels")
  const subsCount = useQuery({
    queryKey: ["subs-count", user?.id],
    enabled: Boolean(user) && focused && mode === "reels",
    refetchInterval: 120_000,
    queryFn: async () =>
      (await api.get<Subscriptions>("/api/video/feed/subscriptions", { params: { limit: 1, mark_seen: false } })).data.new_count,
  })

  const feed = useInfiniteQuery({
    queryKey: ["feed-reels", user?.id ?? null],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const res = await api.get<VideoCard[]>("/api/video/feed/reels", { params: { limit: PAGE, offset: pageParam } })
      const total = Number(res.headers?.["x-total-count"])
      return { rows: res.data, offset: pageParam, total: Number.isFinite(total) ? total : undefined }
    },
    getNextPageParam: (last) => {
      const next = last.offset + last.rows.length
      if (last.rows.length < PAGE) return undefined
      if (last.total !== undefined && next >= last.total) return undefined
      return next
    },
  })

  const rows = feed.data?.pages.flatMap((p) => p.rows) ?? []

  const onViewable = useRef(({ viewableItems }: { viewableItems: { index?: number | null; isViewable: boolean }[] }) => {
    const first = viewableItems.find((v) => v.isViewable)
    if (first?.index != null) setActive(first.index)
  }).current

  const render = useCallback(
    ({ item, index }: { item: VideoCard; index: number }) => (
      <ReelItem
        video={item}
        height={height}
        active={focused && mode === "reels" && index === active}
        muted={muted}
        onToggleMute={() => setMuted((m) => !m)}
      />
    ),
    [height, active, muted, focused, mode],
  )

  return (
    <View style={{ flex: 1, backgroundColor: colour.night }} onLayout={(e) => setHeight(e.nativeEvent.layout.height)}>
      {mode === "subs" ? (
        <SubscriptionsList top={insets.top + HEADER + 8} />
      ) : feed.isLoading || height === 0 ? (
        <View style={s.centred}>
          <ActivityIndicator color={colour.brand} />
        </View>
      ) : feed.isError ? (
        <View style={s.centred}>
          <Text style={{ color: colour.white, textAlign: "center" }}>{detail(feed.error, t("feed.error"))}</Text>
          <Pressable onPress={() => feed.refetch()} style={s.button}>
            <Text style={s.buttonText}>{t("common.tryAgain")}</Text>
          </Pressable>
        </View>
      ) : rows.length === 0 ? (
        <View style={s.centred}>
          <Text style={{ color: colour.white }}>{t("feed.empty")}</Text>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(v) => v.id}
          renderItem={render}
          pagingEnabled
          showsVerticalScrollIndicator={false}
          snapToInterval={height}
          snapToAlignment="start"
          decelerationRate="fast"
          getItemLayout={(_, index) => ({ length: height, offset: height * index, index })}
          onViewableItemsChanged={onViewable}
          viewabilityConfig={{ itemVisiblePercentThreshold: 80 }}
          onEndReached={() => feed.hasNextPage && !feed.isFetchingNextPage && feed.fetchNextPage()}
          onEndReachedThreshold={1.5}
          windowSize={3}
          initialNumToRender={2}
          maxToRenderPerBatch={2}
          removeClippedSubviews
          refreshing={feed.isRefetching && !feed.isFetchingNextPage}
          onRefresh={() => feed.refetch()}
        />
      )}
      {focused && mode === "reels" && <LiveNowRow top={insets.top + HEADER + 8} />}
      <View style={[st.header, { top: insets.top + 4 }]}>
        <Segments mode={mode} onChange={setMode} fresh={user ? (subsCount.data ?? 0) : 0} />
        <InboxBell />
      </View>
    </View>
  )
}

const st = StyleSheet.create({
  header: { position: "absolute", left: 12, right: 12, height: HEADER - 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  segments: { flexDirection: "row", gap: 4, borderRadius: 999, backgroundColor: "rgba(11,11,18,0.72)", padding: 3 },
  segment: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  segmentOn: { backgroundColor: colour.white },
  segmentText: { fontSize: 13, fontWeight: "700", color: colour.white },
  segmentTextOn: { color: colour.navy },
  fresh: { minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: colour.brand, alignItems: "center", justifyContent: "center" },
  freshText: { fontSize: 10, fontWeight: "800", color: colour.white },
})
