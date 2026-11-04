import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { FlaskConical } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { Badge, Button, Card, Input, PageHeader, SectionHeading, Spinner, StatCard, useConfirm } from "@klygenixvideo/ui"
import { Note, VIDEO_ADMIN, detail, num, relative, useCanAct, when, type Tone } from "../lib/shared"

interface Metrics {
  auc?: number
  auc_baseline?: number
  ndcg10?: number
  ndcg10_baseline?: number
  n_train?: number
  n_test?: number
  positives?: number
}

interface Model {
  id: number
  version: string
  status: "candidate" | "active" | "retired" | "rejected"
  metrics: Metrics | null
  features: string[]
  weights: number[]
  trained_at: string | null
  promoted_at: string | null
  note: string | null
}

interface Reco {
  enabled: boolean
  ab_percent: number
  impressions: number
  labelled: number
  ctr: Record<string, { shown: number; clicked: number; ctr_bps: number }>
  models: Model[]
}

const KEY = "admin-reco"

const STATUS: Record<string, Tone> = {
  candidate: { label: "Candidate", color: "amber" },
  active: { label: "Active", color: "green" },
  retired: { label: "Retired", color: "slate" },
  rejected: { label: "Rejected", color: "red" },
}

const FEATURE: Record<string, string> = {
  taste: "Taste match",
  channel_watch: "Watched this channel",
  follows: "Follows the channel",
  log_views: "Popularity",
  fresh: "Freshness",
  like_rate: "Like rate",
  lang: "Language match",
  reel: "Is a reel",
  log_minutes: "Length",
  seen: "Already seen",
}

const fmt = (n: number | undefined, digits = 3) => (typeof n === "number" ? n.toFixed(digits) : "—")

function Compare({ label, model, base, hint }: { label: string; model?: number; base?: number; hint: string }) {
  const diff = typeof model === "number" && typeof base === "number" ? model - base : null
  const tone = diff === null ? "text-slate-500" : diff > 0.005 ? "text-green-700" : diff < -0.005 ? "text-red-700" : "text-slate-600"
  return (
    <div className="rounded-lg border border-slate-200 px-3.5 py-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <div className="mt-1 flex items-baseline gap-3">
        <span className="font-num text-lg font-bold text-navy">{fmt(model)}</span>
        <span className="text-xs text-slate-500">heuristic <span className="font-num">{fmt(base)}</span></span>
      </div>
      <p className={`text-xs font-semibold ${tone}`}>
        {diff === null ? "No comparison" : `${diff >= 0 ? "+" : ""}${diff.toFixed(3)} against the heuristic`}
      </p>
      <p className="text-xs text-slate-500">{hint}</p>
    </div>
  )
}

function Weights({ features, weights }: { features: string[]; weights: number[] }) {
  const max = Math.max(...weights.map((w) => Math.abs(w)), 0)
  return (
    <ul className="space-y-1.5">
      {features.map((f, i) => {
        const w = weights[i] ?? 0
        const width = max > 0 ? Math.round((Math.abs(w) / max) * 100) : 0
        return (
          <li key={f} className="grid grid-cols-[9rem_1fr_5.5rem] items-center gap-2 text-sm">
            <span className="truncate text-slate-700" title={f}>{FEATURE[f] ?? f}</span>
            <span className="relative h-3 rounded bg-slate-100" aria-hidden="true">
              <span
                className={`absolute inset-y-0 left-0 rounded ${w >= 0 ? "bg-green-600" : "bg-red-600"}`}
                style={{ width: `${width}%` }}
              />
            </span>
            <span className="text-right font-num text-xs text-slate-600">{w === 0 ? "0" : w.toPrecision(3)}</span>
          </li>
        )
      })}
    </ul>
  )
}

