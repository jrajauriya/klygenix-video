import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Pressable, Text, TextInput, View } from "react-native"

import { api, detail } from "../lib/api"
import { clock } from "../lib/format"
import { colour, s } from "../lib/theme"
import type { Note } from "../lib/types"

export function Notes({ publicId, now, onSeek }: { publicId: string; now: () => number; onSeek: (ms: number) => void }) {
  const qc = useQueryClient()
  const key = ["notes", publicId]
  const [body, setBody] = useState("")
  const [error, setError] = useState<string | null>(null)

  const { data: notes = [], isLoading } = useQuery<Note[]>({
    queryKey: key,
    queryFn: async () => (await api.get(`/api/video/videos/${publicId}/notes`)).data,
  })

  const add = useMutation({
    mutationFn: async () =>
      (await api.post<Note>(`/api/video/videos/${publicId}/notes`, { t_ms: Math.max(0, Math.round(now())), body: body.trim() })).data,
    onSuccess: (note) => {
      setBody("")
      setError(null)
      qc.setQueryData<Note[]>(key, (old = []) => [...old, note].sort((a, b) => a.t_ms - b.t_ms || a.id - b.id))
    },
    onError: (err) => setError(detail(err, "Your note could not be saved.")),
  })

  const remove = useMutation({
    mutationFn: async (id: number) => api.delete(`/api/video/notes/${id}`),
    onSuccess: (_, id) => qc.setQueryData<Note[]>(key, (old = []) => old.filter((n) => n.id !== id)),
    onError: (err) => setError(detail(err, "That note could not be deleted.")),
  })

  const blocked = !body.trim() || add.isPending

  return (
    <View>
      <Text style={s.heading}>My notes</Text>
      <TextInput
        style={s.field}
        placeholder="Note at the current time"
        value={body}
        onChangeText={setBody}
        maxLength={2000}
        multiline
        accessibilityLabel="Note text"
      />
      <Pressable
        onPress={() => add.mutate()}
        disabled={blocked}
        style={[s.outline, blocked && s.disabled]}
        accessibilityRole="button"
        accessibilityLabel="Add note at the current time"
      >
        <Text style={s.outlineText}>{add.isPending ? "Saving…" : "Add note here"}</Text>
      </Pressable>
      {error && <Text style={s.error}>{error}</Text>}
      {isLoading ? (
        <Text style={s.note}>Loading your notes…</Text>
      ) : notes.length === 0 ? (
        <Text style={s.note}>Notes are private to you. Tap one to jump to its moment.</Text>
      ) : (
        notes.map((n) => (
          <View key={n.id} style={[s.row, { marginTop: 12, alignItems: "flex-start", gap: 10 }]}>
            <Pressable
              onPress={() => onSeek(n.t_ms)}
              style={{ flex: 1 }}
              accessibilityRole="button"
              accessibilityLabel={`Jump to ${n.label || clock(n.t_ms)}: ${n.body}`}
            >
              <Text style={s.link}>{n.label || clock(n.t_ms)}</Text>
              <Text style={[s.text, { marginTop: 2 }]}>{n.body}</Text>
            </Pressable>
            <Pressable
              onPress={() => remove.mutate(n.id)}
              disabled={remove.isPending}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Delete note at ${n.label || clock(n.t_ms)}`}
            >
              <Text style={{ fontSize: 13, color: colour.red600 }}>Delete</Text>
            </Pressable>
          </View>
        ))
      )}
    </View>
  )
}
