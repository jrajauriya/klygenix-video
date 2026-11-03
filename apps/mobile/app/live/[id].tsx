import { useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Stack, router, useLocalSearchParams } from "expo-router"
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { useVideoPlayer, VideoView } from "expo-video"

import { detail, openWeb, statusOf } from "../../lib/api"
import { useAuth } from "../../lib/auth"
import { compact, price } from "../../lib/format"
import { useT } from "../../lib/i18n"
import { liveChat, liveDetail, openSuperChat, sendLiveChat, stillPinned, useLiveRoom } from "../../lib/live"
import { colour, s } from "../../lib/theme"
import type { LiveEvent, LiveMessage, LiveStatus } from "../../lib/types"

const KEEP = 200

function merge(list: LiveMessage[], item: LiveMessage): LiveMessage[] {
  if (list.some((m) => m.id === item.id)) {
    return item.mine ? list.map((m) => (m.id === item.id ? { ...m, mine: true } : m)) : list
  }
  const next = [...list, item]
  return next.length > KEEP ? next.slice(next.length - KEEP) : next
}

function Player({ url }: { url: string }) {
  const player = useVideoPlayer(url, (p) => p.play())
  return <VideoView player={player} style={{ flex: 1 }} contentFit="contain" nativeControls />
}

function Bubble({ m }: { m: LiveMessage }) {
  const { t } = useT()
  const paid = m.paid_minor > 0
  return (
    <View style={[st.bubble, m.mine && st.mine, paid && st.paid]}>
      <Text style={[st.author, m.mine && { color: colour.brand }]}>
        {m.mine ? `${m.author} (${t("live.you")})` : m.author}
        {paid ? <Text style={st.amount}>{`  ${price(m.paid_minor)}${m.tier ? ` · ${m.tier}` : ""}`}</Text> : null}
      </Text>
      {m.body ? <Text style={st.body}>{m.body}</Text> : null}
    </View>
  )
}