function ModelCard({ m }: { m: Model }) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const canAct = useCanAct("admin.reco")
  const [note, setNote] = useState("")
  const decide = useMutation({
    mutationFn: async (decision: "promote" | "reject") => (await api.post(`${VIDEO_ADMIN}/reco/models/${m.id}/${decision}`, { note: note.trim() })).data,
    onSuccess: (_d, decision) => {
      toast.success(decision === "promote" ? `Model ${m.version} is live` : m.status === "active" ? "Rolled back" : "Model rejected")
      qc.invalidateQueries({ queryKey: [KEY] })
      setNote("")
    },
    onError: (err) => toast.error(detail(err, "That did not work")),
  })

  async function ask(decision: "promote" | "reject") {
    const ok = await confirm(
      decision === "promote"
        ? { title: `Promote model ${m.version}?`, message: "It replaces the active model for the share of viewers in the A/B test.", confirmLabel: "Promote" }
        : m.status === "active"
          ? { title: `Roll back model ${m.version}?`, message: "It is retired and the previous model comes back, or the heuristic if there is none.", confirmLabel: "Roll back", variant: "destructive" }
          : { title: `Reject model ${m.version}?`, confirmLabel: "Reject", variant: "destructive" },
    )
    if (ok) decide.mutate(decision)
  }

  const x = m.metrics ?? {}
  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-num font-bold text-navy">Model {m.version}</h3>
        <Badge color={STATUS[m.status]?.color ?? "slate"}>{STATUS[m.status]?.label ?? m.status}</Badge>
        <span className="text-xs text-slate-500">
          trained {m.trained_at ? relative(m.trained_at) : "—"}{m.promoted_at ? ` · promoted ${when(m.promoted_at, true)}` : ""}
        </span>
      </div>
      {m.note && <p className="text-sm text-slate-600">Note: {m.note}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Compare label="AUC" model={x.auc} base={x.auc_baseline} hint="How often a clicked video ranks above an unclicked one. 0.5 is a coin toss." />
        <Compare label="NDCG@10" model={x.ndcg10} base={x.ndcg10_baseline} hint="How high the clicked videos sit in the top ten." />
      </div>
      <p className="text-xs text-slate-500">
        Trained on <span className="font-num">{num(x.n_train)}</span> impressions, tested on <span className="font-num">{num(x.n_test)}</span>, with{" "}
        <span className="font-num">{num(x.positives)}</span> clicks.
      </p>
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Feature weights (green raises a video, red lowers it)</p>
        <Weights features={m.features} weights={m.weights} />
      </div>
      {canAct && (m.status === "candidate" || m.status === "active" || m.status === "retired") && (
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          <Input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" aria-label={`Note for model ${m.version}`} className="min-w-0 flex-1" />
          {m.status !== "active" && (
            <Button size="sm" onClick={() => ask("promote")} disabled={decide.isPending}>Promote</Button>
          )}
          <Button size="sm" variant="outline" className="text-red-700" onClick={() => ask("reject")} disabled={decide.isPending}>
            {m.status === "active" ? "Roll back" : "Reject"}
          </Button>
        </div>
      )}
    </Card>
  )
}

export default function Recommender() {
  const qc = useQueryClient()
  const canAct = useCanAct("admin.reco")
  const { data, isLoading } = useQuery({
    queryKey: [KEY],
    queryFn: async () => (await api.get<Reco>(`${VIDEO_ADMIN}/reco`)).data,
  })
  const train = useMutation({
    mutationFn: async () => (await api.post<Model>(`${VIDEO_ADMIN}/reco/train`)).data,
    onSuccess: (m) => {
      toast.success(`Trained model ${m.version}. Compare it below before promoting.`)
      qc.invalidateQueries({ queryKey: [KEY] })
    },
    onError: (err) => toast.error(detail(err, "Training failed")),
  })

  if (isLoading || !data) return <Spinner />
  const arms = Object.entries(data.ctr)

  return (
    <>
      <PageHeader
        title="Recommender"
        subtitle="The learned ranking model against the hand-written heuristic"
        actions={canAct ? <Button onClick={() => train.mutate()} disabled={train.isPending}><FlaskConical size={15} /> {train.isPending ? "Training…" : "Train a new model"}</Button> : undefined}
      />
      {!data.enabled && (
        <Note className="mb-4">
          <p>The learned model is switched off (<code>RECO_MODEL</code>), so every viewer gets the heuristic. Models can still be trained and compared.</p>
        </Note>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard size="sm" label="Model" value={data.enabled ? "On" : "Off"} accent={data.enabled ? "green" : "amber"} />
        <StatCard size="sm" label="A/B share on the model" value={`${data.ab_percent}%`} accent="blue" />
        <StatCard size="sm" label="Impressions logged" value={num(data.impressions)} accent="navy" />
        <StatCard size="sm" label="Labelled for training" value={num(data.labelled)} accent="brand" />
      </div>

      <section className="mt-5">
        <SectionHeading>Click-through, last 24 hours</SectionHeading>
        {arms.length === 0 ? (
          <p className="text-sm text-slate-500">No recommendations shown in the last day.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {arms.map(([arm, v]) => (
              <Card key={arm} className="p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{arm === "model" ? "Learned model" : arm === "heuristic" ? "Heuristic" : arm}</p>
                <p className="font-num text-2xl font-bold text-navy">{(v.ctr_bps / 100).toFixed(2)}%</p>
                <p className="text-xs text-slate-500"><span className="font-num">{num(v.clicked)}</span> clicks of <span className="font-num">{num(v.shown)}</span> shown</p>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="mt-5 pb-8">
        <SectionHeading>Models</SectionHeading>
        {data.models.length === 0 ? (
          <p className="text-sm text-slate-500">No models trained yet. Training needs enough labelled impressions.</p>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {data.models.map((m) => <ModelCard key={m.id} m={m} />)}
          </div>
        )}
      </section>
    </>
  )
}
