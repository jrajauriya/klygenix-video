import { useEffect, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { api } from "@klygenixvideo/auth"
import { Card } from "./ui"
import type { Level } from "@klygenixvideo/client"
import { useUiText } from "../text"

export interface Catalog {
  label: string
  groups: { label: string; items: { key: string; label: string }[] }[]
  roles: { role: string; label: string; hint: string }[]
  levels: Level[]
  defaults: Record<string, Record<string, Level>>
}

export interface AccessActions {
  dirty: boolean
  saving: boolean
  save: () => void
  reset: () => void
}

const LEVEL_STYLE: Record<Level, string> = {
  none: "bg-slate-100 text-slate-500 hover:bg-slate-200",
  view: "bg-blue-50 text-blue-700 hover:bg-blue-100",
  full: "bg-brand-50 text-brand-dark hover:bg-brand-50/70",
}

/**
 * The screen-access matrix, shared by both consoles. Owns its draft; hands Save/Reset
 * upward so the parent can put them in the tab bar. A cell cycles through the levels the
 * SERVER declared, so adding a level is a backend change only.
 *
 * `app` is the only difference between the two callers: the permission API is the same
 * factory mounted under /api/pay and /api/admin. A second copy of this table is how the
 * two would drift.
 */
export function RoleEditor({
  app,
  canEdit,
  onActions,
}: {
  app: string
  canEdit: boolean
  onActions?: (a: AccessActions) => void
}) {
  const qc = useQueryClient()
  const ui = useUiText()
  const LEVEL_LABEL: Record<Level, string> = { none: ui.t("roles.none"), view: ui.t("roles.view"), full: ui.t("roles.full") }
  const [draft, setDraft] = useState<Record<string, Record<string, Level>> | null>(null)

  const { data: catalog } = useQuery<Catalog>({
    queryKey: [`${app}-permission-catalog`],
    queryFn: async () => (await api.get(`/api/${app}/permission-catalog`)).data,
  })
  const { data: saved } = useQuery<Record<string, Record<string, Level>>>({
    queryKey: [`${app}-role-permissions`],
    queryFn: async () => (await api.get(`/api/${app}/roles/permissions`)).data,
  })

  useEffect(() => {
    if (saved && !draft) setDraft(JSON.parse(JSON.stringify(saved)))
  }, [saved, draft])

  const save = useMutation({
    mutationFn: async () =>
      (await api.put(`/api/${app}/roles/permissions`, {
        permissions: Object.fromEntries(
          Object.entries(draft ?? {}).map(([role, map]) => [
            role,
            Object.entries(map).map(([permission_key, access_level]) => ({
              permission_key,
              access_level,
            })),
          ])
        ),
      })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`${app}-role-permissions`] })
      qc.invalidateQueries({ queryKey: [`${app}-permissions`] })
      toast.success(ui.t("roles.saved"))
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail ?? ui.t("roles.failed")),
  })

  const dirty = useMemo(
    () => Boolean(draft && saved) && JSON.stringify(draft) !== JSON.stringify(saved),
    [draft, saved]
  )

  useEffect(() => {
    onActions?.({
      dirty,
      saving: save.isPending,
      save: () => save.mutate(),
      reset: () => catalog && setDraft(JSON.parse(JSON.stringify(catalog.defaults))),
    })
  }, [dirty, save.isPending, catalog, onActions])

  if (!catalog || !draft) return null

  const cycle = (role: string, key: string) => {
    if (!canEdit) return
    const order = catalog.levels
    const current = draft[role]?.[key] ?? "none"
    const next = order[(order.indexOf(current) + 1) % order.length]
    setDraft({ ...draft, [role]: { ...draft[role], [key]: next } })
  }

  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-left">
            <th className="px-4 py-3 font-semibold text-slate-600">{ui.t("roles.screen")}</th>
            <th className="px-4 py-3 text-center font-semibold text-slate-600">
              {ui.t("roles.owner")}
              <span className="block text-[11px] font-normal text-slate-400">{ui.t("roles.alwaysFull")}</span>
            </th>
            {catalog.roles.map((r) => (
              <th key={r.role} className="px-4 py-3 text-center font-semibold text-slate-600">
                {r.label}
                <span className="block text-[11px] font-normal text-slate-400">{r.hint}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {catalog.groups.map((g) => (
            <>
              <tr key={g.label} className="bg-slate-50/60">
                <td colSpan={catalog.roles.length + 2} className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {g.label}
                </td>
              </tr>
              {g.items.map((item) => (
                <tr key={item.key} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-2.5 text-slate-700">{item.label}</td>
                  <td className="px-4 py-2.5 text-center">
                    <span
                      className="cursor-default rounded-md bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-dark opacity-60"
                      title={ui.t("roles.ownerKeeps")}
                    >
                      {ui.t("roles.full")}
                    </span>
                  </td>
                  {catalog.roles.map((r) => {
                    const level = draft[r.role]?.[item.key] ?? "none"
                    return (
                      <td key={r.role} className="px-4 py-2.5 text-center">
                        <button
                          type="button"
                          disabled={!canEdit}
                          onClick={() => cycle(r.role, item.key)}
                          className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${LEVEL_STYLE[level]} ${canEdit ? "cursor-pointer" : "cursor-default"}`}
                        >
                          {LEVEL_LABEL[level]}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </>
          ))}
        </tbody>
      </table>
    </Card>
  )
}
