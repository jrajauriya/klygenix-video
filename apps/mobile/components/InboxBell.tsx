import { useQuery } from "@tanstack/react-query"
import { router, useIsFocused } from "expo-router"
import { Pressable, StyleSheet, Text, View } from "react-native"

import { useAuth } from "../lib/auth"
import { useT } from "../lib/i18n"
import { inboxCount } from "../lib/inbox"
import { colour } from "../lib/theme"

export function InboxBell() {
  const { user } = useAuth()
  const { t } = useT()
  const focused = useIsFocused()
  const { data: unread = 0 } = useQuery({
    queryKey: ["inbox-count", user?.id],
    queryFn: inboxCount,
    enabled: Boolean(user) && focused,
    refetchInterval: 60_000,
    refetchOnMount: "always",
  })
  const n = user ? unread : 0
  const label = n > 0 ? t("inbox.bell", { n }) : t("inbox.bellNone")

  return (
    <Pressable
      onPress={() => router.push(user ? "/inbox" : "/profile")}
      style={st.bell}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
    >
      <Text style={st.glyph}>🔔</Text>
      {n > 0 && (
        <View style={st.badge}>
          <Text style={st.badgeText}>{n > 99 ? "99+" : n}</Text>
        </View>
      )}
    </Pressable>
  )
}

const st = StyleSheet.create({
  bell: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(11,11,18,0.72)", alignItems: "center", justifyContent: "center" },
  glyph: { fontSize: 18, color: colour.white },
  badge: {
    position: "absolute",
    top: -2,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: colour.red600,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { fontSize: 10, fontWeight: "800", color: colour.white },
})
