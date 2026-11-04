import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { ShieldCheck } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { Badge, Button, Card, Field, Modal, PageHeader, Spinner, Textarea } from "@klygenixvideo/ui"
import { detail, when } from "../lib/format"
import type { ModerationAction, Strike } from "../lib/types"
import { Notices } from "../components/Notices"
import { useT } from "../i18n"

const APPEALABLE = ["remove", "restrict", "suspend"]

const ACTION_LABEL: Record<string, string> = {
  remove: "Removed",
  restrict: "Restricted",
  suspend: "Channel suspended",
  warn: "Warning",
  restore: "Restored",
  approve: "Approved",
  unsuspend: "Suspension lifted",
}

const TARGET_LABEL: Record<string, string> = { video: "Video", comment: "Comment", danmaku: "Danmaku", channel: "Channel" }

const APPEAL_LABEL: Record<string, { label: string; color: "amber" | "green" | "red" }> = {
  open: { label: "Appeal under review", color: "amber" },
  upheld: { label: "Appeal refused", color: "red" },
  overturned: { label: "Appeal granted", color: "green" },
}

export default function Moderation() {
  const t = useT()
  const { data, isLoading } = useQuery({
    queryKey: ["video-moderation"],
    queryFn: async () => (await api.get<{ actions: ModerationAction[]; strikes: Strike[] }>("/api/video/me/moderation")).data,
  })
  const [appealing, setAppealing] = useState<ModerationAction | null>(null)

  if (isLoading || !data) return <Spinner />
  const activeStrikes = data.strikes.filter((s) => !s.lifted && (!s.expires_at || new Date(s.expires_at) > new Date()))

  return (
    <div className="pb-8">
      <PageHeader title={t("Moderation notices")} subtitle={t("Actions our trust and safety team has taken on your content, and your strikes.")} />

      {data.actions.length === 0 && data.strikes.length === 0 ? (
        <Card className="flex items-center gap-3 p-5">
          <ShieldCheck size={22} className="text-green-600" />
          <div>
            <p className="font-semibold text-navy">{t("All clear")}</p>
            <p className="text-sm text-slate-500">{t("Nothing on your channel has been actioned. Keep it that way by uploading only what you own or have licensed.")}</p>
          </div>
        </Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-3">
          <Card className="p-0 lg:col-span-2">
            <div className="border-b border-slate-100 px-5 py-3">
              <h2 className="text-sm font-bold text-navy">{t("Actions")}</h2>
            </div>
            {data.actions.length === 0 ? (
              <p className="px-5 py-6 text-sm text-slate-500">{t("No actions.")}</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {data.actions.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-start gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-800">
                        {ACTION_LABEL[a.action] ? t(ACTION_LABEL[a.action]) : a.action} · {TARGET_LABEL[a.target_type] ? t(TARGET_LABEL[a.target_type]) : a.target_type} {String(a.target_id)}
                      </p>
                      <p className="mt-0.5 text-sm text-slate-600">{a.reason || t("No reason given")}</p>
                      <p className="mt-0.5 text-xs text-slate-400">{when(a.created_at, true)}</p>
                      {a.appeal?.note && <p className="mt-1 rounded bg-slate-50 px-2 py-1 text-xs text-slate-600">{t("Decision: {note}", { note: a.appeal.note })}</p>}
                    </div>
                    {a.appeal ? (
                      <Badge color={APPEAL_LABEL[a.appeal.status]?.color ?? "slate"}>{APPEAL_LABEL[a.appeal.status] ? t(APPEAL_LABEL[a.appeal.status].label) : t("Appeal {status}", { status: a.appeal.status })}</Badge>
                    ) : APPEALABLE.includes(a.action) ? (
                      <Button size="sm" variant="outline" onClick={() => setAppealing(a)}>{t("Appeal")}</Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="h-fit p-5">
            <h2 className="text-sm font-bold text-navy">{t("Strikes")}</h2>
            <p className="mt-1 text-sm text-slate-500">
              {activeStrikes.length === 0 ? t("No active strikes.") : t("{n} active. Three active strikes suspend the channel.", { n: activeStrikes.length })}
            </p>
            {data.strikes.length > 0 && (
              <ul className="mt-3 space-y-2">
                {data.strikes.map((s) => {
                  const live = !s.lifted && (!s.expires_at || new Date(s.expires_at) > new Date())
                  return (
                    <li key={s.id} className="rounded-lg border border-slate-200 px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-slate-800">{s.reason}</span>
                        <Badge color={live ? "red" : "slate"}>{s.lifted ? t("Lifted") : live ? t("Active") : t("Expired")}</Badge>
                      </div>
                      {s.expires_at && <p className="mt-0.5 text-xs text-slate-500">{live ? t("Expires {date}", { date: when(s.expires_at) }) : t("Expired {date}", { date: when(s.expires_at) })}</p>}
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>
        </div>
      )}

      <Notices />

      {appealing && <AppealModal action={appealing} onClose={() => setAppealing(null)} />}
    </div>
  )
}

function AppealModal({ action, onClose }: { action: ModerationAction; onClose: () => void }) {
  const t = useT()
  const qc = useQueryClient()
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)

  async function send() {
    setBusy(true)
    try {
      await api.post("/api/video/appeals", { action_id: action.id, text: text.trim() })
      toast.success(t("Appeal sent. A person reviews it, usually within 72 hours."))
      qc.invalidateQueries({ queryKey: ["video-moderation"] })
      onClose()
    } catch (err) {
      toast.error(detail(err, t("Could not send the appeal")))
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t("Appeal this decision")}
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>{t("Cancel")}</Button>
          <Button onClick={send} disabled={busy || text.trim().length < 10}>{busy ? t("Sending…") : t("Send appeal")}</Button>
        </div>
      }
    >
      <p className="mb-3 text-sm text-slate-600">
        {ACTION_LABEL[action.action] ? t(ACTION_LABEL[action.action]) : action.action} · {action.reason}
      </p>
      <Field label={t("Why should this be reversed?")} hint={t("At least 10 characters. Include licences or permissions if it is about rights.")}>
        <Textarea rows={5} value={text} maxLength={3000} onChange={(e) => setText(e.target.value)} />
      </Field>
    </Modal>
  )
}
