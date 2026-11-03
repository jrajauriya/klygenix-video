import { useState } from "react"
import { Linking, Pressable, ScrollView, Text, View } from "react-native"

import { api } from "../lib/api"
import { colour, s } from "../lib/theme"
import type { VideoDetail } from "../lib/types"

export function ProductLinks({ products }: { products: NonNullable<VideoDetail["products"]> }) {
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function open(id: number) {
    setBusy(id)
    setError(null)
    try {
      const { data } = await api.post<{ url: string }>(`/api/video/products/${id}/click`)
      await Linking.openURL(data.url)
    } catch {
      setError("That link could not be opened.")
    } finally {
      setBusy(null)
    }
  }

  return (
    <View>
      <Text style={s.heading}>Products in this video</Text>
      <Text style={[s.note, { marginTop: 4 }]}>{products.disclosure}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingVertical: 4 }}>
        {products.items.map((p) => (
          <Pressable
            key={p.id}
            onPress={() => open(p.id)}
            disabled={busy !== null}
            style={[s.card, { width: 180 }, busy === p.id && s.disabled]}
            accessibilityRole="link"
            accessibilityLabel={`${p.title}${p.price_text ? `, ${p.price_text}` : ""}, opens ${p.host}`}
          >
            <Text style={{ fontWeight: "600", color: colour.navy }} numberOfLines={2}>
              {p.title}
            </Text>
            {p.price_text ? <Text style={{ marginTop: 4, color: colour.navy }}>{p.price_text}</Text> : null}
            <Text style={[s.cardHint, { marginTop: 6 }]} numberOfLines={1}>
              {p.host} ↗
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      {error && <Text style={s.error}>{error}</Text>}
    </View>
  )
}