export default function Live() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { user } = useAuth()
  const { t } = useT()
  const [status, setStatus] = useState<LiveStatus | null>(null)
  const [viewers, setViewers] = useState<number | null>(null)
  const [slow, setSlow] = useState<number | null>(null)
  const [messages, setMessages] = useState<LiveMessage[]>([])
  const [pinned, setPinned] = useState<LiveMessage[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [body, setBody] = useState("")
  const [sending, setSending] = useState(false)
  const [now, setNow] = useState(Date.now())
  const [stream, setStream] = useState<{ url: string; expires_at: number } | null>(null)

  const live = useQuery({
    queryKey: ["live", id, user?.id ?? null],
    queryFn: () => liveDetail(id),
    enabled: Boolean(id),
    refetchInterval: (q) => (q.state.data?.status === "scheduled" || q.state.data?.status === "live" ? 60_000 : false),
  })
  const data = live.data
  const open = Boolean(data && !data.locked)

  const history = useQuery({
    queryKey: ["live-chat", id, user?.id ?? null],
    queryFn: () => liveChat(id),
    enabled: open,
    staleTime: Infinity,
  })

  useEffect(() => {
    if (!data) return
    setStatus(data.status)
    setViewers(data.viewers)
    setSlow(data.slow_mode_seconds)
    const next = data.status === "live" ? data.playback : null
    setStream((old) => (!next ? null : !old || old.expires_at * 1000 - Date.now() < 300_000 ? next : old))
    setPinned((old) => {
      const ids = new Set(data.pinned.map((m) => m.id))
      return [...data.pinned, ...old.filter((m) => !ids.has(m.id))]
    })
  }, [data])

  useEffect(() => {
    const seed = history.data
    if (seed) setMessages((old) => old.reduce(merge, seed))
  }, [history.data])

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(timer)
  }, [])

  const phase = status ?? data?.status
  const connected = useLiveRoom(id, open && (phase === "live" || phase === "scheduled"), (e: LiveEvent) => {
    switch (e.type) {
      case "hello":
        setViewers(e.viewers)
        if (e.status !== status) live.refetch()
        break
      case "live":
        setStatus("live")
        live.refetch()
        break
      case "viewers":
        setViewers(e.viewers)
        break
      case "chat":
      case "superchat":
      case "gift":
        setMessages((old) => merge(old, e.item))
        if (e.item.pinned_until) setPinned((old) => (old.some((m) => m.id === e.item.id) ? old : [...old, e.item]))
        break
      case "chat_removed":
        setMessages((old) => old.filter((m) => m.id !== e.id))
        setPinned((old) => old.filter((m) => m.id !== e.id))
        break
      case "timeout":
        if (user && e.user_id === user.id) setNotice(t("live.timedOut", { n: e.seconds }))
        break
      case "slow_mode":
        setSlow(e.seconds)
        break
      case "ended":
        setStatus("ended")
        live.refetch()
        break
    }
  })

  const shownPinned = useMemo(
    () => pinned.filter((m) => stillPinned(m, now)).sort((a, b) => b.paid_minor - a.paid_minor),
    [pinned, now],
  )

  async function send() {
    if (!user) {
      router.push("/profile")
      return
    }
    const text = body.trim()
    if (!text) return
    setSending(true)
    setNotice(null)
    try {
      const item = await sendLiveChat(id, text)
      setBody("")
      setMessages((old) => merge(old, { ...item, mine: true }))
    } catch (err) {
      setNotice(detail(err, t("live.sendFailed")))
      if (statusOf(err) === 409) live.refetch()
    } finally {
      setSending(false)
    }
  }

  if (live.isLoading) {
    return (
      <View style={s.centred}>
        <ActivityIndicator color={colour.brand} />
      </View>
    )
  }

  if (live.isError || !data) {
    return (
      <View style={s.centred}>
        <Text style={s.error}>{detail(live.error, t("live.notFound"))}</Text>
        <Pressable onPress={() => live.refetch()} style={s.button}>
          <Text style={s.buttonText}>{t("common.tryAgain")}</Text>
        </Pressable>
      </View>
    )
  }

  const current = status ?? data.status
  const isLive = current === "live"
  const url = isLive && stream ? stream.url : null
  const blocked = sending || !body.trim() || !isLive

  let stage
  if (data.locked) {
    stage = (
      <View style={st.stageBox}>
        <Text style={st.stageTitle}>{t("live.membersTitle")}</Text>
        <Text style={st.stageText}>{t("live.membersBody")}</Text>
        <Pressable onPress={() => openWeb(`/live/${data.id}`)} style={[s.button, { marginTop: 12 }]} accessibilityRole="link">
          <Text style={s.buttonText}>{t("common.openWeb")}</Text>
        </Pressable>
        {!user && (
          <Pressable onPress={() => router.push("/profile")} style={s.quiet} accessibilityRole="button">
            <Text style={[s.quietText, { color: colour.slate300 }]}>{t("common.signIn")}</Text>
          </Pressable>
        )}
      </View>
    )
  } else if (url) {
    stage = <Player key={url} url={url} />
  } else if (current === "scheduled") {
    stage = (
      <View style={st.stageBox}>
        <Text style={st.stageTitle}>{t("live.notStarted")}</Text>
        {data.scheduled_at && (
          <Text style={st.stageText}>
            {t("live.scheduled", {
              when: new Date(data.scheduled_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }),
            })}
          </Text>
        )}
      </View>
    )
  } else if (isLive) {
    stage = (
      <View style={st.stageBox}>
        <Text style={st.stageText}>{t("live.noPlayback")}</Text>
        <Pressable onPress={() => openWeb(`/live/${data.id}`)} style={[s.button, { marginTop: 12 }]} accessibilityRole="link">
          <Text style={s.buttonText}>{t("common.openWeb")}</Text>
        </Pressable>
      </View>
    )
  } else {
    stage = (
      <View style={st.stageBox}>
        <Text style={st.stageTitle}>{t("live.ended")}</Text>
        {data.replay && data.replay.status === "published" && (
          <Pressable onPress={() => router.replace(`/watch/${data.replay?.id}`)} style={[s.button, { marginTop: 12 }]} accessibilityRole="button">
            <Text style={s.buttonText}>{t("live.replay")}</Text>
          </Pressable>
        )}
      </View>
    )
  }

  return (
    <KeyboardAvoidingView style={s.sheet} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      <Stack.Screen options={{ title: data.channel?.name ?? "" }} />
      <View style={{ width: "100%", aspectRatio: 16 / 9, backgroundColor: colour.night }}>{stage}</View>

      <View style={st.head}>
        <View style={[s.row, { gap: 8 }]}>
          {isLive && (
            <View style={st.badge}>
              <Text style={st.badgeText}>{t("live.badge")}</Text>
            </View>
          )}
          <Text style={[s.text, { flex: 1, fontWeight: "700" }]} numberOfLines={2}>
            {data.title}
          </Text>
        </View>
        <Text style={s.subtitle}>
          {data.channel ? `@${data.channel.handle}` : ""}
          {viewers !== null && isLive ? ` · ${t("live.viewers", { n: compact(viewers) })}` : ""}
          {open && isLive && !connected ? ` · ${t("live.reconnecting")}` : ""}
        </Text>
      </View>

      {shownPinned.length > 0 && (
        <View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.pinnedRow}>
            {shownPinned.map((m) => (
              <View key={m.id} style={st.pin} accessibilityLabel={`${t("live.pinned")}: ${m.author}, ${price(m.paid_minor)}, ${m.body}`}>
                <Text style={st.pinAmount}>
                  {price(m.paid_minor)}
                  {m.tier ? ` · ${m.tier}` : ""}
                </Text>
                <Text style={st.pinAuthor} numberOfLines={1}>
                  {m.author}
                </Text>
                {m.body ? (
                  <Text style={st.pinBody} numberOfLines={2}>
                    {m.body}
                  </Text>
                ) : null}
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      {open ? (
        <FlatList
          style={{ flex: 1 }}
          data={[...messages].reverse()}
          inverted
          keyExtractor={(m) => String(m.id)}
          renderItem={({ item }) => <Bubble m={item} />}
          contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8 }}
          ListEmptyComponent={
            history.isLoading ? undefined : <Text style={[s.note, { textAlign: "center" }]}>{t("live.chatEmpty")}</Text>
          }
          keyboardShouldPersistTaps="handled"
        />
      ) : (
        <View style={{ flex: 1 }} />
      )}

      <View style={st.composer}>
        {slow ? <Text style={st.hint}>{t("live.slowMode", { n: slow })}</Text> : null}
        {notice && <Text style={[s.error, { marginTop: 4 }]}>{notice}</Text>}
        {open && isLive && (
          <View style={[s.row, { gap: 8, marginTop: 6 }]}>
            {user ? (
              <>
                <TextInput
                  style={[s.field, { flex: 1, marginTop: 0, paddingVertical: 10 }]}
                  placeholder={t("live.placeholder")}
                  value={body}
                  onChangeText={setBody}
                  maxLength={200}
                  returnKeyType="send"
                  onSubmitEditing={() => !blocked && send()}
                  accessibilityLabel={t("live.placeholder")}
                />
                <Pressable
                  onPress={send}
                  disabled={blocked}
                  style={[st.send, blocked && s.disabled]}
                  accessibilityRole="button"
                  accessibilityLabel={t("live.send")}
                >
                  {sending ? <ActivityIndicator color={colour.white} /> : <Text style={s.buttonText}>{t("live.send")}</Text>}
                </Pressable>
              </>
            ) : (
              <Pressable onPress={() => router.push("/profile")} style={[s.outline, { flex: 1, marginTop: 0 }]} accessibilityRole="button">
                <Text style={s.outlineText}>{t("live.signIn")}</Text>
              </Pressable>
            )}
          </View>
        )}
        {!data.is_owner && (isLive || current === "scheduled") && (
          <Pressable
            onPress={() => openSuperChat(data.id)}
            style={[s.quiet, { marginTop: 4, paddingVertical: 8 }]}
            accessibilityRole="link"
            accessibilityLabel={t("live.superChat")}
            accessibilityHint={t("live.superHint")}
          >
            <Text style={s.quietText}>
              <Text style={s.link}>{t("live.superChat")} ↗</Text>
            </Text>
            <Text style={[s.quietText, { fontSize: 11, marginTop: 2 }]}>{t("live.superHint")}</Text>
          </Pressable>
        )}
      </View>
    </KeyboardAvoidingView>
  )
}

const st = StyleSheet.create({
  stageBox: { flex: 1, alignItems: "center", justifyContent: "center", padding: 20 },
  stageTitle: { fontSize: 17, fontWeight: "700", color: colour.white, textAlign: "center" },
  stageText: { marginTop: 6, fontSize: 14, color: colour.slate300, textAlign: "center" },
  head: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: colour.slate200 },
  badge: { borderRadius: 999, backgroundColor: colour.red600, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { fontSize: 11, fontWeight: "800", color: colour.white },
  pinnedRow: { gap: 8, paddingHorizontal: 16, paddingVertical: 8 },
  pin: { width: 200, borderRadius: 12, backgroundColor: colour.brand, paddingHorizontal: 12, paddingVertical: 8 },
  pinAmount: { fontSize: 12, fontWeight: "800", color: colour.white },
  pinAuthor: { marginTop: 2, fontSize: 12, fontWeight: "600", color: colour.brandLight },
  pinBody: { marginTop: 2, fontSize: 13, color: colour.white },
  bubble: { paddingVertical: 5 },
  mine: { borderLeftWidth: 3, borderLeftColor: colour.brand, paddingLeft: 8 },
  paid: { marginVertical: 4, borderRadius: 10, backgroundColor: colour.brandLight, paddingHorizontal: 10, paddingVertical: 8 },
  author: { fontSize: 13, fontWeight: "700", color: colour.slate500 },
  amount: { fontWeight: "800", color: colour.brand },
  body: { marginTop: 1, fontSize: 15, color: colour.navy, lineHeight: 20 },
  composer: { borderTopWidth: 1, borderTopColor: colour.slate200, paddingHorizontal: 16, paddingTop: 6, paddingBottom: 16 },
  hint: { fontSize: 12, color: colour.amber600 },
  send: { borderRadius: 12, backgroundColor: colour.brand, paddingHorizontal: 16, paddingVertical: 12 },
})
