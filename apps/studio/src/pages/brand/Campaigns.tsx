import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { Button, DataTable, PageHeader, Spinner } from "@klygenixvideo/ui"
import { useHasPermission } from "../../lib/team"
import { ViewOnly } from "../../components/team/ViewOnly"
import { STUDIO } from "../../lib/hooks"
import { when } from "../../lib/format"
import { useBrand, type Campaign } from "../../lib/market"
import { CampaignStatusPill, NeedsBrand } from "../../components/brand/shared"
import { CampaignForm } from "../../components/brand/CampaignForm"
import { inr } from "../../components/earnings/shared"
import { useT } from "../../i18n"

export default function Campaigns() {
  const t = useT()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const canEdit = useHasPermission("video.brand", "full")
  const [creating, setCreating] = useState(false)
  const { data: brand, isLoading: brandLoading } = useBrand()
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["studio-campaigns"],
    queryFn: async () => (await api.get<Campaign[]>(`${STUDIO}/ads/campaigns`)).data,
  })

  if (brandLoading) return <Spinner />

  return (
    <div className="pb-8">
      <PageHeader
        title={t("Ad campaigns")}
        subtitle={t("Video ads before and during long videos. Pay per 1,000 views shown.")}
        actions={brand && canEdit ? <Button onClick={() => setCreating(true)}><Plus size={15} /> {t("New campaign")}</Button> : undefined}
      />
      {brand && !canEdit && <ViewOnly className="mb-4" what={t("Your role can see campaigns and their results but not create, fund or change them.")} />}
      {!brand ? (
        <NeedsBrand what={t("Ad campaigns")} />
      ) : (
        <DataTable
          label={t("Ad campaigns")}
          loading={isLoading}
          rows={rows}
          rowKey={(r) => r.id}
          unitLabel={t("campaigns")}
          emptyTitle={t("No campaigns yet")}
          emptyDescription={t("Create a campaign, add funds and submit it for review.")}
          onRowClick={(r) => navigate(`/brand/campaigns/${r.id}`)}
          columns={[
            {
              key: "name",
              header: t("Campaign"),
              render: (r) => (
                <span className="block min-w-0">
                  <span className="block truncate font-medium text-navy">{r.name}</span>
                  <span className="block truncate text-xs text-slate-500">{r.creative ? r.creative.title : t("No ad video yet")}</span>
                </span>
              ),
            },
            { key: "status", header: t("Status"), render: (r) => <CampaignStatusPill status={r.status} /> },
            { key: "cpm", header: t("Per 1,000 views"), align: "right", render: (r) => <span className="font-num">{inr(r.cpm_minor)}</span> },
            { key: "budget", header: t("Budget"), align: "right", render: (r) => <span className="font-num">{inr(r.budget_minor)}</span> },
            { key: "spent", header: t("Spent"), align: "right", render: (r) => <span className="font-num">{inr(r.spent_minor)}</span> },
            { key: "left", header: t("Left"), align: "right", render: (r) => <span className="font-num font-semibold text-navy">{inr(r.remaining_minor)}</span> },
            { key: "created", header: t("Created"), render: (r) => <span className="text-slate-500">{when(r.created_at)}</span> },
          ]}
        />
      )}
      {creating && (
        <CampaignForm
          campaign={null}
          onClose={() => setCreating(false)}
          onSaved={(c) => {
            qc.invalidateQueries({ queryKey: ["studio-campaigns"] })
            navigate(`/brand/campaigns/${c.id}`)
          }}
        />
      )}
    </div>
  )
}
