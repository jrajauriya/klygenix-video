import { router } from "expo-router"
import { Pressable, StyleSheet, Text, View } from "react-native"

import { openWeb } from "../lib/api"
import { price } from "../lib/format"
import { colour, s } from "../lib/theme"
import type { Lock } from "../lib/types"

export function LockCard({ lock, publicId, ended, dark }: { lock: Lock; publicId: string; ended?: boolean; dark?: boolean }) {
  const members = lock.access === "members"
  const tiers = lock.tiers ?? []
  const text = dark ? st.darkText : s.text
  const hint = dark ? st.darkHint : st.hint

  return (
    <View style={dark ? st.dark : [s.card, st.light]}>
      <Text style={[st.title, { color: dark ? colour.white : colour.navy }]}>{members ? "Members only" : "Paid video"}</Text>
      {ended ? (
        <Text style={[hint, { marginTop: 4 }]}>The preview has ended.</Text>
      ) : lock.preview_seconds > 0 ? (
        <Text style={[hint, { marginTop: 4 }]}>You are watching a {lock.preview_seconds}-second preview.</Text>
      ) : null}

      {members ? (
        tiers.length > 0 ? (
          <View style={{ marginTop: 8 }}>
            <Text style={text}>Included with these memberships:</Text>
            {tiers.map((t) => (
              <Text key={t.id} style={[text, { marginTop: 4, fontWeight: "600" }]}>
                {t.name} · {price(t.price_minor)} a month
              </Text>
            ))}
          </View>
        ) : (
          <Text style={[text, { marginTop: 8 }]}>This video is for members of the channel.</Text>
        )
      ) : (
        <View style={{ marginTop: 8 }}>
          <Text style={[text, { fontWeight: "600" }]}>{price(lock.price_minor, lock.currency ?? "INR")} to watch</Text>
          {(lock.series ?? []).map((sr) => (
            <Text key={sr.id} style={[hint, { marginTop: 4 }]}>
              Also in the series “{sr.title}”{sr.price_minor ? ` · ${price(sr.price_minor)}` : ""}
            </Text>
          ))}
        </View>
      )}

      <Text style={[hint, { marginTop: 10 }]}>Memberships and purchases are handled on the Klygenix Play website.</Text>
      <Pressable
        onPress={() => openWeb(`/watch/${publicId}`)}
        style={[s.button, { marginTop: 12 }]}
        accessibilityRole="link"
        accessibilityLabel="Open on the web"
      >
        <Text style={s.buttonText}>Open on the web</Text>
      </Pressable>
      {!lock.signed_in && (
        <Pressable onPress={() => router.push("/profile")} style={[s.quiet, { marginTop: 4 }]} accessibilityRole="button" accessibilityLabel="Sign in">
          <Text style={[s.quietText, dark && { color: colour.slate300 }]}>
            Already have access? <Text style={s.link}>Sign in</Text>
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
