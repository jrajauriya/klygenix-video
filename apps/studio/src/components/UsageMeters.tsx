import { ProgressBar } from "@klygenixvideo/ui"
import type { Usage } from "../lib/types"
import { useT } from "../i18n"

const CREATOR_METRICS = ["ai_minutes", "renders", "ai_images"]
const LABELS: Record<string, string> = { ai_minutes: "AI minutes", renders: "Clip renders", ai_images: "AI thumbnails" }

export function UsageMeters({ usage }: { usage: Usage[] }) {
  const t = useT()
  const rows = usage.filter((u) => CREATOR_METRICS.includes(u.metric))
  if (!rows.length) return null
  return (
    <div className="space-y-3">
      {rows.map((u) => {
        const limit = u.limit ?? 0
        const full = limit > 0 && u.used >= limit
        return (
          <div key={u.metric}>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
              <span className="font-medium text-slate-700">{LABELS[u.metric] ? t(LABELS[u.metric]) : u.label}</span>
              <span className={full ? "font-num font-semibold text-red-600" : "font-num text-slate-500"}>
                {u.used} / {u.limit ?? "∞"}
              </span>
            </div>
            <ProgressBar value={u.used} max={limit || Math.max(u.used, 1)} size="sm" />
            <p className="mt-0.5 text-xs text-slate-500">{t("This month ({period})", { period: u.period })}</p>
          </div>
        )
      })}
    </div>
  )
}
