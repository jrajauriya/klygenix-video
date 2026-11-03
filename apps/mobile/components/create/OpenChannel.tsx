import { useState } from "react"
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native"

import { api, detail } from "../../lib/api"
import { colour, s } from "../../lib/theme"
import type { Channel } from "../../lib/types"

export function OpenChannel({ onOpened }: { onOpened: (c: Channel) => void }) {
  const [name, setName] = useState("")
  const [handle, setHandle] = useState("")
  const [about, setAbout] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const blocked = busy || !name.trim()

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const { data } = await api.post("/api/video/studio/channel", {
        name: name.trim(),
        handle: handle.trim() || null,
        about: about.trim(),
      })
      onOpened(data.channel ?? data)
    } catch (err) {
      setError(detail(err, "The channel could not be opened."))
    } finally {
      setBusy(false)
    }
  }

  return (
    <View>
      <Text style={s.title}>Open your channel</Text>
      <Text style={s.subtitle}>A channel is where your videos and reels live. You can change the name later.</Text>
      <Text style={s.label}>Channel name</Text>
      <TextInput style={s.field} placeholder="Asha Codes" value={name} onChangeText={setName} maxLength={80} />
      <Text style={s.label}>Handle (optional)</Text>
      <TextInput
        style={s.field}
        placeholder="asha-codes"
        autoCapitalize="none"
        autoCorrect={false}
        value={handle}
        onChangeText={(v) => setHandle(v.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
        maxLength={30}
      />
      <Text style={s.label}>About</Text>
      <TextInput style={[s.field, { minHeight: 80 }]} placeholder="What you make" value={about} onChangeText={setAbout} multiline />
      {error && <Text style={s.error}>{error}</Text>}
      <Pressable onPress={submit} disabled={blocked} style={[s.button, blocked && s.disabled]}>
        {busy ? <ActivityIndicator color={colour.white} /> : <Text style={s.buttonText}>Open channel</Text>}
      </Pressable>
    </View>
  )
}
