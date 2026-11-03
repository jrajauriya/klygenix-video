import { useQuery } from "@tanstack/react-query"
import { DataTable } from "@klygenixvideo/ui"
import { api } from "@klygenixvideo/auth"
import { Status, WEB_URL, when } from "../../lib/shared"
import type { CreatorMoney } from "../../lib/types"
import { ACCOUNT_STATUS, MONEY, inr } from "./shared"

const money = (n: number) => <span className="font-num">{inr(n)}</span>

export function Creators({ onTransfers }: { onTransfers: (tenantId: number) => void }) {
  const { data, isLoading } = useQuery<CreatorMoney[]>({
    queryKey: ["admin-money-creators"],
    queryFn: async () => (await api.get(`${MONEY}/creators`)).data,
  })

  return (
    <DataTable
      label="Creators"
      rows={data ?? []}
      rowKey={(r) => r.tenant_id}
      loading={isLoading}
      unitLabel="creators"
      onRowClick={(r) => onTransfers(r.tenant_id)}
      emptyTitle="No creator has started payout setup"
      note="Click a creator to see their transfers. Ledger owed is what the books say is still due to them, held and reserve included."
      columns={[
        {
          key: "channel",
          header: "Creator",
          sortValue: (r) => r.channel_name ?? r.account.legal_name,
          render: (r) => (
            <div className="min-w-0">
              <p className="font-medium text-navy">{r.channel_name ?? r.account.legal_name}</p>
              <p className="text-xs text-slate-500">
                {r.channel ? (
                  <a href={`${WEB_URL}/@${r.channel}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-brand hover:underline">@{r.channel}</a>
                ) : (
                  `Tenant ${r.tenant_id}`
                )}
                {" · "}{r.account.legal_name}
              </p>
            </div>
          ),
        },
        {
          key: "status",
          header: "Payouts",
          sortValue: (r) => r.account.status,
          render: (r) => (
            <div className="space-y-0.5">
              <Status map={ACCOUNT_STATUS} status={r.account.status} />
              {r.account.requirements.length > 0 && <p className="text-xs text-amber-800">{r.account.requirements.length} to fix</p>}
              {r.account.activated_at && <p className="text-xs text-slate-500">since {when(r.account.activated_at)}</p>}
            </div>
          ),
        },
        { key: "bank", header: "Bank", render: (r) => <span className="font-num text-xs text-slate-600">{r.account.ifsc ?? "—"} · •••• {r.account.account_last4 ?? "—"}</span> },
        { key: "held", header: "Held", align: "right", sortValue: (r) => r.balances.held_minor, render: (r) => money(r.balances.held_minor) },
        { key: "reserve", header: "Reserve", align: "right", sortValue: (r) => r.balances.reserve_minor, render: (r) => money(r.balances.reserve_minor) },
        { key: "pending", header: "Pending", align: "right", sortValue: (r) => r.balances.pending_minor, render: (r) => money(r.balances.pending_minor) },
        { key: "released", header: "Released", align: "right", sortValue: (r) => r.balances.released_minor, render: (r) => money(r.balances.released_minor) },
        {
          key: "owed",
          header: "Owed back",
          align: "right",
          sortValue: (r) => r.balances.owed_back_minor,
          render: (r) => (r.balances.owed_back_minor ? <span className="font-num font-semibold text-red-700">{inr(r.balances.owed_back_minor)}</span> : money(0)),
        },
        { key: "ledger", header: "Ledger owed", align: "right", sortValue: (r) => r.ledger_owed_minor, render: (r) => money(r.ledger_owed_minor) },
      ]}
    />
  )
}
