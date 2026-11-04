import { Link } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { CheckCircle2, Circle } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { Card, ProgressBar } from "@klygenixvideo/ui"
import { STUDIO } from "../lib/hooks"

interface Step {
  key: string
  label: string
  done: boolean
  href: string
  optional?: boolean
}

interface Onboarding {
  steps: Step[]
  done: number
  total: number
  complete: boolean
}

const HREF: Record<string, string> = { "/videos/new": "/videos?upload=1" }

export function OnboardingChecklist() {
  const { data } = useQuery({
    queryKey: ["studio-onboarding"],
    queryFn: async () => (await api.get<Onboarding>(`${STUDIO}/onboarding`)).data,
    staleTime: 30_000,
  })
  if (!data || data.complete) return null
  const needed = data.steps.filter((s) => !s.optional)
  const extra = data.steps.filter((s) => s.optional)

  const item = (s: Step) => (
    <li key={s.key}>
      <Link
        to={HREF[s.href] ?? s.href}
        className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50"
      >
        {s.done ? (
          <CheckCircle2 size={17} className="shrink-0 text-green-700" aria-hidden="true" />
        ) : (
          <Circle size={17} className="shrink-0 text-slate-400" aria-hidden="true" />
        )}
        <span className={s.done ? "text-slate-500 line-through" : "font-medium text-slate-800"}>{s.label}</span>
        <span className="sr-only">{s.done ? "(done)" : "(to do)"}</span>
      </Link>
    </li>
  )

  return (
    <Card className="p-5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-navy">Get your channel ready</h2>
        <span className="font-num text-xs font-semibold text-slate-500">{data.done} of {data.total}</span>
      </div>
      <ProgressBar value={data.done} max={data.total} showLabel={false} size="sm" />
      <ul className="mt-3 space-y-0.5">{needed.map(item)}</ul>
      {extra.length > 0 && (
        <>
          <p className="mt-3 px-2 text-xs font-semibold uppercase tracking-wide text-slate-500">When you are ready</p>
          <ul className="mt-1 space-y-0.5">{extra.map(item)}</ul>
        </>
      )}
    </Card>
  )
}
