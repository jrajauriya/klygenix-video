import { useEffect, useRef, useState } from "react"
import { Camera, CameraOff, Radio, Square } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { Button, Card, StatusPill } from "@klygenixvideo/ui"
import { detail } from "../../lib/format"
import { LIVE_STUDIO, wsUrl, type LiveStream } from "../../lib/live"

type Phase = "off" | "camera" | "connecting" | "sending" | "stopping"

const TYPES = ["video/webm;codecs=vp8,opus", "video/webm;codecs=vp9,opus", "video/webm"]

function pickType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined
  return TYPES.find((t) => MediaRecorder.isTypeSupported(t))
}

const PHASE: Record<Phase, { label: string; hex: string }> = {
  off: { label: "Camera off", hex: "#475569" },
  camera: { label: "Camera ready", hex: "#1d4ed8" },
  connecting: { label: "Connecting", hex: "#6d28d9" },
  sending: { label: "Sending video", hex: "#b91c1c" },
  stopping: { label: "Stopping", hex: "#92400e" },
}

export function BrowserGoLive({ stream, onChange }: { stream: LiveStream; onChange?: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const media = useRef<MediaStream | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const socket = useRef<WebSocket | null>(null)
  const stopping = useRef(false)
  const [phase, setPhase] = useState<Phase>("off")
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(0)
  const closed = stream.status === "ended" || stream.status === "failed"
  const supported = typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia) && Boolean(pickType())

  useEffect(() => () => teardown(true), [])

  useEffect(() => {
    if (closed && phase !== "off") stop()
  }, [closed])

  function teardown(all: boolean) {
    stopping.current = true
    try {
      if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop()
    } catch {
      recorder.current = null
    }
    recorder.current = null
    if (socket.current && socket.current.readyState <= WebSocket.OPEN) socket.current.close(1000)
    socket.current = null
    if (all) {
      media.current?.getTracks().forEach((t) => t.stop())
      media.current = null
      if (videoRef.current) videoRef.current.srcObject = null
    }
  }

  async function camera() {
    setError(null)
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: true })
      media.current = s
      if (videoRef.current) {
        videoRef.current.srcObject = s
        await videoRef.current.play().catch(() => undefined)
      }
      setPhase("camera")
    } catch (err) {
      const name = (err as { name?: string })?.name
      setError(name === "NotAllowedError" ? "The browser was not allowed to use the camera and microphone." : "No camera or microphone could be opened.")
    }
  }

  function cameraOff() {
    teardown(true)
    setPhase("off")
  }

  async function start() {
    if (!media.current) return
    setError(null)
    setSent(0)
    setPhase("connecting")
    stopping.current = false
    let ticket: string
    try {
      ticket = (await api.get<{ ticket: string }>(`${LIVE_STUDIO}/${stream.id}/ingest-ticket`)).data.ticket
    } catch (err) {
      setError(detail(err, "Could not get permission to send video"))
      setPhase("camera")
      return
    }
    const ws = new WebSocket(wsUrl(`/api/video/ws/live/${encodeURIComponent(stream.id)}/ingest?ticket=${encodeURIComponent(ticket)}`))
    socket.current = ws
    ws.onopen = () => {
      if (!media.current) return
      const rec = new MediaRecorder(media.current, { mimeType: pickType(), videoBitsPerSecond: 2_500_000 })
      recorder.current = rec
      rec.ondataavailable = (e) => {
        if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) {
          ws.send(e.data)
          setSent((n) => n + e.data.size)
        }
      }
      rec.onstop = () => {
        if (ws.readyState === WebSocket.OPEN) setTimeout(() => ws.close(1000), 300)
      }
      rec.start(1000)
      setPhase("sending")
      onChange?.()
    }
    ws.onclose = (e) => {
      if (socket.current === ws) socket.current = null
      if (recorder.current && recorder.current.state !== "inactive") {
        try {
          recorder.current.stop()
        } catch {
          recorder.current = null
        }
      }
      recorder.current = null
      if (!stopping.current) {
        setError(e.code === 4403 ? "The server refused the video. The stream may have ended, or the permission ran out." : "The connection dropped. Press Go live to carry on.")
      }
      setPhase(media.current ? "camera" : "off")
      onChange?.()
    }
  }

  function stop() {
    setPhase("stopping")
    stopping.current = true
    if (recorder.current && recorder.current.state !== "inactive") {
      recorder.current.stop()
    } else {
      socket.current?.close(1000)
    }
  }

  const p = PHASE[phase]

  return (
    <Card className="space-y-3 p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-navy">Go live from this browser</h2>
          <p className="mt-0.5 text-sm text-slate-500">Uses your camera and microphone. No encoder needed.</p>
        </div>
        <StatusPill label={p.label} hex={p.hex} />
      </div>
      <div className="relative overflow-hidden rounded-lg bg-black" style={{ aspectRatio: "16 / 9" }}>
        <video ref={videoRef} muted playsInline autoPlay className="absolute inset-0 h-full w-full object-cover" aria-label="Camera preview" />
        {phase === "off" && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-300">Camera preview</div>
        )}
      </div>
      {!supported && <p className="text-sm text-amber-800">This browser cannot record WebM video. Use Chrome, Edge or Firefox, or stream from OBS.</p>}
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {phase === "off" ? (
          <Button variant="outline" onClick={camera} disabled={!supported || closed}><Camera size={14} /> Turn camera on</Button>
        ) : (
          <Button variant="ghost" onClick={cameraOff} disabled={phase === "sending" || phase === "connecting"}><CameraOff size={14} /> Camera off</Button>
        )}
        {phase === "sending" || phase === "stopping" ? (
          <Button variant="destructive" onClick={stop} disabled={phase === "stopping"}><Square size={14} /> {phase === "stopping" ? "Stopping…" : "Stop sending"}</Button>
        ) : (
          <Button onClick={start} disabled={phase !== "camera" || closed}><Radio size={14} /> {phase === "connecting" ? "Connecting…" : "Go live"}</Button>
        )}
        {sent > 0 && <span className="ml-auto font-num text-xs text-slate-500">{(sent / 1_048_576).toFixed(1)} MB sent</span>}
      </div>
      <p className="text-xs text-slate-500">Stopping sends nothing more but keeps the stream open. Use End stream to finish it.</p>
    </Card>
  )
}
