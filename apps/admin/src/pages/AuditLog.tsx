import { Fragment, useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { ChevronDown, ChevronRight, RotateCcw } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import {
  Badge, Button, Card, EmptyState, Field, Input, PageHeader, Pager, Select, Spinner, Table, TableBody, TableCell, TableHead,
  TableHeader, TableRow,
} from "@klygenixvideo/ui"
import { VIDEO_ADMIN, when } from "../lib/shared"

interface AuditEntry {
  id: number
  tenant_id: number | null
  occurred_at: string
  actor_kind: string | null
  actor_user_id: number | null
  actor: string | null
  action: string
  target_table: string | null
  target_id: number | string | null
  before: unknown
  after: unknown
  request_id: string | null
  ip: string | null
}

const PAGE_SIZES = [25, 50, 100, 200].map((n) => ({ value: String(n), label: `${n} a page` }))

function useDebounced<T>(value: T, ms = 350) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

function show(v: unknown): string {
  if (v === undefined) return "—"
  if (typeof v === "string") return v
  return JSON.stringify(v, null, 2)
}

function asObject(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>
  if (typeof v === "string" && v.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(v)
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed
    } catch {
      return null
    }
  }
  return null
}

function same(a: unknown, b: unknown): boolean {
  if (typeof a === "string" && typeof b === "string") return a === b
  return JSON.stringify(a) === JSON.stringify(b)
}

