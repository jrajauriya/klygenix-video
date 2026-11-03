import { Pressable, Text, View } from "react-native"

import { useT } from "../lib/i18n"
import type { Lang } from "../lib/lang"
import { colour, s } from "../lib/theme"

const OPTIONS: { key: Lang; label: string }[] = [
  { key: "en", label: "English" },
  { key: "hi", label: "हिन्दी" },
]

export function LanguageSwitch() {
  const { lang, setLang, t } = useT()
  return (
    <View style={[s.row, { marginTop: 16 }]}>
      <Text style={[s.text, { flex: 1 }]}>{t("profile.language")}</Text>
      <View style={{ flexDirection: "row", gap: 8 }} accessibilityRole="radiogroup">
        {OPTIONS.map((o) => (
          <Pressable
            key={o.key}
            onPress={() => setLang(o.key)}
            style={[s.chip, lang === o.key && { backgroundColor: colour.brand }]}
            accessibilityRole="radio"
            accessibilityState={{ checked: lang === o.key }}
          >
            <Text style={[s.chipText, lang === o.key && { color: colour.white }]}>{o.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  )
}
