import { useQuery } from "@tanstack/react-query"
import { Stack, router, useLocalSearchParams } from "expo-router"
import { ActivityIndicator, Image, Pressable, ScrollView, Text, View } from "react-native"

import { AccessBadge } from "../../components/AccessBadge"
import { Community } from "../../components/Community"
import { api, detail, openWeb } from "../../lib/api"
import { useAuth } from "../../lib/auth"
import { compact, price } from "../../lib/format"
import { colour, s } from "../../lib/theme"
import type { ChannelPage, Support, VideoCard } from "../../lib/types"

function Membership({ handle }: { handle: string }) {
  const { user } = useAuth()
  const { data } = useQuery<Support>({
    queryKey: ["support", handle, user?.id ?? null],
    queryFn: async () => (await api.get(`/api/video/channels/${handle}/support`)).data,
  })
  if (!data || data.is_owner || data.tiers.length === 0) return null
  const mine = data.tiers.filter((t) => t.rank <= data.my_rank).at(-1)
  return (
    <View style={s.card}>
      <Text style={s.cardLabel}>Membership</Text>
      {mine ? (
        <Text style={s.cardValue}>You are a {mine.name} member</Text>
      ) : (
        <Text style={[s.text, { marginTop: 4 }]}>
          {data.tiers.map((t) => `${t.name} · ${price(t.price_minor)} a month`).join("\n")}
        </Text>
      )}
      {data.can_take_money && (
        <Pressable
          onPress={() => openWeb(mine ? "/account?tab=memberships" : `/@${handle}`)}
          style={[s.outline, { marginTop: 10 }]}
          accessibilityRole="link"
          accessibilityLabel={mine ? "Manage on the web" : "Join on the web"}
        >
          <Text style={s.outlineText}>{mine ? "Manage on the web" : "Join on the web"}</Text>
        </Pressable>
      )}
    </View>
  )
}

function Videos({ handle }: { handle: string }) {
  const { data: videos = [], isLoading } = useQuery<VideoCard[]>({
    queryKey: ["channel-videos", handle],
    queryFn: async () => (await api.get(`/api/video/channels/${handle}/videos`, { params: { limit: 12 } })).data,
  })
  if (isLoading) return <Text style={s.note}>Loading videos…</Text>
  if (videos.length === 0) return <Text style={s.note}>No videos yet.</Text>
  return (
    <View>
      {videos.map((v) => (
        <Pressable
          key={v.id}
          onPress={() => router.push(`/watch/${v.id}`)}
          style={[s.card, { flexDirection: "row", gap: 12, alignItems: "center" }]}
          accessibilityRole="button"
          accessibilityLabel={`Watch ${v.title}`}
        >
          {v.thumbnail ? (
            <Image source={{ uri: v.thumbnail }} style={{ width: 96, height: 54, borderRadius: 6, backgroundColor: colour.slate200 }} />
          ) : (
            <View style={{ width: 96, height: 54, borderRadius: 6, backgroundColor: colour.slate200 }} />
          )}
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: "600", color: colour.navy }} numberOfLines={2}>
              {v.title}
            </Text>
            <Text style={{ marginTop: 2, fontSize: 12, color: colour.slate500 }}>
              {compact(v.views)} views · {v.duration}
            </Text>
            <View style={{ marginTop: 4 }}>
              <AccessBadge access={v.access} priceMinor={v.price_minor} />
            </View>
          </View>
        </Pressable>
      ))}
    </View>
  )
}

export default function Channel() {
  const { handle } = useLocalSearchParams<{ handle: string }>()
  const { user } = useAuth()
  const { data: channel, isLoading, error } = useQuery<ChannelPage>({
    queryKey: ["channel", handle, user?.id ?? null],
    queryFn: async () => (await api.get(`/api/video/channels/${handle}`)).data,
    enabled: Boolean(handle),
  })

  if (isLoading) {
    return (
      <View style={s.centred}>
        <ActivityIndicator color={colour.brand} />
      </View>
    )
  }

  if (error || !channel) {
    return (
      <View style={s.centred}>
        <Text style={s.error}>{detail(error, "This channel could not be found.")}</Text>
      </View>
    )
  }

  return (
    <ScrollView style={s.sheet} contentContainerStyle={s.body}>
      <Stack.Screen options={{ title: channel.name }} />
      <Text style={s.title}>
        {channel.name}
        {channel.verified ? " ✓" : ""}
      </Text>
      <Text style={s.subtitle}>
        @{channel.handle} · {compact(channel.followers)} followers
      </Text>
      {channel.about ? <Text style={[s.text, { marginTop: 10 }]}>{channel.about}</Text> : null}
      <Membership handle={channel.handle} />
      <Community handle={channel.handle} />
      <Text style={s.heading}>Videos</Text>
      <Videos handle={channel.handle} />
    </ScrollView>
  )
}
