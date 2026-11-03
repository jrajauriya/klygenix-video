import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { AlertTriangle, CheckCircle2, OctagonX, RotateCw, ShieldCheck, Wrench } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { Badge, Button, Card, PageHeader, StatCard } from "@klygenixvideo/ui"
import type { ReadinessCheck, ReadinessReport, ReadinessSeverity } from "@klygenixvideo/types"
import { Note, detail, when } from "../lib/shared"

const READINESS_KEY = "admin-readiness"

const SECTIONS: { severity: ReadinessSeverity; title: string; hint: string }[] = [
  { severity: "block", title: "Blocking", hint: "Every one of these must pass before Klygenix Play takes real money." },
  { severity: "warn", title: "Warnings", hint: "Launch is allowed with these open — know why each one is." },
]

function StatusIcon({ check }: { check: ReadinessCheck }) {
  if (check.ok) return <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-green-600" />
  if (check.severity === "block") return <OctagonX size={18} className="mt-0.5 shrink-0 text-red-600" />
  return <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600" />
}

function CheckRow({ check }: { check: ReadinessCheck }) {
  return (
    <li className="flex gap-3 px-4 py-3">
      <StatusIcon check={check} />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold text-navy">{check.title}</p>
          <Badge color="slate">{check.group}</Badge>
          <span className="font-num text-xs text-slate-400">{check.key}</span>
        </div>
        <p className="break-words text-sm text-slate-600">{check.detail}</p>
        {!check.ok && check.fix && (
          <p className="flex gap-2 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">
            <Wrench size={14} className="mt-0.5 shrink-0 text-slate-400" />
            <span className="min-w-0 break-words">{check.fix}</span>
          </p>
        )}
      </div>
      <div className="shrink-0">
        {check.ok ? <Badge color="green">Passing</Badge> : check.severity === "block" ? <Badge color="red">Failing</Badge> : <Badge color="amber">Warning</Badge>}
      </div>
    </li>
  )
}

export default function Readiness() {
  const [showPassing, setShowPassing] = useState(false)
  const { data, isLoading, isFetching, error, refetch } = useQuery<ReadinessReport>({
    queryKey: [READINESS_KEY],
    queryFn: async () => (await api.get("/api/admin/readiness")).data,
    staleTime: 0,
  })

  const checks = data?.checks ?? []
  const passing = checks.filter((c) => c.ok).length

  return (
    <>
      <PageHeader
        title="Launch readiness"
        subtitle="Whether this server's configuration is fit to take real money"
        actions={
          <>
            {data && <span className="hidden text-xs text-slate-500 sm:inline">Checked {when(data.checked_at, true)}</span>}
            <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
              <RotateCw size={15} className={isFetching ? "animate-spin" : undefined} /> Recheck
            </Button>
          </>
        }
      />

      {error ? (
        <p className="rounded-lg bg-red-50 px-3.5 py-2.5 text-sm text-red-700">{detail(error, "Could not run the readiness checks")}</p>
      ) : isLoading || !data ? (
        <p className="text-sm text-slate-500">Running the checks…</p>
      ) : (
        <div className="space-y-4">
          {data.ready ? (
            <div className="flex items-start gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-green-800">
              <ShieldCheck size={20} className="mt-0.5 shrink-0" />
              <div>
                <p className="font-bold">This environment is ready for production</p>
                <p className="text-sm">
                  Every blocking check passes.{" "}
                  {data.warnings ? `${data.warnings} warning${data.warnings === 1 ? "" : "s"} still open — read them before launch.` : "No warnings."}
                </p>
              </div>
            </div>
          ) : (
            <div role="alert" className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-800">
              <OctagonX size={20} className="mt-0.5 shrink-0" />
              <div>
                <p className="font-bold">This environment is not ready for production</p>
                <p className="text-sm">
                  {data.blocking_failed} blocking check{data.blocking_failed === 1 ? "" : "s"} failing. Fix each one, restart the API so it
                  reads the new settings, then recheck.
                </p>
              </div>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Blocking failures" value={String(data.blocking_failed)} accent={data.blocking_failed ? "red" : "green"} icon={<OctagonX size={18} />} />
            <StatCard label="Warnings" value={String(data.warnings)} accent={data.warnings ? "amber" : "green"} icon={<AlertTriangle size={18} />} />
            <StatCard label="Passing" value={`${passing} of ${checks.length}`} accent="green" icon={<CheckCircle2 size={18} />} />
          </div>

          <label className="flex w-fit cursor-pointer items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={showPassing} onChange={(e) => setShowPassing(e.target.checked)} className="h-4 w-4 accent-brand" />
            Show passing checks
          </label>

          {SECTIONS.map((s) => {
            const all = checks.filter((c) => c.severity === s.severity)
            const failing = all.filter((c) => !c.ok)
            const rows = showPassing ? [...failing, ...all.filter((c) => c.ok)] : failing
            return (
              <Card key={s.severity} className="overflow-hidden p-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-200 px-4 py-3">
                  <div>
                    <h2 className="text-sm font-bold text-navy">{s.title}</h2>
                    <p className="text-xs text-slate-500">{s.hint}</p>
                  </div>
                  <span className="font-num text-xs text-slate-500">
                    {all.length - failing.length} of {all.length} passing
                  </span>
                </div>
                {rows.length ? (
                  <ul className="divide-y divide-slate-100">
                    {rows.map((c) => (
                      <CheckRow key={c.key} check={c} />
                    ))}
                  </ul>
                ) : (
                  <p className="px-4 py-4 text-sm text-slate-500">
                    {failing.length ? "" : s.severity === "block" ? "Every blocking check passes." : "No warnings."}
                  </p>
                )}
              </Card>
            )
          })}

          <Note>
            <p>
              These are the settings of the API answering this page, plus what its database holds. The same configuration checks run
              before a deploy with <code className="font-num text-xs">python -m app.readiness --env-file .env.prod</code>; the launch
              runbook is <code className="font-num text-xs">docs/LAUNCH.md</code>.
            </p>
          </Note>
        </div>
      )}
    </>
  )
}
