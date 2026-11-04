import { useState } from "react"
import { toast } from "sonner"
import { api } from "@klygenixvideo/auth"
import { Sheet } from "./Sheet"
import { Btn, TEXTAREA } from "./bits"
import { errStatus, errText } from "../lib/api"
import { useT } from "../i18n"

export const REPORT_REASONS: { key: string; label: string }[] = [
  { key: "spam", label: "Spam or misleading" },
  { key: "sexual", label: "Sexual content" },
  { key: "violence", label: "Violent or graphic content" },
  { key: "hate", label: "Hateful or abusive content" },
  { key: "harassment", label: "Harassment or bullying" },
  { key: "self_harm", label: "Self-harm or suicide" },
  { key: "child_safety", label: "Child safety" },
  { key: "copyright", label: "Copyright infringement" },
  { key: "misinformation", label: "Misinformation" },
  { key: "scam", label: "Scam or fraud" },
  { key: "impersonation", label: "Impersonation" },
  { key: "other", label: "Something else" },
]

export type ReportTarget = { type: "video" | "comment" | "danmaku" | "channel" | "live" | "live_message"; id: string | number; label?: string }

export function ReportDialog({ target, onClose }: { target: ReportTarget | null; onClose: () => void }) {
  const t = useT("watchx", target !== null)
  const notice = t("Child-safety reports are reviewed first. For copyright, you can also file a formal notice on the {link}.").split("{link}")
  const [reason, setReason] = useState("")
  const [details, setDetails] = useState("")
  const [pending, setPending] = useState(false)

  function close() {
    setReason("")
    setDetails("")
    onClose()
  }

  async function submit() {
    if (!target || !reason) return
    setPending(true)
    try {
      await api.post("/api/video/reports", { target_type: target.type, target_id: String(target.id), reason, details: details.trim() })
      toast.success(t("Thanks. Our team will review this report."))
      close()
    } catch (err) {
      if (errStatus(err) === 409) {
        toast.message(t("You have already reported this."))
        close()
      } else toast.error(errText(err, t("The report could not be sent.")))
    } finally {
      setPending(false)
    }
  }

  return (
    <Sheet
      open={target !== null}
      onClose={close}
      title={t(`Report ${target?.label ?? target?.type ?? ""}`.trim())}
      footer={
        <>
          <Btn tone="ghost" onClick={close}>{t("Cancel")}</Btn>
          <Btn tone="brand" disabled={!reason || pending} onClick={submit}>{pending ? t("Sending…") : t("Send report")}</Btn>
        </>
      }
    >
      <fieldset className="space-y-1">
        <legend className="mb-2 text-sm text-muted">{t("What is wrong with it?")}</legend>
        {REPORT_REASONS.map((r) => (
          <label key={r.key} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-white/5">
            <input type="radio" name="reason" value={r.key} checked={reason === r.key} onChange={() => setReason(r.key)} className="h-4 w-4 accent-[#A21CAF]" />
            <span className="text-sm">{t(r.label)}</span>
          </label>
        ))}
      </fieldset>
      <label className="mt-3 block space-y-1.5">
        <span className="text-sm text-muted">{t("Anything else we should know? (optional)")}</span>
        <textarea className={TEXTAREA} rows={3} maxLength={1000} value={details} onChange={(e) => setDetails(e.target.value)} />
      </label>
      <p className="mt-3 text-xs text-faint">
        {notice[0]}<a href="/legal/copyright" className="text-brand-soft hover:underline">{t("copyright page")}</a>{notice[1]}
      </p>
    </Sheet>
  )
}
