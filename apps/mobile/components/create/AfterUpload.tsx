import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { router } from "expo-router"
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native"

import { api, detail } from "../../lib/api"
import { clock, humanise } from "../../lib/format"
import { colour, s } from "../../lib/theme"
import type { Clip, StudioVideo, Suggestion } from "../../lib/types"
import { SETTLED } from "../../lib/upload"

const CLIP_SETTLED = new Set(["rendered", "published", "failed"])

function ClipRow({ clip, onChange }: { clip: Clip; onChange: (c: Clip) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [publicId, setPublicId] = useState<string | null>(null)

  useQuery({
    queryKey: ["clip", clip.id],
    queryFn: async () => {
      const { data } = await api.get<Clip>(`/api/video/studio/clips/${clip.id}`)
      onChange(data)
      return data
    },
    enabled: !CLIP_SETTLED.has(clip.status) && clip.status !== "draft",
    refetchInterval: 2500,
  })

  async function run(step: "render" | "publish") {
    setBusy(true)
    setError(null)
    try {
      if (step === "render") {
        const { data } = await api.post<Clip>(`/api/video/studio/clips/${clip.id}/render`)
        onChange(data)
      } else {
        const { data } = await api.post<{ clip: Clip; public_id: string }>(`/api/video/studio/clips/${clip.id}/publish`, {
          visibility: "public",
        })
        onChange(data.clip)
        setPublicId(data.public_id)
      }
    } catch (err) {
      setError(detail(err, step === "render" ? "The clip could not be rendered." : "The clip could not be published."))
    } finally {
      setBusy(false)
    }
  }

  const working = clip.status === "queued" || clip.status === "rendering"

  return (
    <View style={s.card}>
      <Text style={{ fontWeight: "700", color: colour.navy }}>{clip.title}</Text>
      <Text style={s.cardHint}>
        {clock(clip.start_ms)} – {clock(clip.end_ms)} · {humanise(clip.status)}
      </Text>
      {working && <ActivityIndicator style={{ marginTop: 8 }} color={colour.brand} />}
      {clip.status === "failed" && clip.error && <Text style={s.error}>{clip.error}</Text>}
      {(clip.status === "draft" || clip.status === "failed") && (
        <Pressable onPress={() => run("render")} disabled={busy} style={[s.outline, busy && s.disabled]}>
          <Text style={s.outlineText}>{busy ? "Starting…" : "Render"}</Text>
        </Pressable>
      )}
      {clip.status === "rendered" && !publicId && (
        <Pressable onPress={() => run("publish")} disabled={busy} style={[s.button, { marginTop: 12 }, busy && s.disabled]}>
          <Text style={s.buttonText}>{busy ? "Publishing…" : "Publish as a reel"}</Text>
        </Pressable>
      )}
      {publicId && (
        <Pressable onPress={() => router.push(`/watch/${publicId}`)} style={s.quiet}>
          <Text style={s.quietText}>
            Published — <Text style={s.link}>watch it</Text>
          </Text>
        </Pressable>
      )}
      {error && <Text style={s.error}>{error}</Text>}
    </View>
  )
}

function Trim({ video, onMade }: { video: StudioVideo; onMade: (c: Clip) => void }) {
  const [start, setStart] = useState("0")
  const [end, setEnd] = useState(String(Math.min(30, Math.floor((video.duration_ms ?? 30000) / 1000))))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function make() {
    const a = Math.round(Number(start) * 1000)
    const b = Math.round(Number(end) * 1000)
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) {
      setError("The end must come after the start.")
      return
    }
    setBusy(true)
    setError(null)
    try {
      const { data } = await api.post<Clip>("/api/video/studio/clips", {
        source_video_id: video.id,
        title: `${video.title} (${clock(a)}–${clock(b)})`.slice(0, 160),
        start_ms: a,
        end_ms: b,
      })
      onMade(data)
    } catch (err) {
      setError(detail(err, "That clip could not be made."))
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={s.card}>
      <Text style={s.cardLabel}>Your own trim (seconds)</Text>
      <View style={{ flexDirection: "row", gap: 12 }}>
        <TextInput style={[s.field, { flex: 1 }]} keyboardType="decimal-pad" value={start} onChangeText={setStart} placeholder="Start" />
        <TextInput style={[s.field, { flex: 1 }]} keyboardType="decimal-pad" value={end} onChangeText={setEnd} placeholder="End" />
      </View>
      {error && <Text style={s.error}>{error}</Text>}
      <Pressable onPress={make} disabled={busy} style={[s.outline, busy && s.disabled]}>
        <Text style={s.outlineText}>{busy ? "Making…" : "Make clip"}</Text>
      </Pressable>
    </View>
  )
}

export function AfterUpload({ video: initial, onDone }: { video: StudioVideo; onDone: () => void }) {
  const qc = useQueryClient()
  const [clips, setClips] = useState<Clip[]>([])
  const [making, setMaking] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: video = initial } = useQuery<StudioVideo>({
    queryKey: ["studio-video", initial.id],
    queryFn: async () => (await api.get(`/api/video/studio/videos/${initial.id}`)).data,
    refetchInterval: (q) => {
      const v = q.state.data
      return v && SETTLED.has(v.status) && v.ai_status !== "pending" && v.ai_status !== "running" ? false : 3000
    },
  })

  const settled = SETTLED.has(video.status)
  const aiReady = video.ai_status === "ready"
  const { data: suggestions = [], isLoading } = useQuery<Suggestion[]>({
    queryKey: ["suggestions", video.id],
    queryFn: async () => (await api.get(`/api/video/studio/videos/${video.id}/suggestions`)).data,
    enabled: settled && aiReady && video.kind === "long",
  })

  const upsert = (c: Clip) => setClips((list) => [c, ...list.filter((x) => x.id !== c.id)])

  async function fromSuggestion(sg: Suggestion) {
    setMaking(sg.id)
    setError(null)
    try {
      const { data } = await api.post<Clip>("/api/video/studio/clips", {
        source_video_id: video.id,
        suggestion_id: sg.id,
        title: sg.title.slice(0, 160),
        start_ms: sg.start_ms,
        end_ms: sg.end_ms,
      })
      upsert(data)
    } catch (err) {
      setError(detail(err, "That clip could not be made."))
    } finally {
      setMaking(null)
    }
  }

  function finish() {
    qc.invalidateQueries({ queryKey: ["studio-videos"] })
    onDone()
  }

  return (
    <View>
      <Text style={s.title}>{video.title}</Text>
      <View style={[s.card, { flexDirection: "row", alignItems: "center", gap: 12 }]}>
        {!settled && <ActivityIndicator color={colour.brand} />}
        <View style={{ flex: 1 }}>
          <Text style={s.cardLabel}>Status</Text>
          <Text style={s.cardValue}>{humanise(video.status)}</Text>
          <Text style={s.cardHint}>AI: {video.ai_status ? humanise(video.ai_status) : "waiting"}</Text>
        </View>
      </View>
      {video.status === "in_review" && <Text style={s.note}>The safety scan held this for a person to review. You will be told when it is decided.</Text>}
      {video.status === "blocked" && <Text style={s.error}>{video.status_note ?? "This video cannot be published."}</Text>}
      {video.status === "failed" && <Text style={s.error}>{video.status_note ?? "Processing failed. Try uploading again."}</Text>}
      {video.status === "published" && (
        <Pressable onPress={() => router.push(`/watch/${video.public_id}`)} style={s.quiet}>
          <Text style={s.quietText}>
            Published — <Text style={s.link}>watch it</Text>
          </Text>
        </Pressable>
      )}

      {settled && video.status !== "blocked" && video.status !== "failed" && (
        <>
          <Text style={s.heading}>Clips</Text>
          {video.kind === "reel" ? (
            <Text style={s.note}>This is already a reel. Clip suggestions are made for long videos.</Text>
          ) : !aiReady ? (
            <Text style={s.note}>Clip ideas appear once the transcript is ready.</Text>
          ) : isLoading ? (
            <ActivityIndicator style={{ marginTop: 12 }} color={colour.brand} />
          ) : suggestions.length === 0 ? (
            <Text style={s.note}>No suggestions for this one. Make your own trim below.</Text>
          ) : (
            suggestions.map((sg) => (
              <View key={sg.id} style={s.card}>
                <Text style={{ fontWeight: "700", color: colour.navy }}>{sg.title}</Text>
                <Text style={s.cardHint}>
                  {clock(sg.start_ms)} – {clock(sg.end_ms)} · score {Math.round(sg.score * 100)}
                </Text>
                {sg.hook ? <Text style={[s.text, { marginTop: 6 }]}>{sg.hook}</Text> : null}
                <Pressable onPress={() => fromSuggestion(sg)} disabled={making !== null} style={[s.outline, making !== null && s.disabled]}>
                  <Text style={s.outlineText}>{making === sg.id ? "Making…" : "Make clip"}</Text>
                </Pressable>
              </View>
            ))
          )}
          {video.kind === "long" && aiReady && <Trim video={video} onMade={upsert} />}
          {error && <Text style={s.error}>{error}</Text>}
          {clips.map((c) => (
            <ClipRow key={c.id} clip={c} onChange={upsert} />
          ))}
        </>
      )}

      <Pressable onPress={finish} style={[s.outline, { marginTop: 28 }]}>
        <Text style={s.outlineText}>Start another</Text>
      </Pressable>
    </View>
  )
}
