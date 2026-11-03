import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { router } from "expo-router"
import { ActivityIndicator, Image, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { formatMoney } from "@klygenixvideo/client/src/native"

import { SignIn } from "../../components/SignIn"
import { SignUp } from "../../components/SignUp"
import { WEB_URL, api } from "../../lib/api"
import { useAuth } from "../../lib/auth"
import { clock, humanise } from "../../lib/format"
import { colour, s } from "../../lib/theme"
import type { Me, Plan, StudioVideo } from "../../lib/types"

function PlanCard({ title, plan }: { title: string; plan: Plan | null }) {
  return (
    <View style={[s.card, { flex: 1 }]}>
      <Text style={s.cardLabel}>{title}</Text>
      <Text style={s.cardValue}>{plan?.name ?? "Free"}</Text>
      <Text style={s.cardHint}>{plan && !plan.free ? `${formatMoney(plan.price_minor, plan.currency)} a month` : "No charge"}</Text>
    </View>
  )
}

function MyVideos() {
  const { data: videos = [], isLoading } = useQuery<StudioVideo[]>({
    queryKey: ["studio-videos"],
    queryFn: async () => (await api.get("/api/video/studio/videos", { params: { limit: 30 } })).data,
  })
  if (isLoading) return <Text style={s.note}>Loading your videos…</Text>
  if (videos.length === 0) return <Text style={s.note}>You have not uploaded anything yet.</Text>
  return (
    <View>
      {videos.map((v) => (
        <Pressable
          key={v.id}
          onPress={() => v.status === "published" && router.push(`/watch/${v.public_id}`)}
          style={[s.card, { flexDirection: "row", gap: 12, alignItems: "center" }]}
        >
          {v.thumbnail ? (
            <Image source={{ uri: v.thumbnail }} style={{ width: 64, height: v.kind === "reel" ? 96 : 36, borderRadius: 6, backgroundColor: colour.slate200 }} />
          ) : (
            <View style={{ width: 64, height: 36, borderRadius: 6, backgroundColor: colour.slate200 }} />
          )}
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: "600", color: colour.navy }} numberOfLines={2}>
              {v.title}
            </Text>
            <Text style={{ marginTop: 2, fontSize: 12, color: v.status === "published" ? colour.green700 : colour.slate500 }}>
              {humanise(v.status)} · {clock(v.duration_ms)} · {v.views} views
            </Text>
          </View>
        </Pressable>
      ))}
    </View>
  )
}

function Account() {
  const { user, signOut } = useAuth()
  const { data: me, isLoading } = useQuery<Me>({
    queryKey: ["me", user?.id],
    queryFn: async () => (await api.get("/api/video/me")).data,
  })

  return (
    <ScrollView contentContainerStyle={s.body}>
      <Text style={s.title}>{me?.profile.display_name ?? user?.name}</Text>
      <Text style={s.subtitle}>{user?.email}</Text>
      {me?.channel && (
        <View style={[s.chip, { marginTop: 10 }]}>
          <Text style={s.chipText}>@{me.channel.handle}</Text>
        </View>
      )}

      {isLoading ? (
        <ActivityIndicator style={{ marginTop: 24 }} color={colour.brand} />
      ) : me ? (
        <>
          <Text style={s.heading}>Your plans</Text>
          <View style={{ flexDirection: "row", gap: 12 }}>
            <PlanCard title="Watching" plan={me.plans.viewer} />
            <PlanCard title="Creating" plan={me.plans.creator} />
          </View>
          <Pressable onPress={() => Linking.openURL(`${WEB_URL}/plans`)} style={s.quiet}>
            <Text style={s.quietText}>
              Manage your plan on the web — <Text style={s.link}>open Klygenix Play</Text>
            </Text>
          </Pressable>

          <Text style={s.heading}>Usage</Text>
          {me.usage.map((u) => (
            <View key={u.metric} style={[s.row, { marginTop: 10 }]}>
              <Text style={s.text}>{humanise(u.label)}</Text>
              <Text style={{ fontWeight: "700", color: colour.navy }}>
                {u.used}
                {u.limit !== null ? ` / ${u.limit}` : ""}
              </Text>
            </View>
          ))}
        </>
      ) : null}

      {me?.channel && (
        <>
          <Text style={s.heading}>My videos</Text>
          <MyVideos />
        </>
      )}

      <Pressable onPress={signOut} style={[s.outline, { marginTop: 32 }]}>
        <Text style={s.outlineText}>Sign out</Text>
      </Pressable>
    </ScrollView>
  )
}

export default function Profile() {
  const { user, ready } = useAuth()
  const [mode, setMode] = useState<"in" | "up">("in")

  if (!ready) {
    return (
      <View style={s.centred}>
        <ActivityIndicator color={colour.brand} />
      </View>
    )
  }

  return (
    <SafeAreaView style={s.sheet} edges={["top"]}>
      {user ? (
        <Account />
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={[s.body, { paddingTop: 48 }]} keyboardShouldPersistTaps="handled">
            {mode === "in" ? <SignIn onSignUp={() => setMode("up")} /> : <SignUp onSignIn={() => setMode("in")} />}
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  )
}
