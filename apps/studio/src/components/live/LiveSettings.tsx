import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Save } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { Button, Card, Field, Input, Select, Textarea, ToggleField } from "@klygenixvideo/ui"
import { detail, toLocalInput } from "../../lib/format"
import { LIVE_STUDIO, useTierOptions, type LiveStream } from "../../lib/live"

export function LiveSettings({ stream }: { stream: LiveStream }) {
  const qc = useQueryClient()
  const [title, setTitle] = useState(stream.title)
  const [description, setDescription] = useState(stream.description)
  const [slow, setSlow] = useState(String(stream.slow_mode_seconds))
  const [replay, setReplay] = useState(stream.replay_enabled)
  const [rank, setRank] = useState(stream.members_rank ? String(stream.members_rank) : "")
  const [scheduledAt, setScheduledAt] = useState(toLocalInput(stream.scheduled_at))
  const tiers = useTierOptions()
  const scheduled = stream.status === "scheduled"
  const [saving, setSaving] = useState(false)
  const closed = stream.status === "ended" || stream.status === "failed"

  async function save() {
    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        title: title.trim(),
        description,
        slow_mode_seconds: Math.max(0, Math.min(600, Math.round(Number(slow) || 0))),
        replay_enabled: replay,
      }
      const nextRank = rank ? Number(rank) : null
      if (nextRank !== (stream.members_rank ?? null)) body.members_rank = nextRank
      if (scheduled && scheduledAt !== toLocalInput(stream.scheduled_at)) {
        body.scheduled_at = scheduledAt ? new Date(scheduledAt).toISOString() : null
      }
      const { data } = await api.patch<LiveStream>(`${LIVE_STUDIO}/${stream.id}`, body)
      qc.setQueryData(["studio-live", stream.id], data)
      qc.invalidateQueries({ queryKey: ["studio-live"] })
      toast.success("Stream settings saved")
    } catch (err) {
      toast.error(detail(err, "Could not save the settings"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="space-y-4 p-5">
      <h2 className="text-sm font-bold text-navy">Stream settings</h2>
      <Field label="Title" required>
        <Input value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="Description">
        <Textarea rows={3} value={description} maxLength={5000} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Field label="Slow mode (seconds)" hint="0 turns it off. Up to 600.">
        <Input type="number" min={0} max={600} value={slow} onChange={(e) => setSlow(e.target.value)} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Who can watch" hint={stream.status === "live" ? "Changes apply to viewers who join from now on." : undefined}>
          <Select value={rank} onChange={setRank} options={tiers} disabled={closed} aria-label="Who can watch" />
        </Field>
        <Field label="Planned start" hint={scheduled ? "Leave empty for no planned time." : "Only a scheduled stream can be moved."}>
          <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} disabled={!scheduled} />
        </Field>
      </div>
      <ToggleField label="Keep a replay" hint="Saved as a video on your channel when the stream ends." checked={replay} onChange={setReplay} disabled={closed} />
      <div className="flex justify-end">
        <Button onClick={save} disabled={saving || !title.trim()}><Save size={14} /> {saving ? "Saving…" : "Save"}</Button>
      </div>
    </Card>
  )
}
