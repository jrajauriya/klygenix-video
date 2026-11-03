import { useCallback, useRef, useState } from "react"
import { useInfiniteQuery } from "@tanstack/react-query"
import { useIsFocused } from "expo-router"
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { LiveNowRow } from "../../components/LiveNowRow"
import { ReelItem } from "../../components/ReelItem"
import { api, detail } from "../../lib/api"
import { useAuth } from "../../lib/auth"
import { useT } from "../../lib/i18n"
import { colour, s } from "../../lib/theme"
import type { VideoCard } from "../../lib/types"

const PAGE = 6

export default function Feed() {
  const focused = useIsFocused()
  const [height, setHeight] = useState(0)
  const [active, setActive] = useState(0)
  const [muted, setMuted] = useState(true)
  const { user } = useAuth()
  const { t } = useT()
  const insets = useSafeAreaInsets()

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
        active={focused && index === active}
        muted={muted}
        onToggleMute={() => setMuted((m) => !m)}
      />
    ),
    [height, active, muted, focused],
  )

  return (
    <View style={{ flex: 1, backgroundColor: colour.night }} onLayout={(e) => setHeight(e.nativeEvent.layout.height)}>
      {feed.isLoading || height === 0 ? (
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
      {focused && <LiveNowRow top={insets.top + 8} />}
    </View>
  )
}
