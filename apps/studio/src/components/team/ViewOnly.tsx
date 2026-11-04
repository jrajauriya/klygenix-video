import { Eye } from "lucide-react"
import { cn } from "@klygenixvideo/ui"
import { useT } from "../../i18n"

export function ViewOnly({ what, className }: { what?: string; className?: string }) {
  const t = useT()
  return (
    <p role="note" className={cn("flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700", className)}>
      <Eye size={15} className="mt-0.5 shrink-0 text-slate-500" aria-hidden="true" />
      <span>
        <span className="font-semibold">{t("View only.")}</span> {what ?? t("Your role on this channel can see this but not change it.")}
      </span>
    </p>
  )
}
