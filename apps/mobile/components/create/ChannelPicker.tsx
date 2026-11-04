import { useState } from "react"
import { router } from "expo-router"
import { ActivityIndicator, Pressable, Text, View } from "react-native"

import { detail } from "../../lib/api"
import { useT, type T } from "../../lib/i18n"
import type { Key } from "../../lib/strings"
import { colour, s } from "../../lib/theme"
import type { TeamChannel } from "../../lib/types"

export function roleLabel(t: T, role: string): string {
  const key = `team.role.${role}` as Key
  const text = t(key)
  return text === undefined || text === key ? role : text
}

function LeaveConfirm({
  channel,
  onLeave,
  onCancel,
}: {
  channel: TeamChannel
  onLeave: (c: TeamChannel) => Promise<void>
  onCancel: () => void
}) {
  const { t } = useT()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function leave() {
    setBusy(true)
    setError(null)
    try {
      await onLeave(channel)
    } catch (err) {
      setError(detail(err, t("team.leaveFailed")))
      setBusy(false)
    }
  }

  return (
    <View style={{ marginTop: 8, padding: 12, borderRadius: 10, backgroundColor: colour.slate50 }} accessibilityLiveRegion="polite">
      <Text style={[s.text, { fontWeight: "600" }]}>{t("team.leaveTitle", { channel: channel.name })}</Text>
      <Text style={[s.cardHint, { marginTop: 4 }]}>{t("team.leaveBody")}</Text>
      {error && <Text style={s.error}>{error}</Text>}
      <View style={{ flexDirection: "row", gap: 12, marginTop: 10 }}>
        <Pressable onPress={onCancel} disabled={busy} style={[s.outline, { flex: 1, marginTop: 0 }]} accessibilityRole="button">
          <Text style={s.outlineText}>{t("team.leaveCancel")}</Text>
        </Pressable>
        <Pressable
          onPress={leave}
          disabled={busy}
          style={[s.button, { flex: 1, marginTop: 0, backgroundColor: colour.red600 }, busy && s.disabled]}
          accessibilityRole="button"
        >
          {busy ? <ActivityIndicator color={colour.white} /> : <Text style={s.buttonText}>{t("team.leaveConfirm")}</Text>}
        </Pressable>
      </View>
    </View>
  )
}

export function ChannelPicker({
  options,
  current,
  onChoose,
  onLeave,
}: {
  options: TeamChannel[]
  current: TeamChannel
  onChoose: (c: TeamChannel) => void
  onLeave: (c: TeamChannel) => Promise<void>
}) {
  const { t } = useT()
  const [open, setOpen] = useState(false)
  const [leaving, setLeaving] = useState<number | null>(null)

  return (
    <View style={[s.card, { marginTop: 0, marginBottom: 12 }]}>
      <Pressable
        onPress={() => {
          setOpen((o) => !o)
          setLeaving(null)
        }}
        style={[s.row, { gap: 12 }]}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityHint={t("team.choose")}
      >
        <Text style={[s.text, { flex: 1, fontWeight: "600" }]} numberOfLines={2}>
          {t("team.postingTo", { channel: current.name, role: roleLabel(t, current.role) })}
        </Text>
        <Text style={s.link}>{open ? t("team.close") : t("team.change")}</Text>
      </Pressable>
      {open && (
        <View style={{ marginTop: 8 }}>
          <View accessibilityRole="radiogroup" accessibilityLabel={t("team.choose")}>
            {options.map((c) => {
              const selected = c.tenant_id === current.tenant_id
              const team = c.role !== "owner"
              return (
                <View key={c.tenant_id}>
                  <View
                    style={{
                      marginTop: 6,
                      flexDirection: "row",
                      alignItems: "center",
                      borderRadius: 10,
                      borderWidth: 1,
                      borderColor: selected ? colour.brand : colour.slate200,
                      backgroundColor: selected ? colour.brandLight : colour.white,
                    }}
                  >
                    <Pressable
                      onPress={() => {
                        setOpen(false)
                        setLeaving(null)
                        if (!selected) onChoose(c)
                      }}
                      style={{ flex: 1, padding: 12 }}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected }}
                    >
                      <Text style={{ fontWeight: "700", color: colour.navy }} numberOfLines={1}>
                        {c.name}
                      </Text>
                      <Text style={s.cardHint}>
                        {c.handle ? `@${c.handle} · ` : ""}
                        {roleLabel(t, c.role)}
                      </Text>
                    </Pressable>
                    {team && (
                      <Pressable
                        onPress={() => setLeaving((id) => (id === c.tenant_id ? null : c.tenant_id))}
                        style={{ paddingHorizontal: 12, paddingVertical: 12 }}
                        accessibilityRole="button"
                        accessibilityLabel={t("team.leaveLabel", { channel: c.name })}
                        accessibilityState={{ expanded: leaving === c.tenant_id }}
                      >
                        <Text style={[s.link, { color: colour.red600 }]}>{t("team.leave")}</Text>
                      </Pressable>
                    )}
                  </View>
                  {leaving === c.tenant_id && <LeaveConfirm channel={c} onLeave={onLeave} onCancel={() => setLeaving(null)} />}
                </View>
              )
            })}
          </View>
          <Pressable
            onPress={() => {
              setOpen(false)
              router.push("/team/accept")
            }}
            style={{ marginTop: 12, paddingVertical: 6 }}
            accessibilityRole="button"
          >
            <Text style={s.link}>{t("invite.pasteTitle")}</Text>
          </Pressable>
        </View>
      )}
    </View>
  )
}
