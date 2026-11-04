import { useEffect, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { router } from "expo-router"
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import { AfterUpload } from "../../components/create/AfterUpload"
import { ChannelPicker, roleLabel } from "../../components/create/ChannelPicker"
import { Compose } from "../../components/create/Compose"
import { OpenChannel } from "../../components/create/OpenChannel"
import { Recorder } from "../../components/create/Recorder"
import { acting, can, studio, useActing } from "../../lib/acting"
import { api, detail } from "../../lib/api"
import { useAuth } from "../../lib/auth"
import { humanise } from "../../lib/format"
import { useT } from "../../lib/i18n"
import type { Key } from "../../lib/strings"
import { leaveChannel } from "../../lib/team"
import { colour, s } from "../../lib/theme"
import type { Channel, StudioVideo, TeamChannel, TeamMe } from "../../lib/types"

const METERS: Record<string, Key> = {
  ai_minutes: "team.meter.ai_minutes",
  renders: "team.meter.renders",
  ai_images: "team.meter.ai_images",
}

function SignedOut() {
  const { t } = useT()
  return (
    <View style={s.centred}>
      <Text style={s.title}>{t("create.signedOutTitle")}</Text>
      <Text style={[s.subtitle, { textAlign: "center" }]}>{t("create.signedOutBody")}</Text>
      <Pressable onPress={() => router.push("/profile")} style={s.button}>
        <Text style={s.buttonText}>{t("common.signIn")}</Text>
      </Pressable>
    </View>
  )
}

function OwnerPlan({ team }: { team: TeamMe }) {
  const { t } = useT()
  const usage = team.usage ?? []
  if (!team.plan && usage.length === 0) return null
  return (
    <View style={[s.card, { marginTop: 0, marginBottom: 12 }]}>
      <Text style={s.cardLabel}>{t("team.ownerPlan")}</Text>
      <Text style={[s.text, { marginTop: 4, fontWeight: "700" }]}>{team.plan?.name ?? t("profile.free")}</Text>
      {usage.map((u) => (
        <View key={u.metric} style={[s.row, { marginTop: 6 }]}>
          <Text style={[s.text, { fontSize: 14 }]}>{METERS[u.metric] ? t(METERS[u.metric]) : humanise(u.label)}</Text>
          <Text style={{ fontWeight: "700", color: u.limit !== null && u.used >= u.limit ? colour.red600 : colour.navy }}>
            {u.limit !== null ? t("team.meterOf", { used: u.used, limit: u.limit }) : String(u.used)}
          </Text>
        </View>
      ))}
      <Text style={s.cardHint}>{t("team.ownerPlanHint")}</Text>
    </View>
  )
}

export default function Create() {
  const { user } = useAuth()
  const { t } = useT()
  const qc = useQueryClient()
  const [recording, setRecording] = useState(false)
  const [recorded, setRecorded] = useState<string | null>(null)
  const [uploaded, setUploaded] = useState<StudioVideo | null>(null)
  const [left, setLeft] = useState<string | null>(null)
  const act = useActing()
  const tenantId = act.ready ? act.tenantId : null
  const own = tenantId === null

  const channels = useQuery<TeamChannel[]>({
    queryKey: ["my-channels", user?.id],
    queryFn: async () => (await api.get<TeamChannel[]>("/api/video/me/channels")).data,
    enabled: Boolean(user),
  })

  const channel = useQuery<Channel | null>({
    queryKey: ["studio-channel", user?.id, tenantId],
    queryFn: async () => {
      const { data } = await studio.get("/api/video/studio/channel")
      if (!data) return null
      return (data.channel ?? (data.handle ? data : null)) as Channel | null
    },
    enabled: Boolean(user) && act.ready,
  })

  const team = useQuery<TeamMe>({
    queryKey: ["team-me", user?.id, tenantId, act.stamp],
    queryFn: async () => (await studio.get<TeamMe>("/api/video/studio/team/me")).data,
    enabled: Boolean(user) && act.ready && !own,
  })

  useEffect(() => {
    setUploaded(null)
  }, [tenantId])

  async function leave(c: TeamChannel) {
    await leaveChannel(c.tenant_id)
    if (acting.tenant() === c.tenant_id) acting.choose(null)
    setLeft(c.name)
    qc.setQueryData<TeamChannel[]>(["my-channels", user?.id], (rows) => rows?.filter((r) => r.tenant_id !== c.tenant_id))
    qc.invalidateQueries({ queryKey: ["my-channels", user?.id] })
  }

  useEffect(() => {
    if (tenantId === null || !channels.data || channels.isFetching) return
    if (!channels.data.some((c) => c.tenant_id === tenantId && c.role !== "owner")) acting.drop()
  }, [channels.data, channels.isFetching, tenantId])

  if (!user) return <SignedOut />

  if (recording) {
    return (
      <Recorder
        onCancel={() => setRecording(false)}
        onRecorded={(uri) => {
          setRecorded(uri)
          setRecording(false)
        }}
      />
    )
  }

  const list = channels.data ?? []
  const mine = list.find((c) => c.role === "owner")
  const options: TeamChannel[] = mine ? list : [{ tenant_id: 0, role: "owner", name: t("team.yourChannel"), handle: null }, ...list]
  const current = own ? options.find((c) => c.role === "owner") : options.find((c) => c.tenant_id === tenantId)
  const picker = options.length > 1 && current && !uploaded
  const role = roleLabel(t, team.data?.role ?? current?.role ?? "owner")
  const checking = !own && !team.data
  const uploadLock = checking
    ? team.isError
      ? t("team.checkFailed")
      : t("team.checking")
    : can(team.data, own, "video.uploads")
      ? null
      : t("team.noUpload", { role })
  const canClip = can(team.data, own, "video.clips")

  let body
  if (!act.ready || channel.isLoading) {
    body = <ActivityIndicator style={{ marginTop: 48 }} color={colour.brand} />
  } else if (channel.isError) {
    body = <Text style={s.error}>{detail(channel.error, t("create.channelFailed"))}</Text>
  } else if (!channel.data) {
    body = (
      <OpenChannel
        onOpened={(c) => {
          qc.setQueryData(["studio-channel", user.id, null], c)
          qc.invalidateQueries({ queryKey: ["my-channels", user.id] })
        }}
      />
    )
  } else if (channel.data.is_suspended) {
    body = (
      <View>
        <Text style={s.title}>{t("create.suspended")}</Text>
        <Text style={s.subtitle}>{t("create.suspendedBody", { handle: channel.data.handle })}</Text>
      </View>
    )
  } else if (uploaded) {
    body = (
      <AfterUpload
        video={uploaded}
        clipLock={canClip ? null : t("team.noClips", { role })}
        onDone={() => {
          setUploaded(null)
          setRecorded(null)
        }}
      />
    )
  } else {
    body = <Compose recorded={recorded} locked={uploadLock} onRecord={() => setRecording(true)} onUploaded={setUploaded} />
  }

  return (
    <SafeAreaView style={s.sheet} edges={["top"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
          {act.removed && (
            <View style={[s.card, { marginTop: 0, marginBottom: 12, borderColor: colour.brand }]} accessibilityLiveRegion="polite">
              <Text style={s.text}>{t("team.removed")}</Text>
              <Pressable onPress={() => acting.dismiss()} style={{ alignSelf: "flex-end", paddingTop: 8 }} accessibilityRole="button">
                <Text style={s.link}>{t("team.dismiss")}</Text>
              </Pressable>
            </View>
          )}
          {left && (
            <View style={[s.card, { marginTop: 0, marginBottom: 12 }]} accessibilityLiveRegion="polite">
              <Text style={s.text}>{t("team.left", { channel: left })}</Text>
              <Pressable onPress={() => setLeft(null)} style={{ alignSelf: "flex-end", paddingTop: 8 }} accessibilityRole="button">
                <Text style={s.link}>{t("team.dismiss")}</Text>
              </Pressable>
            </View>
          )}
          {picker && (
            <ChannelPicker
              options={options}
              current={current}
              onChoose={(c) => {
                setLeft(null)
                acting.choose(c.role === "owner" ? null : c.tenant_id)
              }}
              onLeave={leave}
            />
          )}
          {!own && team.data && !uploaded && <OwnerPlan team={team.data} />}
          {channel.data && !uploaded && !picker && (
            <View style={[s.chip, { marginBottom: 12 }]}>
              <Text style={s.chipText}>@{channel.data.handle}</Text>
            </View>
          )}
          {body}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}
