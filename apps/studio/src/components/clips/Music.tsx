import { useEffect, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { Pause, Play } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { Button, Select, ToggleField } from "@klygenixvideo/ui"
import { STUDIO } from "../../lib/hooks"
import { clock } from "../../lib/format"
import type { ClipMusic, MusicTrack } from "../../lib/types"

export function Music({ value, onChange, disabled }: { value: ClipMusic | null; onChange: (m: ClipMusic | null) => void; disabled?: boolean }) {
  const { data: tracks } = useQuery({
    queryKey: ["studio-music"],
    queryFn: async () => (await api.get<MusicTrack[]>(`${STUDIO}/music`)).data,
    staleTime: 10 * 60_000,
  })
  const audio = useRef<HTMLAudioElement | null>(null)
  const urls = useRef<Map<number, string>>(new Map())
  const [playing, setPlaying] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const track = tracks?.find((t) => t.id === value?.track_id) ?? null

  useEffect(() => {
    const cache = urls.current
    return () => {
      audio.current?.pause()
      cache.forEach((u) => URL.revokeObjectURL(u))
    }
  }, [])

  async function preview(t: MusicTrack) {
    if (playing === t.id) {
      audio.current?.pause()
      setPlaying(null)
      return
    }
    let url = urls.current.get(t.id)
    if (!url) {
      setLoading(true)
      try {
        const res = await api.get(`${STUDIO}/music/${t.id}.m4a`, { responseType: "blob" })
        url = URL.createObjectURL(res.data as Blob)
        urls.current.set(t.id, url)
      } catch {
        toast.error("Could not load the preview")
        return
      } finally {
        setLoading(false)
      }
    }
    if (!audio.current) {
      audio.current = new Audio()
      audio.current.onended = () => setPlaying(null)
    }
    audio.current.src = url
    audio.current.volume = Math.max(0.05, value?.volume ?? 0.6)
    await audio.current.play().catch(() => undefined)
    setPlaying(t.id)
  }

  const options = [
    { value: "", label: "No music" },
    ...(tracks ?? []).map((t) => ({ value: String(t.id), label: t.title, hint: `${t.artist} · ${t.mood} · ${clock(t.duration_ms)}` })),
  ]

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Select
          value={value ? String(value.track_id) : ""}
          onChange={(v) => onChange(v ? { track_id: Number(v), volume: value?.volume ?? 0.25, duck: value?.duck ?? true } : null)}
          options={options}
          disabled={disabled}
          className="min-w-0 flex-1"
          aria-label="Music track"
        />
        {track && (
          <Button size="sm" variant="outline" disabled={loading} onClick={() => preview(track)}
            aria-label={playing === track.id ? `Stop ${track.title}` : `Play ${track.title}`}>
            {playing === track.id ? <Pause size={13} /> : <Play size={13} />}
            {playing === track.id ? "Stop" : "Play"}
          </Button>
        )}
      </div>
      {value && (
        <>
          <div className="flex items-center gap-3">
            <label htmlFor="music-volume" className="w-14 shrink-0 text-xs text-slate-600">Volume</label>
            <input id="music-volume" type="range" min={0} max={1} step={0.05} value={value.volume} disabled={disabled}
              onChange={(e) => onChange({ ...value, volume: Number(e.target.value) })} className="flex-1 accent-[#A21CAF]" />
            <span className="w-10 text-right font-num text-xs text-slate-600">{Math.round(value.volume * 100)}%</span>
          </div>
          <ToggleField label="Lower the music when someone speaks" hint="Keeps voices clear over the track."
            checked={value.duck} onChange={(duck) => onChange({ ...value, duck })} disabled={disabled} />
        </>
      )}
      {track && (
        <p className="text-xs text-slate-500">
          Licence: {track.licence}
          {track.licence_url ? <> · <a href={track.licence_url} target="_blank" rel="noopener noreferrer" className="text-brand underline">terms</a></> : null}
        </p>
      )}
      <p className="text-xs text-slate-500">Only licensed tracks from the Klygenix Play library can be added, so clips are safe to post anywhere.</p>
    </div>
  )
}
