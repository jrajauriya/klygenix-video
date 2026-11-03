import { useQuery } from "@tanstack/react-query"
import { api } from "@klygenixvideo/auth"
import { appKey } from "./app"

/**
 * Gate one: "has this customer bought this menu?" — set by the global admin.
 *
 * A missing key means enabled. That is the max-permissive default the backend uses
 * too, so a feature added after a tenant was set up is visible rather than silently
 * dark until someone re-saves their matrix.
 */
export function useTenantFeatures() {
  const app = appKey()
  const { data } = useQuery<Record<string, boolean>>({
    queryKey: [`${app}-tenant-features`],
    queryFn: async () => (await api.get(`/api/${app}/tenant-features`)).data,
    staleTime: 5 * 60_000,
  })
  return data ?? {}
}

export function useHasFeature(key?: string): boolean {
  const features = useTenantFeatures()
  if (!key) return true
  return features[key] !== false
}
