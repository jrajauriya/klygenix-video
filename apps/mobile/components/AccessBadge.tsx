import { StyleSheet, Text, View } from "react-native"

import { accessLabel } from "../lib/format"
import { colour } from "../lib/theme"
import type { Access } from "../lib/types"

export function AccessBadge({ access, priceMinor, dark }: { access?: Access; priceMinor?: number | null; dark?: boolean }) {
  const label = accessLabel(access, priceMinor)
  if (!label) return null
  return (
    <View style={[st.badge, dark ? st.dark : st.light]} accessibilityLabel={access === "members" ? "Members only" : `Paid video, ${label}`}>
      <Text style={[st.text, { color: dark ? colour.white : colour.amber600 }]}>{label}</Text>
    </View>
  )
}

const st = StyleSheet.create({
  badge: { alignSelf: "flex-start", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  light: { backgroundColor: "#fffbeb", borderWidth: 1, borderColor: "#fde68a" },
  dark: { backgroundColor: "rgba(217,119,6,0.9)" },
  text: { fontSize: 11, fontWeight: "700" },
})
