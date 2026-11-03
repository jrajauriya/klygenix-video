import { router } from "expo-router"
import { Pressable, StyleSheet, Text, View } from "react-native"

import { openWeb } from "../lib/api"
import { price } from "../lib/format"
import { useT } from "../lib/i18n"
import { colour, s } from "../lib/theme"
import type { Lock } from "../lib/types"

export function LockCard({ lock, publicId, ended, dark }: { lock: Lock; publicId: string; ended?: boolean; dark?: boolean }) {
  const { t } = useT()
  const members = lock.access === "members"
  const tiers = lock.tiers ?? []
  const text = dark ? st.darkText : s.text
  const hint = dark ? st.darkHint : st.hint

  return (
    <View style={dark ? st.dark : [s.card, st.light]}>
      <Text style={[st.title, { color: dark ? colour.white : colour.navy }]}>{members ? t("lock.members") : t("lock.paid")}</Text>
      {ended ? (
        <Text style={[hint, { marginTop: 4 }]}>{t("lock.previewEnded")}</Text>
      ) : lock.preview_seconds > 0 ? (
        <Text style={[hint, { marginTop: 4 }]}>{t("lock.preview", { n: lock.preview_seconds })}</Text>
      ) : null}

      {members ? (
        tiers.length > 0 ? (
          <View style={{ marginTop: 8 }}>
            <Text style={text}>{t("lock.included")}</Text>
            {tiers.map((tier) => (
              <Text key={tier.id} style={[text, { marginTop: 4, fontWeight: "600" }]}>
                {tier.name} · {t("lock.perMonth", { price: price(tier.price_minor) })}
              </Text>
            ))}
          </View>
        ) : (
          <Text style={[text, { marginTop: 8 }]}>{t("lock.forMembers")}</Text>
        )
      ) : (
        <View style={{ marginTop: 8 }}>
          <Text style={[text, { fontWeight: "600" }]}>{t("lock.toWatch", { price: price(lock.price_minor, lock.currency ?? "INR") })}</Text>
          {(lock.series ?? []).map((sr) => (
            <Text key={sr.id} style={[hint, { marginTop: 4 }]}>
              {t("lock.series", { title: sr.title })}{sr.price_minor ? ` · ${price(sr.price_minor)}` : ""}
            </Text>
          ))}
        </View>
      )}

      <Text style={[hint, { marginTop: 10 }]}>{t("lock.web")}</Text>
      <Pressable
        onPress={() => openWeb(`/watch/${publicId}`)}
        style={[s.button, { marginTop: 12 }]}
        accessibilityRole="link"
        accessibilityLabel={t("common.openWeb")}
      >
        <Text style={s.buttonText}>{t("common.openWeb")}</Text>
      </Pressable>
      {!lock.signed_in && (
        <Pressable onPress={() => router.push("/profile")} style={[s.quiet, { marginTop: 4 }]} accessibilityRole="button" accessibilityLabel={t("common.signIn")}>
          <Text style={[s.quietText, dark && { color: colour.slate300 }]}>
            {t("lock.haveAccess")} <Text style={s.link}>{t("common.signIn")}</Text>
          </Text>
        </Pressable>
      )}
    </View>
  )
}

const st = StyleSheet.create({
  light: { borderColor: "#fde68a", backgroundColor: "#fffbeb" },
  dark: { borderRadius: 16, backgroundColor: "rgba(11,11,18,0.88)", padding: 18 },
  title: { fontSize: 17, fontWeight: "700" },
  hint: { fontSize: 13, color: colour.slate500 },
  darkHint: { fontSize: 13, color: colour.slate300 },
  darkText: { fontSize: 15, lineHeight: 21, color: colour.white },
})
