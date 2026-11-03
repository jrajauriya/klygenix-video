import { useState } from "react"
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native"

import { api, detail } from "../lib/api"
import { session } from "../lib/session"
import { colour, s } from "../lib/theme"

export function SignIn({ onSignUp }: { onSignUp: () => void }) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const blocked = busy || !email || !password

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const { data } = await api.post("/api/auth/login", { email: email.trim(), password })
      await session.start(data.access_token, data.user)
    } catch (err) {
      setError(detail(err, "That email and password did not work."))
    } finally {
      setBusy(false)
    }
  }

  return (
    <View>
      <Text style={s.title}>Klygenix Play</Text>
      <Text style={s.subtitle}>Sign in to like, comment, ask and create.</Text>
      <TextInput
        style={[s.field, { marginTop: 24 }]}
        placeholder="you@example.com"
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput style={s.field} placeholder="Password" secureTextEntry value={password} onChangeText={setPassword} onSubmitEditing={() => !blocked && submit()} />
      {error && <Text style={s.error}>{error}</Text>}
      <Pressable onPress={submit} disabled={blocked} style={[s.button, blocked && s.disabled]}>
        {busy ? <ActivityIndicator color={colour.white} /> : <Text style={s.buttonText}>Sign in</Text>}
      </Pressable>
      <Pressable onPress={onSignUp} style={s.quiet}>
        <Text style={s.quietText}>
          New here? <Text style={s.link}>Create an account</Text>
        </Text>
      </Pressable>
    </View>
  )
}
