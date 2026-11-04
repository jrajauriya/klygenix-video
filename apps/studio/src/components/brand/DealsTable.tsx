import { useNavigate } from "react-router-dom"
import { DataTable } from "@klygenixvideo/ui"
import { when } from "../../lib/format"
import type { Deal } from "../../lib/market"
import { inr } from "../earnings/shared"
import { DealStatusPill } from "./shared"

export function DealsTable({ rows, loading, role }: { rows: Deal[]; loading: boolean; role: "brand" | "creator" }) {
  const navigate = useNavigate()
  return (
    <DataTable
      label={role === "brand" ? "Deals with creators" : "Deals with brands"}
      loading={loading}
      rows={rows}
      rowKey={(r) => r.id}
      unitLabel="deals"
      emptyTitle="No deals yet"
      emptyDescription={role === "brand" ? "Accept an application on one of your briefs to propose a deal." : "Apply to a brief. When a brand accepts, the deal shows here."}
      onRowClick={(r) => navigate(`/sponsorships/deals/${r.id}`)}
      columns={[
        {
          key: "title",
          header: "Deal",
          render: (r) => (
            <span className="block min-w-0">
              <span className="block truncate font-medium text-navy">{r.title}</span>
              <span className="block truncate text-xs text-slate-500">
                {role === "brand" ? (r.channel ? `${r.channel.name} · @${r.channel.handle}` : "A channel") : r.brand?.name ?? "A brand"}
              </span>
            </span>
          ),
        },
        { key: "price", header: "Price", align: "right", render: (r) => <span className="font-num font-semibold text-navy">{inr(r.price_minor)}</span> },
        { key: "status", header: "Status", render: (r) => <DealStatusPill status={r.status} /> },
        { key: "video", header: "Video", render: (r) => <span className="text-slate-600">{r.video?.title ?? "Not delivered yet"}</span> },
        { key: "created", header: "Started", render: (r) => <span className="text-slate-500">{when(r.created_at)}</span> },
      ]}
    />
  )
}
