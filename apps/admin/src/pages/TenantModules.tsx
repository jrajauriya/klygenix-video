import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { api } from "@klygenixvideo/auth"
import { Card, Switch } from "@klygenixvideo/ui"

interface CatalogApp {
  label: string
}

interface Tenant {
  products: string[]
}

/**
 * Gate one: which products this customer has bought. A module off hides the whole app,
 * and gate two — the per-feature matrix on the next tab — only ever narrows what a
 * bought module already allows.
 */
export function TenantModules({ tenantId }: { tenantId: number }) {
  const qc = useQueryClient()

  const { data: catalog } = useQuery<Record<string, CatalogApp>>({
    queryKey: ["admin-feature-catalog"],
    queryFn: async () => (await api.get("/api/admin/feature-catalog")).data,
  })
  const { data: tenant } = useQuery<Tenant>({
    queryKey: ["admin-tenant", String(tenantId)],
    queryFn: async () => (await api.get(`/api/admin/tenants/${tenantId}`)).data,
  })

  const toggle = useMutation({
    mutationFn: async (body: { module_name: string; is_enabled: boolean }) =>
      (await api.post(`/api/admin/tenants/${tenantId}/modules`, body)).data,
    onSuccess: (_d, body) => {
      qc.invalidateQueries({ queryKey: ["admin-tenant", String(tenantId)] })
      qc.invalidateQueries({ queryKey: ["admin-tenants"] })
      toast.success(body.is_enabled ? "Module enabled" : "Module disabled")
    },
    onError: (err: { response?: { data?: { detail?: string } } }) =>
      toast.error(err?.response?.data?.detail ?? "That could not be changed."),
  })

  if (!catalog || !tenant) return null
  const bought = new Set(tenant.products ?? [])

  return (
    <Card className="p-5">
      <h3 className="text-sm font-semibold text-slate-900">Products</h3>
      <p className="mt-0.5 text-xs text-slate-500">
        What this account is licensed for. Turning one off takes the whole app away at
        sign-in, whatever the feature matrix says.
      </p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {Object.entries(catalog).map(([key, app]) => (
          <label
            key={key}
            className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2"
          >
            <span className="text-sm text-slate-700">{app.label}</span>
            <Switch
              checked={bought.has(key)}
              onChange={(v: boolean) =>
                toggle.mutate({ module_name: key, is_enabled: v })
              }
            />
          </label>
        ))}
      </div>
    </Card>
  )
}
