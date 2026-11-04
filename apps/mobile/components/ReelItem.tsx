import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { router } from "expo-router"
import { Image, Linking, Pressable, StyleSheet, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { api } from "../lib/api"
import { useAuth } from "../lib/auth"
import { compact } from "../lib/format"
import { colour } from "../lib/theme"
import type { VideoCard, VideoDetail } from "../lib/types"
import { AccessBadge } from "./AccessBadge"
import { LockCard } from "./LockCard"
import { PaidPartnership } from "./PaidPartnership"
import { ReelPlayer } from "./ReelPlayer"

interface Props {
  video: VideoCard
  height: number
  active: boolean
  muted: boolean
  onToggleMute: () => void
}

function Action({ label, value, onPress, on }: { label: string; value: string; onPress: () => void; on?: boolean }) {
  return (
    <Pressable onPress={onPress} style={st.action} accessibilityRole="button" accessibilityLabel={label}>
      <View style={[st.actionDot, on && { backgroundColor: colour.brand }]}>
        <Text style={st.actionGlyph}>{label === "Like" ? "♥" : label === "Comments" ? "✎" : "+"}</Text>
      </View>
      <Text style={st.actionText}>{value}</Text>
    </Pressable>
  )
}

export function ReelItem({ video, height, active, muted, onToggleMute }: Props) {
  const { user } = useAuth()
  const insets = useSafeAreaInsets()
  const [liked, setLiked] = useState(video.liked ?? false)
  const [likes, setLikes] = useState(video.likes)
  const [following, setFollowing] = useState(video.following ?? false)
  const [seen, setSeen] = useState(video)
  const [ended, setEnded] = useState(false)
  const [wasActive, setWasActive] = useState(active)
  if (seen !== video) {
    setSeen(video)
    setLiked(video.liked ?? false)
    setLikes(video.likes)
    setFollowing(video.following ?? false)
  }
  if (wasActive !== active) {
    setWasActive(active)
    if (!active) setEnded(false)
  }
  const gated = Boolean(video.access && video.access !== "free")
  const full = useQuery<VideoDetail>({
    queryKey: ["video", video.id, Boolean(user)],
    queryFn: async () => (await api.get(`/api/video/videos/${video.id}`)).data,
    enabled: gated && active,
    staleTime: 60_000,
  })
  const lock = gated ? (full.data?.locked ?? null) : null
  const waiting = gated && !full.data
  const previewUrl = full.data?.playback?.type === "hls" ? full.data.playback.url : null
  const hls = waiting ? null : lock ? previewUrl : video.playback?.type === "hls" ? video.playback.url : null
  const showLock = Boolean(lock) && (ended || !hls)
  const embed = video.playback && video.playback.type !== "hls" ? video.playback : null

  function needSignIn(): boolean {
    if (user) return false
    router.push("/profile")
    return true
  }

  async function toggleLike() {
    if (needSignIn()) return
    const next = !liked
    setLiked(next)
    setLikes((n) => n + (next ? 1 : -1))
    try {
      if (next) await api.post(`/api/video/videos/${video.id}/like`)
      else await api.delete(`/api/video/videos/${video.id}/like`)
    } catch {
      setLiked(!next)
      setLikes((n) => n + (next ? -1 : 1))
    }
  }

  async function toggleFollow() {
    if (needSignIn()) return
    const next = !following
    setFollowing(next)
    try {
      if (next) await api.post(`/api/video/channels/${video.channel.handle}/follow`)
      else await api.delete(`/api/video/channels/${video.channel.handle}/follow`)
    } catch {
      setFollowing(!next)
    }
  }

  return (
    <View style={[st.page, { height }]}>
      {active && hls && !showLock ? (
        <ReelPlayer
          publicId={video.id}
          url={hls}
          muted={muted}
          track={Boolean(user) && !lock}
          limitSeconds={lock?.preview_seconds || undefined}
          onDone={lock ? () => setEnded(true) : undefined}
        />
      ) : video.thumbnail ? (
        <Image source={{ uri: video.thumbnail }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : null}

      <Pressable style={StyleSheet.absoluteFill} onPress={hls ? onToggleMute : undefined} accessibilityLabel="Toggle sound" />

      {hls && !showLock && (
        <Pressable onPress={onToggleMute} style={[st.mute, { top: insets.top + 56 }]} accessibilityRole="button" accessibilityLabel={muted ? "Turn sound on" : "Turn sound off"}>
          <Text style={st.muteText}>{muted ? "Sound off" : "Sound on"}</Text>
        </Pressable>
      )}

      {lock && showLock && (
        <View style={st.lock}>
          <LockCard lock={lock} publicId={video.id} ended={ended} dark />
        </View>
      )}

      {embed && (
        <View style={st.embed}>
          <Text style={st.embedText}>{embed.credit}</Text>
          <Pressable onPress={() => Linking.openURL(embed.source_url)} style={st.embedButton}>
            <Text style={st.embedButtonText}>Watch on {embed.type === "youtube" ? "YouTube" : "Bilibili"}</Text>
          </Pressable>
        </View>
      )}

      <View style={st.side}>
        <Action label="Like" value={compact(likes)} onPress={toggleLike} on={liked} />
        <Action label="Comments" value={video.comments !== undefined ? compact(video.comments) : "Open"} onPress={() => router.push(`/watch/${video.id}`)} />
        <Action label="Follow" value={following ? "Following" : "Follow"} onPress={toggleFollow} on={following} />
      </View>

      <Pressable style={st.meta} onPress={() => router.push(`/watch/${video.id}`)} accessibilityRole="button" accessibilityLabel={`Open ${video.title}`}>
        <Text style={st.handle}>@{video.channel.handle}</Text>
        <Text style={st.title} numberOfLines={2}>
          {video.title}
        </Text>
        <View style={{ flexDirection: "row", gap: 6, marginTop: 8 }}>
          {video.ai_generated && (
            <View style={st.ai}>
              <Text style={st.aiText}>AI-generated</Text>
            </View>
          )}
          <AccessBadge access={video.access} priceMinor={video.price_minor} dark />
        </View>
        {video.paid_partnership ? (
          <View style={{ marginTop: 6 }}>
            <PaidPartnership deal={video.paid_partnership} dark />
          </View>
        ) : null}
      </Pressable>
    </View>
  )
}

const st = StyleSheet.create({
  page: { width: "100%", backgroundColor: colour.night, overflow: "hidden" },
  side: { position: "absolute", right: 12, bottom: 120, alignItems: "center", gap: 18 },
  action: { alignItems: "center" },
  actionDot: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  actionGlyph: { color: colour.white, fontSize: 20 },
  actionText: { marginTop: 4, color: colour.white, fontSize: 12, fontWeight: "600" },
  meta: { position: "absolute", left: 16, right: 80, bottom: 24 },
  handle: { color: colour.white, fontWeight: "700", fontSize: 15 },
  title: { marginTop: 4, color: colour.white, fontSize: 14 },
  lock: { position: "absolute", left: 16, right: 80, top: "22%" },
  ai: { alignSelf: "flex-start", borderRadius: 6, backgroundColor: "rgba(162,28,175,0.85)", paddingHorizontal: 8, paddingVertical: 3 },
  aiText: { color: colour.white, fontSize: 11, fontWeight: "700" },
  mute: { position: "absolute", right: 12, borderRadius: 999, backgroundColor: "rgba(0,0,0,0.5)", paddingHorizontal: 12, paddingVertical: 6 },
  muteText: { color: colour.white, fontSize: 12, fontWeight: "600" },
  embed: { position: "absolute", left: 16, right: 16, top: "40%", alignItems: "center" },
  embedText: { color: colour.white, fontSize: 13, textAlign: "center" },
  embedButton: { marginTop: 12, borderRadius: 999, backgroundColor: colour.brand, paddingHorizontal: 18, paddingVertical: 10 },
  embedButtonText: { color: colour.white, fontWeight: "700" },
})
