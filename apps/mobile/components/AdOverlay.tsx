import { useEffect, useRef, useState } from "react"
import { Linking, Pressable, StyleSheet, Text, View } from "react-native"
import { useEventListener } from "expo"
import { useVideoPlayer, VideoView } from "expo-video"

import { sendAdEvent, type Ad } from "../lib/ads"
import { clock } from "../lib/format"
import { useT } from "../lib/i18n"
import { colour } from "../lib/theme"

const VIEWABLE_MS = 2000
const QUARTILES: [number, string][] = [
  [0.25, "q1"],
  [0.5, "mid"],
  [0.75, "q3"],
]

function hostOf(url: string): string {
  const m = /^https?:\/\/([^/?#]+)/i.exec(url)
  return m ? m[1] : url
}

export function AdOverlay({ ad, onDone }: { ad: Ad; onDone: () => void }) {
  const { t } = useT()
  const sent = useRef(new Set<string>())
  const finished = useRef(false)
  const [started, setStarted] = useState(false)
  const [pos, setPos] = useState(0)
  const player = useVideoPlayer(ad.playback?.url ?? null, (p) => {
    p.timeUpdateEventInterval = 0.25
    p.play()
  })

  function send(event: string) {
    if (sent.current.has(event)) return
    sent.current.add(event)
    sendAdEvent(ad.token, event)
  }

  function finish(how: "complete" | "skip" | "error") {
    if (finished.current) return
    finished.current = true
    if (how !== "error" && sent.current.has("start")) send(how)
    player.pause()
    onDone()
  }

  const finishRef = useRef(finish)
  finishRef.current = finish

  useEffect(() => {
    if (!ad.playback?.url) {
      finishRef.current("error")
      return
    }
    const stall = setTimeout(() => {
      if (!sent.current.has("start")) finishRef.current("error")
    }, 10_000)
    return () => clearTimeout(stall)
  }, [ad.playback?.url])

  useEffect(() => {
    if (!started) return
    const viewable = setTimeout(() => {
      if (!finished.current) send("q0")
    }, VIEWABLE_MS)
    return () => clearTimeout(viewable)
  }, [started])

  useEventListener(player, "statusChange", ({ status }) => {
    if (status === "error") finishRef.current("error")
  })
  useEventListener(player, "playingChange", ({ isPlaying }) => {
    if (isPlaying && !sent.current.has("start")) {
      send("start")
      setStarted(true)
    }
  })
  useEventListener(player, "timeUpdate", ({ currentTime }) => {
    setPos(currentTime)
    const length = player.duration > 0 ? player.duration : ad.duration_ms / 1000
    if (length > 0 && sent.current.has("start")) for (const [at, name] of QUARTILES) if (currentTime >= length * at) send(name)
  })
  useEventListener(player, "playToEnd", () => finishRef.current("complete"))

  const length = player.duration > 0 ? player.duration : ad.duration_ms / 1000
  const skipAfter = Math.max(0, ad.skip_after_seconds ?? 0)
  const canSkip = started && pos >= skipAfter
  const site = hostOf(ad.click_url)

  function learnMore() {
    send("click")
    Linking.openURL(ad.click_url).catch(() => null)
  }

  return (
    <View style={StyleSheet.absoluteFill} accessibilityLabel={t("ad.region", { brand: ad.brand })}>
      <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} />
      <View style={st.top}>
        <Text style={st.badge}>{t("ad.label", { brand: ad.brand })}</Text>
        {length > 0 && <Text style={st.time}>{t("ad.endsIn", { time: clock(Math.max(0, length - pos) * 1000) })}</Text>}
      </View>
      <View style={st.bottom}>
        <Pressable onPress={learnMore} style={st.learn} accessibilityRole="link" accessibilityLabel={t("ad.learnMoreAt", { site })}>
          <Text style={st.learnText}>{t("ad.learnMore")} ↗</Text>
        </Pressable>
        {canSkip ? (
          <Pressable onPress={() => finish("skip")} style={st.skip} accessibilityRole="button" accessibilityLabel={t("ad.skip")}>
            <Text style={st.skipText}>{t("ad.skip")} ›</Text>
          </Pressable>
        ) : (
          <Text style={st.wait}>{started ? t("ad.skipIn", { n: Math.max(1, Math.ceil(skipAfter - pos)) }) : t("ad.starting")}</Text>
        )}
      </View>
    </View>
  )
}

const st = StyleSheet.create({
  top: { position: "absolute", top: 8, left: 8, right: 8, flexDirection: "row", gap: 6, alignItems: "center" },
  badge: { backgroundColor: "#facc15", color: "#000", fontWeight: "800", fontSize: 12, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, overflow: "hidden" },
  time: { backgroundColor: "rgba(0,0,0,0.75)", color: colour.white, fontSize: 12, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, overflow: "hidden" },
  bottom: { position: "absolute", left: 8, right: 8, bottom: 8, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 8 },
  learn: { backgroundColor: "rgba(0,0,0,0.75)", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  learnText: { color: "#fde68a", fontWeight: "700", fontSize: 13 },
  skip: { backgroundColor: colour.white, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10 },
  skipText: { color: "#000", fontWeight: "800", fontSize: 14 },
  wait: { backgroundColor: "rgba(0,0,0,0.75)", color: colour.white, fontSize: 13, fontWeight: "600", paddingHorizontal: 12, paddingVertical: 10, borderRadius: 8, overflow: "hidden" },
})
