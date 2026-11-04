import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { router, useLocalSearchParams } from "expo-router"
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native"

import { roleLabel } from "../../components/create/ChannelPicker"
import { acting } from "../../lib/acting"
import { detail } from "../../lib/api"
import { useAuth } from "../../lib/auth"
import { day } from "../../lib/format"
import { useT } from "../../lib/i18n"
import { acceptInvite, expired, inviteProblem, inviteToken, previewInvite } from "../../lib/team"
import { colour, s } from "../../lib/theme"
import type { TeamChannel, TeamInvite } from "../../lib/types"

function PasteLink({ onToken, first }: { onToken: (token: string) => void; first: boolean }) {
  const { t } = useT()
  const [text, setText] = useState("")
  const [error, setError] = useState(false)

  function open() {
    const token = inviteToken(text)
    setError(!token)
    if (token) {
      setText("")
      onToken(token)
    }
  }

  return (
    <View style={first ? undefined : { marginTop: 32 }}>
      <Text style={first ? s.title : s.heading}>{t("invite.pasteTitle")}</Text>
      <Text style={s.subtitle}>{t("invite.pasteHint")}</Text>
      <TextInput
        style={s.field}
        value={text}
        onChangeText={(v) => {
          setText(v)
          setError(false)
        }}
        placeholder={t("invite.pastePlaceholder")}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        returnKeyType="go"
        onSubmitEditing={open}
        accessibilityLabel={t("invite.pasteTitle")}
      />
      {error && (
        <Text style={s.error} accessibilityLiveRegion="polite">
          {t("invite.badLink")}
        </Text>
      )}
      <Pressable onPress={open} disabled={!text.trim()} style={[s.outline, !text.trim() && s.disabled]} accessibilityRole="button">
        <Text style={s.outlineText}>{t("invite.open")}</Text>
      </Pressable>
    </View>
  )
}

function Invitation({ token, email, userId }: { token: string; email: string; userId: number }) {
  const { t } = useT()
  const qc = useQueryClient()
  const preview = useQuery<TeamInvite>({
    queryKey: ["team-invite", token, userId],
    queryFn: () => previewInvite(token),
    retry: false,
  })
  const accept = useMutation({
    mutationFn: () => acceptInvite(token),
    onSuccess: (res) => {
      const invite = preview.data
      qc.setQueryData<TeamChannel[]>(["my-channels", userId], (rows) =>
        rows && invite && !rows.some((r) => r.tenant_id === res.tenant_id)
          ? [...rows, { tenant_id: res.tenant_id, role: res.role, name: invite.channel?.name ?? "", handle: invite.channel?.handle ?? null }]
          : rows,
      )
      acting.choose(res.tenant_id)
      qc.invalidateQueries({ queryKey: ["my-channels"] })
      qc.removeQueries({ queryKey: ["team-invite", token] })
      router.dismissTo("/create")
    },
  })

  if (preview.isLoading) return <ActivityIndicator style={{ marginTop: 48 }} color={colour.brand} />
  if (preview.isError || !preview.data) {
    const problem = inviteProblem(preview.error)
    return (
      <View>
        <Text style={s.title}>{t("invite.title")}</Text>
        <Text style={s.error}>{problem ? t(problem) : detail(preview.error, t("invite.failed"))}</Text>
        {!problem && (
          <Pressable onPress={() => preview.refetch()} style={s.outline} accessibilityRole="button">
            <Text style={s.outlineText}>{t("common.tryAgain")}</Text>
          </Pressable>
        )}
      </View>
    )
  }

  const invite = preview.data
  const gone = expired(invite)
  const channel = invite.channel?.name ?? t("invite.aChannel")
  const role = roleLabel(t, invite.role)
  const blocked = gone || !invite.for_you || accept.isPending
  const problem = accept.isError ? inviteProblem(accept.error) : null

  return (
    <View>
      <Text style={s.title}>{t("invite.title")}</Text>
      <View style={s.card}>
        <Text style={s.text}>
          {invite.inviter ? t("invite.from", { inviter: invite.inviter, channel, role }) : t("invite.fromUnknown", { channel, role })}
        </Text>
        {invite.channel?.handle ? <Text style={[s.cardHint, { marginTop: 6 }]}>@{invite.channel.handle}</Text> : null}
        {invite.expires_at && !gone ? <Text style={s.cardHint}>{t("invite.expires", { day: day(invite.expires_at) })}</Text> : null}
      </View>
      <Text style={s.note}>{t("invite.what", { role })}</Text>
      {gone && (
        <Text style={s.error} accessibilityLiveRegion="polite">
          {t("invite.expired")}
        </Text>
      )}
      {!gone && !invite.for_you && (
        <Text style={[s.text, { marginTop: 12, color: colour.amber600 }]} accessibilityLiveRegion="polite">
          {t("invite.notForYou", { email })}
        </Text>
      )}
      {accept.isError && (
        <Text style={s.error} accessibilityLiveRegion="polite">
          {problem ? t(problem) : detail(accept.error, t("invite.acceptFailed"))}
        </Text>
      )}
      <Pressable onPress={() => accept.mutate()} disabled={blocked} style={[s.button, blocked && s.disabled]} accessibilityRole="button">
        {accept.isPending ? <ActivityIndicator color={colour.white} /> : <Text style={s.buttonText}>{t("invite.accept", { channel })}</Text>}
      </Pressable>
      <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} style={s.quiet} accessibilityRole="button">
        <Text style={s.quietText}>{t("invite.notNow")}</Text>
      </Pressable>
    </View>
  )
}

export default function AcceptInvite() {
  const { user, ready } = useAuth()
  const { t } = useT()
  const params = useLocalSearchParams<{ token?: string }>()
  const [pasted, setPasted] = useState<string | null>(null)
  const token = pasted ?? inviteToken(typeof params.token === "string" ? params.token : null)

  let body
  if (!ready) {
    body = <ActivityIndicator style={{ marginTop: 48 }} color={colour.brand} />
  } else if (!user) {
    body = (
      <View>
        <Text style={s.title}>{t("invite.title")}</Text>
        <Text style={s.subtitle}>{t("invite.signIn")}</Text>
        <Pressable onPress={() => router.push("/profile")} style={s.button} accessibilityRole="button">
          <Text style={s.buttonText}>{t("common.signIn")}</Text>
        </Pressable>
      </View>
    )
  } else {
    body = (
      <>
        {token && <Invitation key={token} token={token} email={user.email} userId={user.id} />}
        <PasteLink first={!token} onToken={setPasted} />
      </>
    )
  }

  return (
    <KeyboardAvoidingView style={s.sheet} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
        {body}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
