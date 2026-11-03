import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { router } from "expo-router"
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import { AfterUpload } from "../../components/create/AfterUpload"
import { Compose } from "../../components/create/Compose"
import { OpenChannel } from "../../components/create/OpenChannel"
import { Recorder } from "../../components/create/Recorder"
import { api, detail } from "../../lib/api"
import { useAuth } from "../../lib/auth"
import { colour, s } from "../../lib/theme"
import type { Channel, StudioVideo } from "../../lib/types"

function SignedOut() {
  return (
    <View style={s.centred}>
      <Text style={s.title}>Create on Klygenix Play</Text>
      <Text style={[s.subtitle, { textAlign: "center" }]}>Sign in to open a channel, record reels and turn long videos into clips.</Text>
      <Pressable onPress={() => router.push("/profile")} style={s.button}>
        <Text style={s.buttonText}>Sign in</Text>
      </Pressable>
    </View>
  )
}

export default function Create() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [recording, setRecording] = useState(false)
  const [recorded, setRecorded] = useState<string | null>(null)
  const [uploaded, setUploaded] = useState<StudioVideo | null>(null)

  const channel = useQuery<Channel | null>({
    queryKey: ["studio-channel", user?.id],
    queryFn: async () => {
      const { data } = await api.get("/api/video/studio/channel")
      if (!data) return null
      return (data.channel ?? (data.handle ? data : null)) as Channel | null
    },
    enabled: Boolean(user),
  })

  if (!user) return <SignedOut />

  if (recording) {
    return (
      <Recorder
        onCancel={() => setRecording(false)}
        onRecorded={(uri) => {
          setRecorded(uri)
          setRecording(false)
        }}
      />
    )
  }

  let body
  if (channel.isLoading) {
    body = <ActivityIndicator style={{ marginTop: 48 }} color={colour.brand} />
  } else if (channel.isError) {
    body = <Text style={s.error}>{detail(channel.error, "Your channel could not be loaded.")}</Text>
  } else if (!channel.data) {
    body = <OpenChannel onOpened={(c) => qc.setQueryData(["studio-channel", user.id], c)} />
  } else if (channel.data.is_suspended) {
    body = (
      <View>
        <Text style={s.title}>Channel suspended</Text>
        <Text style={s.subtitle}>@{channel.data.handle} cannot publish right now. See the notice in Studio on the web to appeal.</Text>
      </View>
    )
  } else if (uploaded) {
    body = (
      <AfterUpload
        video={uploaded}
        onDone={() => {
          setUploaded(null)
          setRecorded(null)
        }}
      />
    )
  } else {
    body = <Compose recorded={recorded} onRecord={() => setRecording(true)} onUploaded={setUploaded} />
  }

  return (
    <SafeAreaView style={s.sheet} edges={["top"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
          {channel.data && !uploaded && (
            <View style={[s.chip, { marginBottom: 12 }]}>
              <Text style={s.chipText}>@{channel.data.handle}</Text>
            </View>
          )}
          {body}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}
