import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { router } from "expo-router"
import { Image, Pressable, Text, View } from "react-native"

import { api, detail, openWeb } from "../lib/api"
import { useAuth } from "../lib/auth"
import { day } from "../lib/format"
import { colour, s } from "../lib/theme"
import type { Post } from "../lib/types"

function Poll({ post, handle }: { post: Post; handle: string }) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const poll = post.poll!
  const voted = poll.my_vote !== null

  const vote = useMutation({
    mutationFn: async (optionId: number) => (await api.post<Post>(`/api/video/posts/${post.id}/vote`, { option_id: optionId })).data,
    onSuccess: (next) => {
      setError(null)
      qc.setQueryData<Post[]>(["posts", handle, user?.id ?? null], (old = []) => old.map((p) => (p.id === next.id ? next : p)))
    },
    onError: (err) => setError(detail(err, "Your vote could not be counted.")),
  })

  function choose(id: number) {
    if (!user) {
      router.push("/profile")
      return
    }
    if (!voted && !vote.isPending) vote.mutate(id)
  }

  return (
    <View style={{ marginTop: 8 }}>
      {poll.options.map((o) => {
        const share = poll.total ? Math.round((o.votes / poll.total) * 100) : 0
        const mine = poll.my_vote === o.id
        return (
          <Pressable
            key={o.id}
            onPress={() => choose(o.id)}
            disabled={voted || vote.isPending}
            style={{ marginTop: 6, borderRadius: 10, borderWidth: 1, borderColor: mine ? colour.brand : colour.slate200, overflow: "hidden" }}
            accessibilityRole="button"
            accessibilityState={{ disabled: voted, selected: mine }}
            accessibilityLabel={voted ? `${o.label}, ${share} percent${mine ? ", your vote" : ""}` : `Vote for ${o.label}`}
          >
            {voted && <View style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: `${share}%`, backgroundColor: colour.brandLight }} />}
            <View style={[s.row, { paddingHorizontal: 12, paddingVertical: 10 }]}>
              <Text style={[s.text, mine && { fontWeight: "700" }]}>{o.label}</Text>
              {voted && <Text style={{ fontSize: 13, color: colour.slate500 }}>{share}%</Text>}
            </View>
          </Pressable>
        )
      })}
      <Text style={s.note}>
        {poll.total} {poll.total === 1 ? "vote" : "votes"}
        {!user ? " · Sign in to vote" : ""}
      </Text>
      {error && <Text style={s.error}>{error}</Text>}
    </View>
  )
}

export function Community({ handle }: { handle: string }) {
  const { user } = useAuth()
  const { data: posts = [], isLoading, error } = useQuery<Post[]>({
    queryKey: ["posts", handle, user?.id ?? null],
    queryFn: async () => (await api.get(`/api/video/channels/${handle}/posts`, { params: { limit: 30 } })).data,
  })

  return (
    <View>
      <Text style={s.heading}>Community</Text>
      {isLoading ? (
        <Text style={s.note}>Loading posts…</Text>
      ) : error ? (
        <Text style={s.error}>{detail(error, "Posts could not load.")}</Text>
      ) : posts.length === 0 ? (
        <Text style={s.note}>No posts yet.</Text>
      ) : (
        posts.map((p) => (
          <View key={p.id} style={s.card}>
            <Text style={s.cardHint}>{day(p.created_at)}</Text>
            {p.locked ? (
              <View style={{ marginTop: 6 }}>
                <Text style={[s.text, { fontWeight: "600" }]}>Members-only post</Text>
                <Text style={{ marginTop: 2, fontSize: 13, color: colour.slate500 }}>Channel members can read this post.</Text>
                <Pressable
                  onPress={() => openWeb(`/@${handle}`)}
                  style={[s.outline, { marginTop: 10 }]}
                  accessibilityRole="link"
                  accessibilityLabel="Join on the web"
                >
                  <Text style={s.outlineText}>Join on the web</Text>
                </Pressable>
              </View>
            ) : (
              <>
                {p.body ? <Text style={[s.text, { marginTop: 6 }]}>{p.body}</Text> : null}
                {p.image && (
                  <Image
                    source={{ uri: p.image }}
                    style={{ marginTop: 8, width: "100%", aspectRatio: 4 / 3, borderRadius: 10, backgroundColor: colour.slate200 }}
                    resizeMode="cover"
                    accessibilityLabel="Post image"
                  />
                )}
                {p.kind === "poll" && p.poll && <Poll post={p} handle={handle} />}
              </>
            )}
          </View>
        ))
      )}
    </View>
  )
}
