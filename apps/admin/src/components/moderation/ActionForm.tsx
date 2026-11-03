import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"
import { api } from "@klygenixvideo/auth"
import { Button, Field, Select, Textarea, useConfirm } from "@klygenixvideo/ui"
import { VIDEO_ADMIN, detail } from "../../lib/shared"
import type { TargetType } from "../../lib/types"

const OPTIONS: Record<TargetType, { value: string; label: string; hint: string }[]> = {
  video: [
    { value: "approve", label: "Approve", hint: "Clear the reports and publish if held" },
    { value: "remove", label: "Remove", hint: "Take the video down" },
    { value: "restrict", label: "Restrict", hint: "Keep it up, out of feeds and search" },
    { value: "restore", label: "Restore", hint: "Undo an earlier removal" },
    { value: "warn", label: "Warn the creator", hint: "Leave it up and notify" },
  ],
  comment: [
    { value: "approve", label: "Approve", hint: "Clear the reports" },
    { value: "remove", label: "Remove", hint: "Hide the comment" },
    { value: "restore", label: "Restore", hint: "Show it again" },
    { value: "warn", label: "Warn the author", hint: "Leave it up and notify" },
  ],
  danmaku: [
    { value: "approve", label: "Approve", hint: "Clear the reports" },
    { value: "remove", label: "Remove", hint: "Hide the danmaku" },
    { value: "restore", label: "Restore", hint: "Show it again" },
    { value: "warn", label: "Warn the author", hint: "Leave it up and notify" },
  ],
  channel: [
    { value: "warn", label: "Warn", hint: "Notify the channel" },
    { value: "suspend", label: "Suspend", hint: "Stop the channel publishing" },
    { value: "unsuspend", label: "Lift suspension", hint: "Let it publish again" },
    { value: "approve", label: "Approve", hint: "Clear the reports" },
  ],
}

const HARSH = new Set(["remove", "suspend", "restrict"])

export function ActionForm({
  targetType,
  targetId,
  onDone,
}: {
  targetType: TargetType
  targetId: number
  onDone: () => void
}) {
  const confirm = useConfirm()
  const options = OPTIONS[targetType]
  const [action, setAction] = useState(options[0].value)
  const [reason, setReason] = useState("")
  const [strike, setStrike] = useState(false)

  const act = useMutation({
    mutationFn: async () =>
      (await api.post(`${VIDEO_ADMIN}/actions`, {
        target_type: targetType,
        target_id: targetId,
        action,
        reason: reason.trim(),
        strike,
      })).data,
    onSuccess: () => {
      toast.success("Action recorded")
      setReason("")
      setStrike(false)
      onDone()
    },
    onError: (err) => toast.error(detail(err, "That action could not be taken.")),
  })

  const chosen = options.find((o) => o.value === action)
  const tooShort = reason.trim().length < 3

  async function submit() {
    if (HARSH.has(action)) {
      const ok = await confirm({
        title: `${chosen?.label ?? action}?`,
        message: strike
          ? "The creator is told why, and a strike is added to their channel. They can appeal."
          : "The creator is told why and can appeal.",
        confirmLabel: chosen?.label ?? "Confirm",
        variant: "destructive",
      })
      if (!ok) return
    }
    act.mutate()
  }

  return (
    <div className="space-y-3">
      <Field label="Action" hint={chosen?.hint}>
        <Select
          value={action}
          onChange={setAction}
          options={options.map((o) => ({ value: o.value, label: o.label }))}
          aria-label="Action"
        />
      </Field>
      <Field label="Reason" required hint="Shown to the creator. At least three characters.">
        <Textarea
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why this decision was taken"
        />
      </Field>
      {targetType !== "channel" || action === "warn" || action === "suspend" ? (
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={strike}
            onChange={(e) => setStrike(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 accent-brand"
          />
          Add a strike to the channel
        </label>
      ) : null}
      <Button onClick={submit} disabled={tooShort || act.isPending}>
        {act.isPending ? "Working…" : chosen?.label ?? "Apply"}
      </Button>
    </div>
  )
}