function Diff({ before: rawBefore, after: rawAfter }: { before: unknown; after: unknown }) {
  const empty = (v: unknown) => v === null || v === undefined
  if (empty(rawBefore) && empty(rawAfter)) return <p className="text-sm text-slate-500">No before or after values were recorded.</p>
  const before = empty(rawBefore) ? {} : asObject(rawBefore)
  const after = empty(rawAfter) ? {} : asObject(rawAfter)
  if (before === null || after === null) {
    return (
      <div className="grid gap-3 text-xs sm:grid-cols-2">
        {(["Before", "After"] as const).map((label, i) => (
          <div key={label}>
            <p className="mb-1 font-semibold text-slate-500">{label}</p>
            <pre className="whitespace-pre-wrap break-all rounded bg-white p-2 font-mono text-slate-700">{show(i === 0 ? rawBefore ?? undefined : rawAfter ?? undefined)}</pre>
          </div>
        ))}
      </div>
    )
  }
  const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)])).sort()
  if (!keys.length) return <p className="text-sm text-slate-500">No before or after values were recorded.</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[36rem] text-xs">
        <thead>
          <tr className="text-left text-slate-500">
            <th scope="col" className="w-48 px-2 py-1.5 font-semibold">Field</th>
            <th scope="col" className="px-2 py-1.5 font-semibold">Before</th>
            <th scope="col" className="px-2 py-1.5 font-semibold">After</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => {
            const b = before[k]
            const a = after[k]
            const changed = !same(b, a)
            return (
              <tr key={k} className="border-t border-slate-200 align-top">
                <td className="px-2 py-1.5 font-mono font-semibold text-slate-700">
                  {k}
                  {changed && <span className="ml-1.5 rounded bg-amber-100 px-1 text-[10px] font-semibold text-amber-900">changed</span>}
                </td>
                <td className={`whitespace-pre-wrap break-all px-2 py-1.5 font-mono ${changed && b !== undefined ? "bg-red-50 text-red-900" : "text-slate-600"}`}>{show(b)}</td>
                <td className={`whitespace-pre-wrap break-all px-2 py-1.5 font-mono ${changed && a !== undefined ? "bg-green-50 text-green-900" : "text-slate-600"}`}>{show(a)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default function AuditLog() {
  const [action, setAction] = useState("")
  const [actor, setActor] = useState("")
  const [table, setTable] = useState("")
  const [tenant, setTenant] = useState("")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [size, setSize] = useState(50)
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<Set<number>>(new Set())

  const filters = {
    action: action || undefined,
    actor: useDebounced(actor.trim()) || undefined,
    target_table: useDebounced(table.trim()) || undefined,
    tenant_id: useDebounced(tenant.trim()) || undefined,
    from: from || undefined,
    to: to || undefined,
  }
  const filterKey = JSON.stringify(filters)
  useEffect(() => setPage(1), [filterKey, size])

  const { data: actions = [] } = useQuery({
    queryKey: ["admin-audit-actions"],
    queryFn: async () => (await api.get<string[]>(`${VIDEO_ADMIN}/audit/actions`)).data,
    staleTime: 60_000,
  })

  const actionOptions = useMemo(() => {
    const prefixes = Array.from(new Set(actions.filter((a) => a.includes(".")).map((a) => `${a.split(".")[0]}.`))).sort()
    return [
      { value: "", label: "Every action" },
      ...prefixes.map((p) => ({ value: p, label: `${p}* (all)` })),
      ...actions.map((a) => ({ value: a, label: a })),
    ]
  }, [actions])

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["admin-audit", filterKey, size, page],
    queryFn: async () => {
      const res = await api.get<AuditEntry[]>(`${VIDEO_ADMIN}/audit`, { params: { ...filters, limit: size, offset: (page - 1) * size } })
      const total = Number(res.headers?.["x-total-count"])
      return { rows: res.data, total: Number.isFinite(total) ? total : res.data.length }
    },
    placeholderData: (prev) => prev,
  })

  const rows = data?.rows ?? []
  const total = data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / size))
  const filtered = Boolean(action || actor || table || tenant || from || to)

  const toggle = (id: number) =>
    setOpen((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const reset = () => {
    setAction("")
    setActor("")
    setTable("")
    setTenant("")
    setFrom("")
    setTo("")
  }

  return (
    <>
      <PageHeader title="Audit log" subtitle="Every recorded change, who made it, and what it looked like before and after" />
      <Card className="mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        <Field label="Action" className="xl:col-span-2">
          <Select value={action} onChange={setAction} options={actionOptions} aria-label="Action" />
        </Field>
        <Field label="Actor">
          <Input value={actor} onChange={(e) => setActor(e.target.value)} placeholder="Name or email" />
        </Field>
        <Field label="Table">
          <Input value={table} onChange={(e) => setTable(e.target.value)} placeholder="kv_media.videos" />
        </Field>
        <Field label="Tenant ID">
          <Input value={tenant} inputMode="numeric" onChange={(e) => setTenant(e.target.value.replace(/\D/g, ""))} />
        </Field>
        <Field label="From">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To">
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5 text-sm text-slate-600">
          <span className="font-num">
            {total.toLocaleString("en-IN")} entries{isFetching && !isLoading ? " · refreshing…" : ""}
          </span>
          <div className="flex items-center gap-2">
            {filtered && <Button size="sm" variant="ghost" onClick={reset}><RotateCcw size={13} /> Clear filters</Button>}
            <Select value={String(size)} onChange={(v) => setSize(Number(v))} options={PAGE_SIZES} className="w-32" aria-label="Page size" />
          </div>
        </div>
        {isLoading ? (
          <div className="p-8"><Spinner /></div>
        ) : rows.length === 0 ? (
          <EmptyState title="No entries" hint={filtered ? "Nothing matches these filters." : "Nothing has been recorded yet."} />
        ) : (
          <Table aria-label="Audit entries">
            <TableHeader>
              <TableRow>
                <TableHead className="w-10"><span className="sr-only">Details</span></TableHead>
                <TableHead>When</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Target</TableHead>
                <TableHead className="text-right">Tenant</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((e) => {
                const expanded = open.has(e.id)
                return (
                  <Fragment key={e.id}>
                    <TableRow className="cursor-pointer" onClick={() => toggle(e.id)}>
                      <TableCell className="py-2">
                        <button
                          type="button"
                          aria-expanded={expanded}
                          aria-controls={`audit-${e.id}`}
                          aria-label={expanded ? `Hide changes for entry ${e.id}` : `Show changes for entry ${e.id}`}
                          onClick={(ev) => {
                            ev.stopPropagation()
                            toggle(e.id)
                          }}
                          className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-navy"
                        >
                          {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                        </button>
                      </TableCell>
                      <TableCell className="whitespace-nowrap py-2 text-slate-600">{when(e.occurred_at, true)}</TableCell>
                      <TableCell className="py-2"><code className="font-mono text-xs text-slate-800">{e.action}</code></TableCell>
                      <TableCell className="py-2">
                        <span className="text-slate-800">{e.actor ?? (e.actor_kind === "system" ? "background" : "—")}</span>
                        {e.actor_kind && e.actor_kind !== "user" && <Badge color="slate" className="ml-1.5">{e.actor_kind}</Badge>}
                      </TableCell>
                      <TableCell className="py-2 font-mono text-xs text-slate-600">
                        {e.target_table ?? "—"}{e.target_id !== null && e.target_id !== undefined ? ` #${e.target_id}` : ""}
                      </TableCell>
                      <TableCell className="py-2 text-right font-num text-slate-600">{e.tenant_id ?? "—"}</TableCell>
                    </TableRow>
                    {expanded && (
                      <TableRow id={`audit-${e.id}`} className="bg-slate-50 hover:bg-slate-50">
                        <TableCell colSpan={6} className="space-y-3 py-3">
                          <Diff before={e.before} after={e.after} />
                          <p className="text-xs text-slate-500">
                            Entry #{e.id}
                            {e.actor_user_id ? ` · user ${e.actor_user_id}` : ""}
                            {e.request_id ? ` · request ${e.request_id}` : ""}
                            {e.ip ? ` · ${e.ip}` : ""}
                          </p>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                )
              })}
            </TableBody>
          </Table>
        )}
        {pages > 1 && (
          <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-4 py-2.5">
            <span className="font-num text-xs text-slate-500">Page {page} of {pages}</span>
            <Pager page={page} totalPages={pages} onChange={(p) => setPage(Math.min(Math.max(1, p), pages))} label="Audit log pages" />
          </div>
        )}
      </Card>
    </>
  )
}
