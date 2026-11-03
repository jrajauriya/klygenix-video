import { Tabs } from "expo-router"
import { Text, type ColorValue } from "react-native"

import { colour } from "../../lib/theme"

function Glyph({ char, color }: { char: string; color: ColorValue }) {
  return <Text style={{ fontSize: 18, color }}>{char}</Text>
}

export default function TabsLayout() {
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
          title: "Feed",
          tabBarStyle: { backgroundColor: colour.night, borderTopColor: colour.nightCard },
          tabBarIcon: ({ color }) => <Glyph char="▶" color={color} />,
        }}
      />
      <Tabs.Screen
        name="create"
        options={{ title: "Create", tabBarIcon: ({ color }) => <Glyph char="＋" color={color} /> }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: "Profile", tabBarIcon: ({ color }) => <Glyph char="●" color={color} /> }}
      />
    </Tabs>
  )
}
