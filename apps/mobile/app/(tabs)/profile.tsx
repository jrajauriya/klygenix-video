import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { router } from "expo-router"
import { ActivityIndicator, Image, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { formatMoney } from "@klygenixvideo/client/src/native"

import { FeedbackForm } from "../../components/FeedbackForm"
import { LanguageSwitch } from "../../components/LanguageSwitch"
import { NotificationSettings } from "../../components/NotificationSettings"
import { SignIn } from "../../components/SignIn"
import { SignUp } from "../../components/SignUp"
import { WEB_URL, api, openWeb } from "../../lib/api"
import { useAuth } from "../../lib/auth"
import { clock, day, humanise, price } from "../../lib/format"
import { useT, type T } from "../../lib/i18n"
import { colour, s } from "../../lib/theme"
import type { Me, Membership, Plan, Purchase, StudioVideo } from "../../lib/types"

function PlanCard({ title, plan }: { title: string; plan: Plan | null }) {
  const { t } = useT()
  return (
    <View style={[s.card, { flex: 1 }]}>
      <Text style={s.cardLabel}>{title}</Text>
      <Text style={s.cardValue}>{plan?.name ?? t("profile.free")}</Text>
      <Text style={s.cardHint}>{plan && !plan.free ? t("profile.perMonth", { price: formatMoney(plan.price_minor, plan.currency) }) : t("profile.noCharge")}</Text>
    </View>
  )
}

function MyVideos() {
  const { t } = useT()
  const { data: videos = [], isLoading } = useQuery<StudioVideo[]>({
    queryKey: ["studio-videos"],
    queryFn: async () => (await api.get("/api/video/studio/videos", { params: { limit: 30 } })).data,
  })
  if (isLoading) return <Text style={s.note}>{t("profile.loadingVideos")}</Text>
  if (videos.length === 0) return <Text style={s.note}>{t("profile.noVideos")}</Text>
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
              {humanise(v.status)} · {clock(v.duration_ms)} · {t("profile.views", { n: v.views })}
            </Text>
          </View>
        </Pressable>
      ))}
    </View>
  )
}

function membershipLine(m: Membership, t: T): string {
  if (m.status !== "active") return humanise(m.status)
  if (!m.current_period_end) return t("profile.active")
  return t(m.cancel_at_period_end ? "profile.ends" : "profile.renews", { day: day(m.current_period_end) })
}

function Memberships() {
  const { user } = useAuth()
  const { t } = useT()
  const { data: rows = [], isLoading } = useQuery<Membership[]>({
    queryKey: ["memberships", user?.id],
    queryFn: async () => (await api.get("/api/video/me/memberships")).data,
  })
  if (isLoading) return <Text style={s.note}>{t("profile.loadingMemberships")}</Text>
  if (rows.length === 0) return <Text style={s.note}>{t("profile.noMemberships")}</Text>
  return (
    <View>
      {rows.map((m, i) => (
        <Pressable
          key={`${m.channel}-${m.tier?.id ?? i}`}
          onPress={() => m.channel && router.push(`/channel/${m.channel}`)}
          style={s.card}
          accessibilityRole="button"
          accessibilityLabel={`${m.channel_name ?? m.channel}, ${m.tier?.name ?? t("profile.membership")}, ${membershipLine(m, t)}`}
        >
          <Text style={{ fontWeight: "600", color: colour.navy }}>{m.channel_name ?? `@${m.channel}`}</Text>
          <Text style={[s.text, { marginTop: 2 }]}>
            {m.tier?.name ?? t("profile.membership")}
            {m.tier ? ` · ${t("profile.perMonth", { price: price(m.tier.price_minor, m.tier.currency) })}` : ""}
          </Text>
          <Text style={{ marginTop: 2, fontSize: 12, color: m.status === "active" ? colour.green700 : colour.slate500 }}>{membershipLine(m, t)}</Text>
        </Pressable>
      ))}
      <Pressable onPress={() => openWeb("/account?tab=memberships")} style={s.quiet} accessibilityRole="link" accessibilityLabel={t("profile.changeMembership")}>
        <Text style={s.quietText}>
          {t("profile.changeMembership")} <Text style={s.link}>{t("profile.openSite")}</Text>
        </Text>
      </Pressable>
    </View>
  )
}

function Purchases() {
  const { user } = useAuth()
  const { t } = useT()
  const { data: rows = [], isLoading } = useQuery<Purchase[]>({
    queryKey: ["purchases", user?.id],
    queryFn: async () => (await api.get("/api/video/me/purchases")).data,
  })
  if (isLoading) return <Text style={s.note}>{t("profile.loadingPurchases")}</Text>
  if (rows.length === 0) return <Text style={s.note}>{t("profile.noPurchases")}</Text>
  return (
    <View>
      {rows.map((p, i) => (
        <Pressable
          key={`${p.kind}-${p.id ?? i}`}
          onPress={() => (p.kind === "video" && p.id ? router.push(`/watch/${p.id}`) : p.id ? openWeb(`/playlist/${p.id}`) : undefined)}
          style={s.card}
          accessibilityRole={p.kind === "video" ? "button" : "link"}
          accessibilityLabel={`${p.kind === "series" ? t("profile.series") : t("profile.video")}: ${p.title || t("common.untitled")}`}
        >
          <Text style={{ fontWeight: "600", color: colour.navy }} numberOfLines={2}>
            {p.title || t("common.untitled")}
          </Text>
          <Text style={{ marginTop: 2, fontSize: 12, color: colour.slate500 }}>
            {p.kind === "series" ? t("profile.series") : t("profile.video")}
            {p.bought_at ? ` · ${t("profile.bought", { day: day(p.bought_at) })}` : ""}
          </Text>
        </Pressable>
      ))}
    </View>
  )
}

function Account() {
  const { user, signOut } = useAuth()
  const { t } = useT()
  const { data: me, isLoading } = useQuery<Me>({
    queryKey: ["me", user?.id],
    queryFn: async () => (await api.get("/api/video/me")).data,
  })

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
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
            <Text style={s.heading}>{t("profile.plans")}</Text>
            <View style={{ flexDirection: "row", gap: 12 }}>
              <PlanCard title={t("profile.watching")} plan={me.plans.viewer} />
              <PlanCard title={t("profile.creating")} plan={me.plans.creator} />
            </View>
            <Pressable onPress={() => Linking.openURL(`${WEB_URL}/plans`)} style={s.quiet} accessibilityRole="link" accessibilityLabel={t("profile.managePlan")}>
              <Text style={s.quietText}>
                {t("profile.managePlan")} <Text style={s.link}>{t("profile.openSite")}</Text>
              </Text>
            </Pressable>

            <Text style={s.heading}>{t("profile.memberships")}</Text>
            <Memberships />

            <Text style={s.heading}>{t("profile.purchases")}</Text>
            <Purchases />

            <Text style={s.heading}>{t("profile.usage")}</Text>
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
            <Text style={s.heading}>{t("profile.myVideos")}</Text>
            <MyVideos />
          </>
        )}

        <NotificationSettings />

        <Text style={s.heading}>{t("profile.language")}</Text>
        <LanguageSwitch />

        <FeedbackForm />

        <Pressable onPress={signOut} style={[s.outline, { marginTop: 32 }]} accessibilityRole="button" accessibilityLabel={t("profile.signOut")}>
          <Text style={s.outlineText}>{t("profile.signOut")}</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
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
            <LanguageSwitch />
            <FeedbackForm />
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  )
}
