import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { api } from "@klygenixvideo/auth"
import { Button, Card, Switch } from "@klygenixvideo/ui"

interface CatalogApp {
  label: string
  groups: { label: string; items: { key: string; label: string }[] }[]
}

/**
 * Gate one, as the global admin sets it. A missing key means enabled, so the editor
 * reads `matrix[key] !== false` — matching the backend's max-permissive default.
 */
export function TenantFeaturesEditor({ tenantId }: { tenantId: number }) {
  const qc = useQueryClient()
  const [matrix, setMatrix] = useState<Record<string, boolean> | null>(null)

  const { data: catalog } = useQuery<Record<string, CatalogApp>>({
    queryKey: ["admin-feature-catalog"],
    queryFn: async () => (await api.get("/api/admin/feature-catalog")).data,
  })
  const { data: saved } = useQuery<Record<string, boolean>>({
    queryKey: ["admin-tenant-features", tenantId],
    queryFn: async () => (await api.get(`/api/admin/tenants/${tenantId}/features`)).data,
  })

  useEffect(() => {
    if (saved && !matrix) setMatrix({ ...saved })
  }, [saved, matrix])

  const save = useMutation({
    mutationFn: async () =>
      (await api.put(`/api/admin/tenants/${tenantId}/features`, { features: matrix })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-tenant-features", tenantId] })
      toast.success("Features saved")
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail ?? "Could not save"),
  })

  if (!catalog || !matrix) return null
  const dirty = JSON.stringify(matrix) !== JSON.stringify(saved)

  return (
    <div className="space-y-4">
      {Object.entries(catalog)
        // The admin console is not tenant-purchasable, so it is not togglable per tenant.
        .filter(([key]) => key !== "admin")
        .map(([key, app]) => (
          <Card key={key} className="p-5">
            <h3 className="text-sm font-semibold text-slate-900">{app.label}</h3>
            {app.groups.map((g) => (
              <div key={g.label} className="mt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{g.label}</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {g.items.map((item) => (
                    <label key={item.key} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2">
                      <span className="text-sm text-slate-700">{item.label}</span>
                      <Switch
                        checked={matrix[item.key] !== false}
                        onChange={(v: boolean) => setMatrix({ ...matrix, [item.key]: v })}
                      />
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </Card>
        ))}
      <Button onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
        {save.isPending ? "Saving…" : "Save features"}
      </Button>
    </div>
  )
}
