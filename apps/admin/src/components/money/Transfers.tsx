import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { RotateCw, X } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { Button, DataTable, Select } from "@klygenixvideo/ui"
import { Status, detail, humanise, useCanAct, when } from "../../lib/shared"
import type { MoneyTransfer } from "../../lib/types"
import { MONEY, TRANSFER_STATUS, inr } from "./shared"

const FILTERS = [{ value: "", label: "Any status" }, ...Object.entries(TRANSFER_STATUS).map(([value, t]) => ({ value, label: t.label }))]

export function Transfers({ status, tenantId, onFilter }: { status: string; tenantId: string; onFilter: (next: { status?: string; tenant?: string }) => void }) {
  const qc = useQueryClient()
  const canAct = useCanAct("admin.money")
  const { data, isLoading } = useQuery<MoneyTransfer[]>({
    queryKey: ["admin-money-transfers", status, tenantId],
    queryFn: async () => (await api.get(`${MONEY}/transfers`, { params: { status: status || undefined, tenant_id: tenantId || undefined, limit: 500 } })).data,
  })

  const retry = useMutation({
    mutationFn: async (id: number) => (await api.post(`${MONEY}/transfers/${id}/retry`)).data as { transfer: MoneyTransfer },
    onSuccess: (d) => {
      const t = d.transfer
      if (t.error) toast.error(`Transfer #${t.id} still failed: ${t.error}`)
      else toast.success(`Transfer #${t.id} is now ${humanise(t.status).toLowerCase()}`)
      qc.invalidateQueries({ queryKey: ["admin-money-transfers"] })
      qc.invalidateQueries({ queryKey: ["admin-money-summary"] })
    },
    onError: (err) => toast.error(detail(err, "Could not retry the transfer")),
  })

  return (
    <DataTable
      label="Transfers"
      rows={data ?? []}
      rowKey={(t) => t.id}
      loading={isLoading}
      unitLabel="transfers"
      emptyTitle="No transfers match"
      note="The 500 most recent. Each sale makes a sale transfer and a reserve transfer; refunds after release make a recovery."
      toolbarRight={
        <>
          {tenantId && (
            <Button size="sm" variant="outline" onClick={() => onFilter({ tenant: "" })}>
              Tenant {tenantId} <X size={13} aria-hidden="true" />
            </Button>
          )}
          <Select value={status} onChange={(v) => onFilter({ status: v })} options={FILTERS} className="w-40" aria-label="Status" />
        </>
      }
      columns={[
        { key: "id", header: "#", sortKey: "id", render: (t) => <span className="font-num text-slate-500">{t.id}</span> },
        { key: "tenant", header: "Tenant", sortKey: "tenant_id", render: (t) => <span className="font-num">{t.tenant_id}</span> },
        { key: "kind", header: "Kind", render: (t) => humanise(t.kind) },
        { key: "status", header: "Status", render: (t) => <Status map={TRANSFER_STATUS} status={t.status} /> },
        { key: "amount", header: "Amount", align: "right", sortKey: "amount_minor", render: (t) => <span className="font-num">{inr(t.amount_minor)}</span> },
        { key: "open", header: "Open", align: "right", sortKey: "open_minor", render: (t) => <span className="font-num">{inr(t.open_minor)}</span> },
        {
          key: "when",
          header: "Release",
          render: (t) => (t.released_at ? `Released ${when(t.released_at)}` : t.hold_until && t.status === "held" ? `Due ${when(t.hold_until)}` : "—"),
        },
        {
          key: "error",
          header: "Error",
          render: (t) => <span className="block max-w-[16rem] truncate text-xs text-red-700" title={t.error ?? undefined}>{t.error ?? ""}</span>,
        },
        {
          key: "act",
          header: "",
          srHeader: "Actions",
          render: (t) =>
            canAct && t.status === "pending" && t.error && t.split_id ? (
              <Button size="sm" variant="outline" disabled={retry.isPending} onClick={(e) => { e.stopPropagation(); retry.mutate(t.id) }} aria-label={`Retry transfer ${t.id}`}>
                <RotateCw size={13} /> Retry
              </Button>
            ) : null,
        },
      ]}
    />
  )
}
