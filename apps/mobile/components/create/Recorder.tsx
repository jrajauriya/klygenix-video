import { useEffect, useRef, useState } from "react"
import { CameraView, useCameraPermissions, useMicrophonePermissions, type CameraType } from "expo-camera"
import { Pressable, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import { clock } from "../../lib/format"
import { colour, s } from "../../lib/theme"

const MAX_SECONDS = 90

export function Recorder({ onRecorded, onCancel }: { onRecorded: (uri: string) => void; onCancel: () => void }) {
  const camera = useRef<CameraView>(null)
  const [cam, askCam] = useCameraPermissions()
  const [mic, askMic] = useMicrophonePermissions()
  const [facing, setFacing] = useState<CameraType>("back")
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!recording) return
    const started = Date.now()
    const t = setInterval(() => setElapsed(Date.now() - started), 250)
    return () => clearInterval(t)
  }, [recording])

  if (!cam || !mic) return <View style={s.centred} />

  if (!cam.granted || !mic.granted) {
    return (
      <View style={s.centred}>
        <Text style={[s.text, { textAlign: "center" }]}>Klygenix Play needs the camera and microphone to record a video.</Text>
        <Pressable
          onPress={async () => {
            await askCam()
            await askMic()
          }}
          style={s.button}
        >
          <Text style={s.buttonText}>Allow camera and microphone</Text>
        </Pressable>
        <Pressable onPress={onCancel} style={s.quiet}>
          <Text style={s.quietText}>Cancel</Text>
        </Pressable>
      </View>
    )
  }

  async function start() {
    if (!camera.current) return
    setError(null)
    setElapsed(0)
    setRecording(true)
    try {
      const result = await camera.current.recordAsync({ maxDuration: MAX_SECONDS })
      if (result?.uri) onRecorded(result.uri)
    } catch {
      setError("Recording stopped unexpectedly.")
    } finally {
      setRecording(false)
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colour.night }}>
      <CameraView ref={camera} style={StyleSheet.absoluteFill} mode="video" facing={facing} />
      <SafeAreaView style={{ flex: 1, justifyContent: "space-between" }}>
        <View style={[s.row, { paddingHorizontal: 16, paddingTop: 8 }]}>
          <Pressable onPress={onCancel} disabled={recording}>
            <Text style={st.top}>Cancel</Text>
          </Pressable>
          <Text style={st.top}>
            {clock(elapsed)} / {clock(MAX_SECONDS * 1000)}
          </Text>
          <Pressable onPress={() => setFacing((f) => (f === "back" ? "front" : "back"))} disabled={recording}>
            <Text style={st.top}>Flip</Text>
          </Pressable>
        </View>
        <View style={{ alignItems: "center", paddingBottom: 32 }}>
          {error && <Text style={[s.error, { color: colour.white }]}>{error}</Text>}
          <Pressable
            onPress={() => (recording ? camera.current?.stopRecording() : start())}
            style={[st.shutter, recording && st.shutterOn]}
            accessibilityRole="button"
            accessibilityLabel={recording ? "Stop recording" : "Start recording"}
          />
          <Text style={[st.top, { marginTop: 10 }]}>{recording ? "Tap to stop" : "Hold the phone upright · up to 90 s"}</Text>
        </View>
      </SafeAreaView>
    </View>
  )
}

const st = StyleSheet.create({
  top: { color: colour.white, fontSize: 15, fontWeight: "600" },
  shutter: { width: 76, height: 76, borderRadius: 38, borderWidth: 6, borderColor: colour.white, backgroundColor: colour.red600 },
  shutterOn: { borderRadius: 16, backgroundColor: colour.brand },
})
