import { useNavigate } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { Building2 } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { Badge, Button, DataTable, PageHeader } from "@klygenixvideo/ui"
import type { Tenant } from "@klygenixvideo/types"

export default function Tenants() {
  const navigate = useNavigate()
  const { data: tenants = [], isLoading } = useQuery<Tenant[]>({
    queryKey: ["admin-tenants"],
    queryFn: async () => (await api.get("/api/admin/tenants")).data,
  })

  return (
    <>
      <PageHeader
        title="Accounts"
        subtitle="Every creator, viewer and team account on Klygenix Play"
        actions={
          <Button onClick={() => navigate("/tenants/new")}>
            <Building2 size={16} /> Open an account
          </Button>
        }
      />
      <DataTable
        loading={isLoading}
        rows={tenants}
        // A row is edited by clicking it.
        onRowClick={(t: Tenant) => navigate(`/tenants/${t.id}`)}
        columns={[
          { key: "name", header: "Account", render: (t: Tenant) => <b>{t.name}</b> },
          { key: "slug", header: "Slug", render: (t: Tenant) => t.slug },
          { key: "plan", header: "Plan", render: (t: Tenant) => t.plan },
          { key: "license_end", header: "Licence to", render: (t: Tenant) => t.license_end },
          {
            key: "is_active",
            header: "Status",
            render: (t: Tenant) =>
              t.is_active ? <Badge color="green">Active</Badge> : <Badge color="slate">Inactive</Badge>,
          },
        ]}
      />
    </>
  )
}
