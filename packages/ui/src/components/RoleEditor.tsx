import { Fragment, useEffect, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { api } from "@klygenixvideo/auth"
import { Card, Select } from "./ui"
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
  none: "bg-slate-100 text-slate-600 hover:bg-slate-200",
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
  const [focus, setFocus] = useState<string | null>(null)

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

  const chosen = catalog.roles.find((r) => r.role === focus) ?? catalog.roles[0]

  const cell = (r: Catalog["roles"][number], item: { key: string; label: string }) => {
    const level = draft[r.role]?.[item.key] ?? "none"
    return (
      <button
        type="button"
        disabled={!canEdit}
        aria-label={ui.t("roles.cell", { role: r.label, screen: item.label, level: LEVEL_LABEL[level] })}
        onClick={() => cycle(r.role, item.key)}
        className={`min-w-[4.5rem] rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${LEVEL_STYLE[level]} ${canEdit ? "cursor-pointer" : "cursor-default"}`}
      >
        {LEVEL_LABEL[level]}
      </button>
    )
  }

  const ownerChip = (
    <span className="cursor-default rounded-md bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-dark" title={ui.t("roles.ownerKeeps")}>
      {ui.t("roles.full")}
    </span>
  )

  return (
    <Card className="min-w-0 p-0">
      {chosen && (
        <div className="sm:hidden">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
            <Select
              value={chosen.role}
              onChange={(v) => setFocus(v)}
              options={catalog.roles.map((r) => ({ value: r.role, label: r.label }))}
              aria-label={ui.t("roles.role")}
            />
            {chosen.hint && <p className="mt-1.5 text-xs text-slate-500">{chosen.hint}</p>}
          </div>
          {catalog.groups.map((g) => (
            <div key={g.label} role="group" aria-label={g.label}>
              <p className="bg-slate-50/60 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{g.label}</p>
              <ul>
                {g.items.map((item) => (
                  <li key={item.key} className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-2 last:border-0">
                    <span className="min-w-0 text-sm text-slate-700">{item.label}</span>
                    {cell(chosen, item)}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left">
              <th scope="col" className="sticky left-0 z-10 bg-slate-50 px-4 py-3 font-semibold text-slate-600">{ui.t("roles.screen")}</th>
              <th scope="col" className="px-3 py-3 text-center align-top font-semibold text-slate-600">
                {ui.t("roles.owner")}
                <span className="block text-xs font-normal text-slate-500">{ui.t("roles.alwaysFull")}</span>
              </th>
              {catalog.roles.map((r) => (
                <th key={r.role} scope="col" className="px-3 py-3 text-center align-top font-semibold text-slate-600">
                  {r.label}
                  {r.hint && <span className="mx-auto block max-w-[10rem] text-xs font-normal text-slate-500">{r.hint}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {catalog.groups.map((g) => (
              <Fragment key={g.label}>
                <tr className="bg-slate-50/60">
                  <th scope="colgroup" colSpan={catalog.roles.length + 2} className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <span className="sticky left-4">{g.label}</span>
                  </th>
                </tr>
                {g.items.map((item) => (
                  <tr key={item.key} className="border-b border-slate-100 last:border-0">
                    <th scope="row" className="sticky left-0 z-10 bg-white px-4 py-2.5 text-left font-normal text-slate-700">{item.label}</th>
                    <td className="px-3 py-2.5 text-center">{ownerChip}</td>
                    {catalog.roles.map((r) => (
                      <td key={r.role} className="px-3 py-2.5 text-center">{cell(r, item)}</td>
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
