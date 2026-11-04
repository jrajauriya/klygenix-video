import { StyleSheet, Text, View } from "react-native"

import { useT } from "../lib/i18n"
import { colour } from "../lib/theme"
import type { PaidPartnership as Deal } from "../lib/types"

export function PaidPartnership({ deal, dark }: { deal?: Deal | null; dark?: boolean }) {
  const { t } = useT()
  if (!deal?.brand) return null
  const label = t("card.paidPartnership", { brand: deal.brand })
  return (
    <View style={[st.chip, dark ? st.dark : st.light]} accessibilityLabel={label}>
      <Text style={[st.text, { color: dark ? colour.white : colour.navy }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  )
}

const st = StyleSheet.create({
  chip: { alignSelf: "flex-start", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, maxWidth: "100%" },
  light: { backgroundColor: colour.slate200 },
  dark: { backgroundColor: "rgba(15,23,42,0.8)", borderWidth: 1, borderColor: "rgba(255,255,255,0.35)" },
  text: { fontSize: 11, fontWeight: "700" },
})
