import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { router } from "expo-router"
import { Pressable, Text, TextInput, View } from "react-native"

import { api, detail } from "../lib/api"
import { useAuth } from "../lib/auth"
import { useT } from "../lib/i18n"
import { colour, s } from "../lib/theme"
import type { Comment } from "../lib/types"

export function Comments({ publicId }: { publicId: string }) {
  const { user } = useAuth()
  const { t } = useT()
  const qc = useQueryClient()
  const [body, setBody] = useState("")
  const [error, setError] = useState<string | null>(null)

  const { data: comments = [], isLoading } = useQuery<Comment[]>({
    queryKey: ["comments", publicId],
    queryFn: async () => (await api.get(`/api/video/videos/${publicId}/comments`, { params: { limit: 50 } })).data,
  })

  const post = useMutation({
    mutationFn: async () => (await api.post(`/api/video/videos/${publicId}/comments`, { body: body.trim() })).data,
    onSuccess: () => {
      setBody("")
      setError(null)
      qc.invalidateQueries({ queryKey: ["comments", publicId] })
    },
    onError: (err) => setError(detail(err, t("comments.failed"))),
  })

  return (
    <View>
      <Text style={s.heading}>{t("comments.title")}</Text>
      {user ? (
        <View>
          <TextInput style={s.field} placeholder={t("comments.placeholder")} value={body} onChangeText={setBody} maxLength={2000} multiline />
          <Pressable
            onPress={() => post.mutate()}
            disabled={!body.trim() || post.isPending}
            style={[s.outline, (!body.trim() || post.isPending) && s.disabled]}
          >
            <Text style={s.outlineText}>{post.isPending ? t("comments.posting") : t("comments.post")}</Text>
          </Pressable>
          {error && <Text style={s.error}>{error}</Text>}
        </View>
      ) : (
        <Pressable onPress={() => router.push("/profile")} style={s.quiet}>
          <Text style={s.quietText}>{t("comments.signIn")}</Text>
        </Pressable>
      )}
      {isLoading ? (
        <Text style={s.note}>{t("comments.loading")}</Text>
      ) : comments.length === 0 ? (
        <Text style={s.note}>{t("comments.empty")}</Text>
      ) : (
        comments.map((c) => (
          <View key={c.id} style={{ marginTop: 14 }}>
            <Text style={{ fontSize: 13, fontWeight: "700", color: colour.navy }}>{c.author}</Text>
            <Text style={[s.text, { marginTop: 2 }]}>{c.body}</Text>
            {c.replies > 0 && <Text style={s.note}>{t("comments.replies", { n: c.replies })}</Text>}
          </View>
        ))
      )}
    </View>
  )
}
