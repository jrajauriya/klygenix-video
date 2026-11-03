import { Check, CircleAlert, Loader2, ShieldAlert } from "lucide-react"
import { cn } from "@klygenixvideo/ui"
import type { VideoStatus } from "../../lib/types"

type StepState = "done" | "now" | "todo" | "bad" | "held"

const ORDER: VideoStatus[] = ["uploading", "processing", "scanning"]

function finalStep(status: VideoStatus | null): { label: string; state: StepState } {
  if (status === "published") return { label: "Published", state: "done" }
  if (status === "in_review") return { label: "Held for review", state: "held" }
  if (status === "blocked") return { label: "Blocked", state: "bad" }
  if (status === "failed") return { label: "Failed", state: "bad" }
  return { label: "Published", state: "todo" }
}

export function Pipeline({ status, uploading, progress }: { status: VideoStatus | null; uploading: boolean; progress: number }) {
  const at = uploading ? 0 : status ? ORDER.indexOf(status) : -1
  const finished = status !== null && !ORDER.includes(status)
  const steps: { label: string; state: StepState; note?: string }[] = [
    {
      label: "Uploading",
      state: uploading ? "now" : status ? "done" : "todo",
      note: uploading ? `${Math.round(progress * 100)}%` : undefined,
    },
    { label: "Encoding", state: finished || at > 1 ? "done" : at === 1 ? "now" : "todo" },
    { label: "Transcribing & safety check", state: finished ? "done" : at === 2 ? "now" : "todo" },
    finalStep(status),
  ]
  if (status === "failed" && at === -1) steps[1].state = "bad"

  return (
    <ol className="space-y-3">
      {steps.map((s, i) => (
        <li key={i} className="flex items-center gap-3">
          <span
            className={cn(
              "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-bold",
              s.state === "done" && "border-green-600 bg-green-600 text-white",
              s.state === "now" && "border-brand bg-brand-50 text-brand",
              s.state === "todo" && "border-slate-300 text-slate-400",
              s.state === "bad" && "border-red-600 bg-red-600 text-white",
              s.state === "held" && "border-amber-500 bg-amber-500 text-white",
            )}
          >
            {s.state === "done" ? <Check size={15} /> : s.state === "now" ? <Loader2 size={15} className="animate-spin" />
              : s.state === "bad" ? <CircleAlert size={15} /> : s.state === "held" ? <ShieldAlert size={15} /> : i + 1}
          </span>
          <span className={cn("text-sm", s.state === "todo" ? "text-slate-400" : "font-medium text-slate-800")}>{s.label}</span>
          {s.note && <span className="font-num text-xs text-slate-500">{s.note}</span>}
        </li>
      ))}
    </ol>
  )
}
