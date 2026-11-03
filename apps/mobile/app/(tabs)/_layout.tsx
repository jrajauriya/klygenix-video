import { Tabs } from "expo-router"
import { Text, type ColorValue } from "react-native"

import { useT } from "../../lib/i18n"
import { colour } from "../../lib/theme"

function Glyph({ char, color }: { char: string; color: ColorValue }) {
  return <Text style={{ fontSize: 18, color }}>{char}</Text>
}

export default function TabsLayout() {
  const { t } = useT()
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colour.brand,
        tabBarInactiveTintColor: colour.slate400,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t("tab.feed"),
          tabBarStyle: { backgroundColor: colour.night, borderTopColor: colour.nightCard },
          tabBarIcon: ({ color }) => <Glyph char="▶" color={color} />,
        }}
      />
      <Tabs.Screen
        name="study"
        options={{ title: t("tab.study"), tabBarIcon: ({ color }) => <Glyph char="✎" color={color} /> }}
      />
      <Tabs.Screen
        name="create"
        options={{ title: t("tab.create"), tabBarIcon: ({ color }) => <Glyph char="＋" color={color} /> }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: t("tab.profile"), tabBarIcon: ({ color }) => <Glyph char="●" color={color} /> }}
      />
    </Tabs>
  )
}
