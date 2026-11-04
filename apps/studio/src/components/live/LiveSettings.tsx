import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Save } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { Button, Card, Field, Input, Select, Textarea, ToggleField } from "@klygenixvideo/ui"
import { detail, toLocalInput } from "../../lib/format"
import { LIVE_STUDIO, useTierOptions, type LiveStream } from "../../lib/live"
import { useHasPermission } from "../../lib/team"
import { useT } from "../../i18n"

export function LiveSettings({ stream }: { stream: LiveStream }) {
  const t = useT()
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
  const canEdit = useHasPermission("video.live", "full")

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
      toast.success(t("Stream settings saved"))
    } catch (err) {
      toast.error(detail(err, t("Could not save the settings")))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="space-y-4 p-5">
      <h2 className="text-sm font-bold text-navy">{t("Stream settings")}</h2>
      <fieldset disabled={!canEdit} className="m-0 min-w-0 space-y-4 border-0 p-0">
      <Field label={t("Title")} required>
        <Input value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label={t("Description")}>
        <Textarea rows={3} value={description} maxLength={5000} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Field label={t("Slow mode (seconds)")} hint={t("0 turns it off. Up to 600.")}>
        <Input type="number" min={0} max={600} value={slow} onChange={(e) => setSlow(e.target.value)} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("Who can watch")} hint={stream.status === "live" ? t("Changes apply to viewers who join from now on.") : undefined}>
          <Select value={rank} onChange={setRank} options={tiers} disabled={closed} aria-label={t("Who can watch")} />
        </Field>
        <Field label={t("Planned start")} hint={scheduled ? t("Leave empty for no planned time.") : t("Only a scheduled stream can be moved.")}>
          <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} disabled={!scheduled} />
        </Field>
      </div>
      <ToggleField label={t("Keep a replay")} hint={t("Saved as a video on your channel when the stream ends.")} checked={replay} onChange={setReplay} disabled={closed} />
      </fieldset>
      {canEdit && (
        <div className="flex justify-end">
          <Button onClick={save} disabled={saving || !title.trim()}><Save size={14} /> {saving ? t("Saving…") : t("Save")}</Button>
        </div>
      )}
    </Card>
  )
}
