import { useEffect, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Stack, router, useLocalSearchParams } from "expo-router"
import { ActivityIndicator, Image, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, Text, View } from "react-native"
import { useEventListener } from "expo"
import { useVideoPlayer, VideoView } from "expo-video"

import { AskBox } from "../../components/AskBox"
import { Comments } from "../../components/Comments"
import { api, detail } from "../../lib/api"
import { useAuth } from "../../lib/auth"
import { clock, compact } from "../../lib/format"
import { sendProgress } from "../../lib/progress"
import { colour, s } from "../../lib/theme"
import type { VideoDetail } from "../../lib/types"

function useWatchPlayer(video: VideoDetail | undefined, startMs: number, track: boolean) {
  const url = video?.playback.type === "hls" ? video.playback.url : null
  const player = useVideoPlayer(url, (p) => {
    p.timeUpdateEventInterval = 1
    if (startMs > 0) p.currentTime = startMs / 1000
    p.play()
  })
  const started = useRef(false)
  const watched = useRef(0)
  const last = useRef(0)
  const sinceSent = useRef(0)

  useEventListener(player, "timeUpdate", ({ currentTime }) => {
    if (!video || !track) return
    const step = currentTime - last.current
    last.current = currentTime
    if (step <= 0 || step > 2) return
    watched.current += step
    sinceSent.current += step
    if (!started.current) {
      started.current = true
      sendProgress(video.id, { position_ms: currentTime * 1000, started: true })
    } else if (sinceSent.current >= 15) {
      sendProgress(video.id, { position_ms: currentTime * 1000, watched_ms: sinceSent.current * 1000 })
      sinceSent.current = 0
    }
  })

  useEventListener(player, "playToEnd", () => {
    if (!video || !track) return
    sendProgress(video.id, { position_ms: video.duration_ms, watched_ms: sinceSent.current * 1000, completed: true })
    sinceSent.current = 0
  })

  return { player, url }
}

export default function Watch() {
  const { id, t } = useLocalSearchParams<{ id: string; t?: string }>()
  const { user } = useAuth()
  const [liked, setLiked] = useState<boolean | null>(null)
  const [following, setFollowing] = useState<boolean | null>(null)

  const { data: video, isLoading, error } = useQuery<VideoDetail>({
    queryKey: ["video", id, Boolean(user)],
    queryFn: async () => (await api.get(`/api/video/videos/${id}`)).data,
    enabled: Boolean(id),
  })

  const startMs = Number(t) || video?.resume_ms || 0
  const { player, url } = useWatchPlayer(video, startMs, Boolean(user))

  useEffect(() => {
    if (video) {
      setLiked(video.liked)
      setFollowing(video.following)
    }
  }, [video])

  function seek(ms: number) {
    player.currentTime = ms / 1000
    player.play()
  }

  async function toggle(kind: "like" | "follow") {
    if (!user) {
      router.push("/profile")
      return
    }
    if (!video) return
    const on = kind === "like" ? !liked : !following
    const path = kind === "like" ? `/api/video/videos/${video.id}/like` : `/api/video/channels/${video.channel.handle}/follow`
    if (kind === "like") setLiked(on)
    else setFollowing(on)
    try {
      if (on) await api.post(path)
      else await api.delete(path)
    } catch {
      if (kind === "like") setLiked(!on)
      else setFollowing(!on)
    }
  }

  if (isLoading) {
    return (
      <View style={s.centred}>
        <ActivityIndicator color={colour.brand} />
      </View>
    )
  }

  if (error || !video) {
    return (
      <View style={s.centred}>
        <Text style={s.error}>{detail(error, "This video could not be found.")}</Text>
      </View>
    )
  }

  const reel = video.kind === "reel"
  const embed = video.playback.type !== "hls" ? video.playback : null
  const chapters = video.insight?.chapters ?? []

  return (
    <KeyboardAvoidingView style={s.sheet} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      <Stack.Screen options={{ title: video.channel.name }} />
      <View style={{ width: "100%", aspectRatio: reel ? 9 / 12 : 16 / 9, backgroundColor: colour.night }}>
        {url ? (
          <VideoView player={player} style={{ flex: 1 }} contentFit="contain" nativeControls />
        ) : (
          <View style={{ flex: 1 }}>
            {video.thumbnail && <Image source={{ uri: video.thumbnail }} style={{ flex: 1 }} resizeMode="cover" />}
          </View>
        )}
      </View>
      {embed && (
        <View style={[s.card, { marginHorizontal: 16 }]}>
          <Text style={s.text}>{embed.credit}</Text>
          <Pressable onPress={() => Linking.openURL(embed.source_url)} style={[s.button, { marginTop: 10 }]}>
            <Text style={s.buttonText}>Watch on {embed.type === "youtube" ? "YouTube" : "Bilibili"}</Text>
          </Pressable>
        </View>
      )}
      <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
        <Text style={s.title}>{video.title}</Text>
        <Text style={s.subtitle}>
          {compact(video.views)} views · {video.duration}
        </Text>
        {video.ai_generated && (
          <View style={[s.chip, { marginTop: 8 }]}>
            <Text style={s.chipText}>AI-generated</Text>
          </View>
        )}

        <View style={[s.row, { marginTop: 16 }]}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: "700", color: colour.navy }}>{video.channel.name}</Text>
            <Text style={{ fontSize: 12, color: colour.slate500 }}>
              @{video.channel.handle} · {compact(video.channel.followers)} followers
            </Text>
          </View>
          {!video.is_owner && (
            <Pressable onPress={() => toggle("follow")} style={[s.chip, following ? { backgroundColor: colour.brand } : null]}>
              <Text style={[s.chipText, following ? { color: colour.white } : null]}>{following ? "Following" : "Follow"}</Text>
            </Pressable>
          )}
        </View>

        <Pressable onPress={() => toggle("like")} style={[s.outline, liked ? { backgroundColor: colour.brandLight } : null]}>
          <Text style={s.outlineText}>
            {liked ? "♥ Liked" : "♡ Like"} · {compact(video.likes + (liked === null ? 0 : Number(liked) - Number(video.liked)))}
          </Text>
        </Pressable>

        {video.insight?.summary ? (
          <>
            <Text style={s.heading}>Summary</Text>
            <Text style={[s.text, { marginTop: 6 }]}>{video.insight.summary}</Text>
          </>
        ) : video.ai_status && video.ai_status !== "ready" ? (
          <Text style={s.note}>The summary and chapters are still being prepared.</Text>
        ) : null}

        {chapters.length > 0 && (
          <>
            <Text style={s.heading}>Chapters</Text>
            {chapters.map((c) => (
              <Pressable key={`${c.start_ms}-${c.title}`} onPress={() => seek(c.start_ms)} style={[s.row, { paddingVertical: 10 }]}>
                <Text style={[s.text, { flex: 1 }]}>{c.title}</Text>
                <Text style={s.link}>{clock(c.start_ms)}</Text>
              </Pressable>
            ))}
          </>
        )}

        {video.description ? (
          <>
            <Text style={s.heading}>About</Text>
            <Text style={[s.text, { marginTop: 6 }]}>{video.description}</Text>
          </>
        ) : null}

        {url && <AskBox publicId={video.id} onSeek={seek} />}
        <Comments publicId={video.id} />
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
