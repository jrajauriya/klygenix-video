import { useQuery } from "@tanstack/react-query"
import { api } from "@klygenixvideo/auth"
import { appKey } from "./app"

export type Level = "none" | "view" | "full"

const RANK: Record<Level, number> = { none: 0, view: 1, full: 2 }

/** Gate two: "can my role access it?" — set by the tenant owner. */
export function usePermissions() {
  const app = appKey()
  const { data } = useQuery<Record<string, Level>>({
    queryKey: [`${app}-permissions`],
    queryFn: async () => (await api.get(`/api/${app}/permissions`)).data,
    staleTime: 5 * 60_000,
  })
  return data ?? {}
}

export function useHasPermission(key?: string, level: Level = "view"): boolean {
  const perms = usePermissions()
  if (!key) return true
  return RANK[perms[key] ?? "none"] >= RANK[level]
}
