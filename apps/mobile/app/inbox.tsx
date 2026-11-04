import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Stack, router } from "expo-router"
import { ActivityIndicator, FlatList, Image, Pressable, RefreshControl, Text, View } from "react-native"

import { detail } from "../lib/api"
import { useAuth } from "../lib/auth"
import { day } from "../lib/format"
import { useT } from "../lib/i18n"
import { follow, inApp, inbox, markRead } from "../lib/inbox"
import { colour, s } from "../lib/theme"
import type { Inbox as InboxData, InboxItem } from "../lib/types"

export default function Inbox() {
  const { user } = useAuth()
  const { t } = useT()
  const qc = useQueryClient()
  const key = ["inbox", user?.id]
  const list = useQuery({ queryKey: key, queryFn: inbox, enabled: Boolean(user), staleTime: 0 })

  const read = useMutation({
    mutationFn: (ids?: number[]) => markRead(ids),
    onMutate: (ids) => {
      const before = qc.getQueryData<InboxData>(key)
      if (before) {
        const items = before.items.map((n) => (!ids || ids.includes(n.id) ? { ...n, read: true } : n))
        qc.setQueryData<InboxData>(key, { unread: items.filter((n) => !n.read).length, items })
      }
    },
    onSuccess: (unread) => qc.setQueryData(["inbox-count", user?.id], unread),
    onError: () => qc.invalidateQueries({ queryKey: key }),
  })

  function open(n: InboxItem) {
    if (!n.read) read.mutate([n.id])
    follow(n.url)
  }

  const unread = list.data?.unread ?? 0

  return (
    <View style={s.sheet}>
      <Stack.Screen options={{ title: t("inbox.title") }} />
      {!user ? (
        <View style={s.centred}>
          <Text style={s.text}>{t("inbox.signIn")}</Text>
          <Pressable onPress={() => router.push("/profile")} style={s.button} accessibilityRole="button">
            <Text style={s.buttonText}>{t("common.signIn")}</Text>
          </Pressable>
        </View>
      ) : list.isLoading ? (
        <View style={s.centred}>
          <ActivityIndicator color={colour.brand} accessibilityLabel={t("inbox.loading")} />
        </View>
      ) : list.isError ? (
        <View style={s.centred}>
          <Text style={s.error}>{detail(list.error, t("inbox.failed"))}</Text>
          <Pressable onPress={() => list.refetch()} style={s.button} accessibilityRole="button">
            <Text style={s.buttonText}>{t("common.tryAgain")}</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={list.data?.items ?? []}
          keyExtractor={(n) => String(n.id)}
          contentContainerStyle={s.body}
          refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={() => void list.refetch()} />}
          ListHeaderComponent={
            unread > 0 ? (
              <Pressable onPress={() => read.mutate(undefined)} style={{ alignSelf: "flex-end", paddingVertical: 6 }} accessibilityRole="button">
                <Text style={s.link}>{t("inbox.markAll")}</Text>
              </Pressable>
            ) : undefined
          }
          ListEmptyComponent={<Text style={[s.note, { textAlign: "center", fontSize: 14, marginTop: 40 }]}>{t("inbox.empty")}</Text>}
          renderItem={({ item: n }) => {
            const web = Boolean(n.url) && !inApp(n.url)
            return (
              <Pressable
                onPress={() => open(n)}
                style={[s.card, { flexDirection: "row", gap: 12 }, !n.read && { borderColor: colour.brand, backgroundColor: colour.brandLight }]}
                accessibilityRole={web ? "link" : "button"}
                accessibilityLabel={`${n.read ? "" : `${t("inbox.unread")}: `}${n.title}. ${n.body}${web ? `. ${t("inbox.opensWeb")}` : ""}`}
              >
                {n.image ? <Image source={{ uri: n.image }} style={{ width: 64, height: 36, borderRadius: 6, backgroundColor: colour.slate200 }} /> : null}
                <View style={{ flex: 1 }}>
                  <View style={[s.row, { gap: 8 }]}>
                    <Text style={{ flex: 1, fontWeight: n.read ? "600" : "800", color: colour.navy }} numberOfLines={2}>
                      {n.title}
                    </Text>
                    <Text style={{ fontSize: 12, color: colour.slate400 }}>{day(n.created_at)}</Text>
                  </View>
                  {n.body ? (
                    <Text style={{ marginTop: 2, fontSize: 13, color: colour.slate500 }} numberOfLines={3}>
                      {n.body}
                    </Text>
                  ) : null}
                  {web && <Text style={{ marginTop: 4, fontSize: 12, color: colour.brand }}>{t("inbox.opensWeb")} ↗</Text>}
                </View>
              </Pressable>
            )
          }}
        />
      )}
    </View>
  )
}
