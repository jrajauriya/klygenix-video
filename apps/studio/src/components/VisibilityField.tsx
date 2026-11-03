import { CalendarClock, Globe, Link2, Lock } from "lucide-react"
import { Input, cn } from "@klygenixvideo/ui"
import type { Visibility } from "../lib/types"

const CHOICES: { value: Visibility; label: string; hint: string; icon: typeof Globe }[] = [
  { value: "public", label: "Public", hint: "Anyone can find and watch it", icon: Globe },
  { value: "unlisted", label: "Unlisted", hint: "Only people with the link", icon: Link2 },
  { value: "private", label: "Private", hint: "Only you", icon: Lock },
  { value: "scheduled", label: "Schedule", hint: "Goes public at a time you pick", icon: CalendarClock },
]

export function VisibilityField({
  schedule = true,
  value,
  publishAt,
  onChange,
  onPublishAt,
}: {
  schedule?: boolean
  value: Visibility
  publishAt: string
  onChange: (v: Visibility) => void
  onPublishAt: (local: string) => void
}) {
  return (
    <div className="space-y-2">
      <div className={cn("grid gap-2", schedule ? "grid-cols-2" : "grid-cols-3")}>
        {CHOICES.filter((c) => schedule || c.value !== "scheduled").map((c) => {
          const Icon = c.icon
          const on = value === c.value
          return (
            <button
              key={c.value}
              type="button"
              onClick={() => onChange(c.value)}
              aria-pressed={on}
              className={cn(
                "flex items-start gap-2 rounded-lg border p-2.5 text-left",
                on ? "border-brand bg-brand-50" : "border-slate-200 hover:border-slate-300",
              )}
            >
              <Icon size={16} className={on ? "mt-0.5 text-brand" : "mt-0.5 text-slate-500"} />
              <span>
                <span className="block text-sm font-semibold text-slate-800">{c.label}</span>
                <span className="block text-xs text-slate-500">{c.hint}</span>
              </span>
            </button>
          )
        })}
      </div>
      {value === "scheduled" && (
        <Input type="datetime-local" value={publishAt} onChange={(e) => onPublishAt(e.target.value)} aria-label="Publish at" />
      )}
    </div>
  )
}
