import { useEffect, useState } from "react"
import { Pressable, Text, View } from "react-native"
import { useEventListener } from "expo"
import { useVideoPlayer, type VideoPlayer } from "expo-video"

import { colour, s } from "../lib/theme"
import type { Dub } from "../lib/types"

export function DubSwitch({ player, dubs }: { player: VideoPlayer; dubs: Dub[] }) {
  const [language, setLanguage] = useState<string | null>(null)
  const dub = dubs.find((d) => d.language === language) ?? null
  const audio = useVideoPlayer(dub?.url ?? null)

  function sync() {
    if (!dub) return
    audio.currentTime = player.currentTime
    if (player.playing) audio.play()
    else audio.pause()
  }

  useEffect(() => {
    player.muted = Boolean(dub)
    if (dub) sync()
    else audio.pause()
  }, [dub, audio, player])

  useEffect(() => () => {
    player.muted = false
  }, [player])

  useEventListener(audio, "statusChange", ({ status }) => {
    if (status === "readyToPlay") sync()
  })
  useEventListener(player, "playingChange", sync)
  useEventListener(player, "timeUpdate", ({ currentTime }) => {
    if (dub && Math.abs(audio.currentTime - currentTime) > 0.4) audio.currentTime = currentTime
  })

  const options = [{ key: null as string | null, label: "Original" }, ...dubs.map((d) => ({ key: d.language, label: `${d.name} (${d.label})` }))]

  return (
    <View style={{ marginTop: 16 }}>
      <Text style={s.label}>Audio</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 }} accessibilityRole="radiogroup">
        {options.map((o) => {
          const on = o.key === language
          return (
            <Pressable
              key={o.key ?? "original"}
              onPress={() => setLanguage(o.key)}
              style={[s.chip, { paddingHorizontal: 12, paddingVertical: 6 }, on && { backgroundColor: colour.brand }]}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              accessibilityLabel={`Audio: ${o.label}`}
            >
              <Text style={[s.chipText, on && { color: colour.white }]}>{o.label}</Text>
            </Pressable>
          )
        })}
      </View>
      {dub && <Text style={s.note}>This audio track was made by AI from the original.</Text>}
    </View>
  )
}
