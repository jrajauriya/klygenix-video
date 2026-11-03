import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@klygenixvideo/auth"
import { toast } from "sonner"

/**
 * The house data layer. Every screen in every app reads and writes through these
 * four hooks — the alternative is each app hand-rolling useQuery, which is how the
 * master estate ended up with four subtly different error-toast behaviours.
 */

export function useList<T>(key: string, path: string, params?: Record<string, unknown>) {
  return useQuery<T[]>({
    queryKey: [key, params ?? {}],
    queryFn: async () => {
      const qs = new URLSearchParams()
      for (const [k, v] of Object.entries(params ?? {})) {
        // "all" is the sentinel every filter dropdown uses for "no filter".
        if (v !== undefined && v !== null && v !== "" && v !== "all") qs.set(k, String(v))
      }
      return (await api.get(`${path}?${qs}`)).data
    },
  })
}

/**
 * A list that admits what it is not showing. `useList` hands back rows and nothing else,
 * so a server-side cap is invisible: a merchant past the limit simply never sees the
 * tail. This reads `X-Total-Count` alongside, and the screen can say so.
 */
export function useListPage<T>(key: string, path: string, params?: Record<string, unknown>) {
  return useQuery<{ rows: T[]; total: number }>({
    queryKey: [key, params ?? {}],
    queryFn: async () => {
      const qs = new URLSearchParams()
      for (const [k, v] of Object.entries(params ?? {})) {
        if (v !== undefined && v !== null && v !== "" && v !== "all") qs.set(k, String(v))
      }
      const res = await api.get(`${path}?${qs}`)
      const rows: T[] = res.data
      const header = Number(res.headers?.["x-total-count"])
      return { rows, total: Number.isFinite(header) ? header : rows.length }
    },
  })
}

/**
 * A server-paged list, and the three things a table needs to show one.
 *
 * `useListPage` reads the count; this walks. The screen keeps a page number, the query
 * key carries the offset so React Query caches each page, and `placeholderData` keeps
 * the previous page on screen while the next one loads rather than flashing empty.
 */
export function usePagedList<T>(
  key: string,
  path: string,
  params?: Record<string, unknown>,
  initialSize = 100,
) {
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(initialSize)

  const filters = JSON.stringify(params ?? {})
  useEffect(() => setPage(1), [filters])

  const query = useListPage<T>(key, path, {
    ...(params ?? {}),
    limit: size,
    offset: (page - 1) * size,
  })

  return {
    rows: query.data?.rows ?? [],
    total: query.data?.total ?? 0,
    isLoading: query.isLoading,
    page,
    pageSize: size,
    onServerPage: (next: number, nextSize: number) => {
      setPage(next)
      setSize(nextSize)
    },
  }
}

export function useOne<T>(key: string, path: string, id?: number | string | null) {
  return useQuery<T>({
    queryKey: [key, id],
    queryFn: async () => (await api.get(`${path}/${id}`)).data,
    enabled: id !== undefined && id !== null && id !== "new",
  })
}

/** One mutation for both create and edit, keyed on editingId. */
export function useSave<T>(opts: {
  path: string
  invalidate: string[]
  editingId?: number | null
  labels?: { created?: string; updated?: string }
  onDone?: () => void
}) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: Record<string, unknown>): Promise<T> => {
      if (opts.editingId) {
        return (await api.patch(`${opts.path}/${opts.editingId}`, payload)).data
      }
      return (await api.post(opts.path, payload)).data
    },
    onSuccess: () => {
      opts.invalidate.forEach((k) => qc.invalidateQueries({ queryKey: [k] }))
      toast.success(
        opts.editingId ? (opts.labels?.updated ?? "Updated") : (opts.labels?.created ?? "Saved")
      )
      opts.onDone?.()
    },
    onError: (err: any) =>
      toast.error(err?.response?.data?.detail ?? "Could not save. Please check the form."),
  })
}

export function useRemove(opts: { path: string; invalidate: string[]; label?: string }) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => (await api.delete(`${opts.path}/${id}`)).data,
    onSuccess: () => {
      opts.invalidate.forEach((k) => qc.invalidateQueries({ queryKey: [k] }))
      toast.success(opts.label ?? "Deleted")
    },
    onError: (err: any) =>
      toast.error(err?.response?.data?.detail ?? "Could not delete this record."),
  })
}

export function useAction(opts: { invalidate: string[]; success: string }) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ path, body }: { path: string; body?: unknown }) =>
      (await api.post(path, body ?? {})).data,
    onSuccess: () => {
      opts.invalidate.forEach((k) => qc.invalidateQueries({ queryKey: [k] }))
      toast.success(opts.success)
    },
    onError: (err: any) => {
      const d = err?.response?.data?.detail
      toast.error(typeof d === "string" ? d : (d?.errors?.join("; ") ?? "Action failed"))
    },
  })
}
