import { useState } from "react"
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native"

import { api, detail } from "../lib/api"
import { CONTENT_LANGUAGES } from "../lib/languages"
import { session } from "../lib/session"
import { colour, s } from "../lib/theme"

const COUNTRIES = [
  { code: "IN", label: "India" },
  { code: "US", label: "United States" },
  { code: "GB", label: "United Kingdom" },
  { code: "AE", label: "UAE" },
  { code: "SG", label: "Singapore" },
]


function Choice({ options, value, onChange }: { options: { code: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
      {options.map((o) => {
        const on = o.code === value
        return (
          <Pressable
            key={o.code}
            onPress={() => onChange(o.code)}
            style={[s.chip, { backgroundColor: on ? colour.brand : colour.brandLight }]}
            accessibilityState={{ selected: on }}
          >
            <Text style={[s.chipText, { color: on ? colour.white : colour.brand }]}>{o.label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

export function SignUp({ onSignIn }: { onSignIn: () => void }) {
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [birth, setBirth] = useState("")
  const [country, setCountry] = useState("IN")
  const [language, setLanguage] = useState("en")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const blocked = busy || !name.trim() || !email.trim() || password.length < 8 || !DATE.test(birth)

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const { data } = await api.post("/api/auth/signup", {
        name: name.trim(),
        email: email.trim(),
        password,
        birth_date: birth,
        country,
        language,
      })
      await session.start(data.access_token, data.user)
    } catch (err) {
      setError(detail(err, "The account could not be created."))
    } finally {
      setBusy(false)
    }
  }

  return (
    <View>
      <Text style={s.title}>Create your account</Text>
      <Text style={s.subtitle}>Watch freely without one. An account lets you comment, ask and publish.</Text>
      <TextInput style={[s.field, { marginTop: 20 }]} placeholder="Your name" value={name} onChangeText={setName} autoComplete="name" />
      <TextInput
        style={s.field}
        placeholder="you@example.com"
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput style={s.field} placeholder="Password (8+ characters)" secureTextEntry value={password} onChangeText={setPassword} />
      <Text style={s.label}>Date of birth</Text>
      <TextInput
        style={s.field}
        placeholder="YYYY-MM-DD"
        keyboardType="numbers-and-punctuation"
        value={birth}
        onChangeText={setBirth}
        maxLength={10}
      />
      <Text style={s.note}>You must be 18 or older in India, and 13 or older elsewhere, to open an account.</Text>
      <Text style={s.label}>Country</Text>
      <Choice options={COUNTRIES} value={country} onChange={setCountry} />
      <Text style={s.label}>Language</Text>
      <Choice options={CONTENT_LANGUAGES} value={language} onChange={setLanguage} />
      {error && <Text style={s.error}>{error}</Text>}
      <Pressable onPress={submit} disabled={blocked} style={[s.button, blocked && s.disabled]}>
        {busy ? <ActivityIndicator color={colour.white} /> : <Text style={s.buttonText}>Create account</Text>}
      </Pressable>
      <Pressable onPress={onSignIn} style={s.quiet}>
        <Text style={s.quietText}>
          Already have one? <Text style={s.link}>Sign in</Text>
        </Text>
      </Pressable>
    </View>
  )
}
