import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { AlertTriangle, Bot, Coins, Cpu, Gauge } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { Badge, Card, DataTable, PageHeader, ProgressBar, SectionHeading, Select, StatCard } from "@klygenixvideo/ui"
import { formatMoney } from "@klygenixvideo/client"
import { VIDEO_ADMIN, humanise, num } from "../lib/shared"
import type { AiUsage as Usage } from "../lib/types"

const RANGES = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "365", label: "Last year" },
]

const PROVIDER_LABEL: Record<string, string> = {
  video: "Video hosting",
  stt: "Speech to text",
  llm: "Language model",
  embed: "Embeddings",
  scan: "Safety scan",
}

const JOB_TONE: Record<string, "green" | "red" | "amber" | "blue" | "slate"> = {
  done: "green",
  failed: "red",
  queued: "amber",
  running: "blue",
}

export default function AiUsage() {
  const [days, setDays] = useState("30")
  const { data, isLoading } = useQuery<Usage>({
    queryKey: ["admin-video-ai-usage", days],
    queryFn: async () => (await api.get(`${VIDEO_ADMIN}/ai-usage`, { params: { days } })).data,
  })

  const providers = Object.entries(data?.providers ?? {})
  const sandbox = providers.filter(([, p]) => p === "sandbox")
  const jobs = data?.jobs ?? []
  const llm = data?.llm ?? []
  const calls = llm.reduce((a, r) => a + r.count, 0)
  const tokensIn = llm.reduce((a, r) => a + r.input_tokens, 0)
  const tokensOut = llm.reduce((a, r) => a + r.output_tokens, 0)
  const llmCost = llm.reduce((a, r) => a + r.cost_minor, 0)
  const jobCost = jobs.reduce((a, r) => a + r.cost_minor, 0)
  const budget = data?.budget_minor ?? 0
  const inr = (m: number) => formatMoney(m, "INR")

  return (
    <>
      <PageHeader
        title="AI usage and cost"
        subtitle="What the AI pipeline did, and what it cost"
        actions={<Select value={days} onChange={setDays} options={RANGES} aria-label="Range" className="w-44" />}
      />

      {sandbox.length > 0 && (
        <div className="mb-4 flex gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm text-slate-700">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" />
          <p>
            <b>Sandbox providers in use:</b> {sandbox.map(([k]) => PROVIDER_LABEL[k] ?? humanise(k)).join(", ")}. Their output is
            stand-in text and costs nothing — set the real providers before launch.
          </p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="LLM calls" value={data ? num(calls) : "—"} icon={<Bot size={20} />} />
        <StatCard
          label="Tokens in · out"
          value={data ? `${num(tokensIn)} · ${num(tokensOut)}` : "—"}
          icon={<Cpu size={20} />}
          accent="blue"
        />
        <StatCard
          label="Spend"
          value={data ? inr(llmCost + jobCost) : "—"}
          hint={data ? `LLM ${inr(llmCost)} · jobs ${inr(jobCost)}` : undefined}
          icon={<Coins size={20} />}
          accent="green"
        />
        <StatCard label="Monthly LLM budget" value={data ? inr(budget) : "—"} icon={<Gauge size={20} />} accent="navy" />
      </div>

      {data && budget > 0 && (
        <Card className="mt-4 p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">LLM spend against the monthly budget</p>
          <ProgressBar value={llmCost} max={budget} label={`${inr(llmCost)} of ${inr(budget)}`} />
        </Card>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="p-4">
          <SectionHeading>Providers</SectionHeading>
          <ul className="space-y-2">
            {providers.map(([k, p]) => (
              <li key={k} className="flex items-center justify-between text-sm">
                <span className="text-slate-600">{PROVIDER_LABEL[k] ?? humanise(k)}</span>
                <Badge color={p === "sandbox" ? "amber" : "green"}>{p}</Badge>
              </li>
            ))}
          </ul>
        </Card>
        <div className="lg:col-span-2">
          <DataTable
            label="Jobs"
            loading={isLoading}
            rows={jobs}
            rowKey={(r) => `${r.kind}:${r.status}`}
            unitLabel="rows"
            emptyTitle="No AI jobs in this range"
            columns={[
              { key: "kind", header: "Job", render: (r) => humanise(r.kind) },
              { key: "status", header: "Status", render: (r) => <Badge color={JOB_TONE[r.status] ?? "slate"}>{humanise(r.status)}</Badge> },
              { key: "count", header: "Count", align: "right", sortValue: (r) => r.count, render: (r) => <span className="font-num">{num(r.count)}</span> },
              { key: "units", header: "Units", align: "right", sortValue: (r) => r.units, render: (r) => <span className="font-num">{num(r.units)}</span> },
              { key: "cost", header: "Cost", align: "right", sortValue: (r) => r.cost_minor, render: (r) => <span className="font-num">{inr(r.cost_minor)}</span> },
            ]}
          />
        </div>
      </div>

      <div className="mt-6">
        <DataTable
          label="LLM calls"
          loading={isLoading}
          rows={llm}
          rowKey={(r) => `${r.purpose}:${r.status}`}
          unitLabel="rows"
          emptyTitle="No LLM calls in this range"
          emptyDescription="Sandbox providers answer without calling a model, so nothing is logged."
          columns={[
            { key: "purpose", header: "Purpose", render: (r) => humanise(r.purpose) },
            { key: "status", header: "Status", render: (r) => <Badge color={r.status === "ok" ? "green" : "slate"}>{humanise(r.status)}</Badge> },
            { key: "count", header: "Calls", align: "right", render: (r) => <span className="font-num">{num(r.count)}</span> },
            { key: "in", header: "Tokens in", align: "right", render: (r) => <span className="font-num">{num(r.input_tokens)}</span> },
            { key: "out", header: "Tokens out", align: "right", render: (r) => <span className="font-num">{num(r.output_tokens)}</span> },
            { key: "cost", header: "Cost", align: "right", render: (r) => <span className="font-num">{inr(r.cost_minor)}</span> },
          ]}
        />
      </div>
    </>
  )
}
