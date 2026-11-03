import { useQueries } from "@tanstack/react-query"
import { api } from "@klygenixvideo/auth"
import { Badge, DataTable, PageHeader } from "@klygenixvideo/ui"
import { formatMoney } from "@klygenixvideo/client"
import { Note, humanise } from "../lib/shared"
import type { Plan } from "../lib/types"

type Row = Plan & { usd?: Plan }

function limitText(v: number | boolean): string {
  if (typeof v === "boolean") return v ? "Yes" : "No"
  return v.toLocaleString("en-IN")
}

export default function Plans() {
  const [inQ, usQ] = useQueries({
    queries: ["IN", "US"].map((country) => ({
      queryKey: ["admin-video-plans", country],
      queryFn: async () => (await api.get<Plan[]>("/api/video/plans", { params: { country } })).data,
    })),
  })

  const us = new Map((usQ.data ?? []).map((p) => [p.key, p]))
  const rows: Row[] = (inQ.data ?? []).map((p) => ({ ...p, usd: us.get(p.key) }))

  return (
    <>
      <PageHeader title="Plans" subtitle="What viewers and creators can subscribe to" />
      <Note className="mb-4">
        <p>Plans are read-only here. Prices and limits live in the plan catalogue on the server; this shows what India and the rest of the world are charged.</p>
      </Note>
      <DataTable
        label="Plans"
        loading={inQ.isLoading || usQ.isLoading}
        rows={rows}
        rowKey={(r) => r.key}
        unitLabel="plans"
        columns={[
          {
            key: "name",
            header: "Plan",
            render: (r) => (
              <div className="min-w-0">
                <p className="font-medium text-navy">{r.name}</p>
                <p className="max-w-sm truncate text-xs text-slate-500">{r.description}</p>
              </div>
            ),
          },
          { key: "audience", header: "For", render: (r) => <Badge color={r.audience === "creator" ? "purple" : "blue"}>{humanise(r.audience)}</Badge> },
          {
            key: "in",
            header: "India",
            align: "right",
            render: (r) => <span className="font-num">{r.free ? "Free" : `${formatMoney(r.price_minor, r.currency)}/mo`}</span>,
          },
          {
            key: "us",
            header: "Elsewhere",
            align: "right",
            render: (r) =>
              r.free ? (
                <span className="font-num">Free</span>
              ) : (
                <span className="font-num">
                  {r.usd ? formatMoney(r.usd.price_minor, r.usd.currency) : formatMoney(r.price_usd_minor, "USD")}/mo
                </span>
              ),
          },
          {
            key: "limits",
            header: "Limits",
            render: (r) => (
              <div className="flex flex-wrap gap-1">
                {Object.entries(r.limits).map(([k, v]) => (
                  <Badge key={k} color="slate">
                    {humanise(k)}: {limitText(v)}
                  </Badge>
                ))}
              </div>
            ),
          },
        ]}
      />
    </>
  )
}
