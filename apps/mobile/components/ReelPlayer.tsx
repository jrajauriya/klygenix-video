import { useEffect, useRef } from "react"
import { StyleSheet } from "react-native"
import { useEventListener } from "expo"
import { useVideoPlayer, VideoView } from "expo-video"

import { sendProgress } from "../lib/progress"

interface Props {
  publicId: string
  url: string
  muted: boolean
  track: boolean
  limitSeconds?: number
  onDone?: () => void
}

export function ReelPlayer({ publicId, url, muted, track, limitSeconds, onDone }: Props) {
  const preview = Boolean(onDone)
  const player = useVideoPlayer(url, (p) => {
    p.loop = !preview
    p.muted = muted
    p.timeUpdateEventInterval = 1
    p.play()
  })
  const watched = useRef(0)
  const last = useRef(0)
  const completed = useRef(false)

  useEffect(() => {
    player.muted = muted
  }, [muted, player])

  useEffect(() => {
    if (track) sendProgress(publicId, { position_ms: 0, started: true })
    return () => {
      if (track && watched.current > 0) {
        sendProgress(publicId, { position_ms: last.current * 1000, watched_ms: watched.current * 1000 })
      }
    }
  }, [publicId, track])

  useEventListener(player, "timeUpdate", ({ currentTime }) => {
    if (preview && limitSeconds && currentTime >= limitSeconds) {
      player.pause()
      onDone?.()
      return
    }
    const step = currentTime - last.current
    if (step > 0 && step < 2) watched.current += step
    if (track && !completed.current && step < 0 && last.current > 1) {
      completed.current = true
      sendProgress(publicId, { position_ms: last.current * 1000, watched_ms: watched.current * 1000, completed: true })
    }
    last.current = currentTime
  })

  useEventListener(player, "playToEnd", () => {
    onDone?.()
    if (!track || completed.current) return
    completed.current = true
    sendProgress(publicId, { position_ms: last.current * 1000, watched_ms: watched.current * 1000, completed: true })
  })

  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />
}
