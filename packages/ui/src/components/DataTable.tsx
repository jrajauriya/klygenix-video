import { useEffect, useMemo, useState, type ReactNode } from "react"
import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Search } from "lucide-react"
import { cn } from "../utils"
import { Spinner } from "./ui"
import { useUiText } from "../text"

export interface DataTableColumn<T> {
  key: string
  header: string
  srHeader?: string
  render: (row: T, index: number) => ReactNode
  sortValue?: (row: T) => string | number | null | undefined
  sortKey?: string
  align?: "left" | "right" | "center"
  className?: string
  headerClassName?: string
  width?: string
}

export interface DataTableProps<T> {
  rows: T[]
  columns: DataTableColumn<T>[]
  rowKey?: (row: T, index: number) => string | number
  loading?: boolean
  loadingLabel?: string
  emptyMessage?: string
  emptyTitle?: string
  emptyDescription?: string
  emptyIcon?: ReactNode
  searchValue?: string
  onSearchChange?: (value: string) => void
  searchPlaceholder?: string
  toolbarRight?: ReactNode
  onRowClick?: (row: T, index: number) => void
  rowClassName?: (row: T, index: number) => string | undefined
  pageSize?: number
  pageSizeOptions?: number[]
  /** How many rows exist on the server, when `rows` is one page of them rather than all.
   *  Without it this table pages what it was handed — which looks complete and is not. */
  serverTotal?: number
  onServerPage?: (page: number, pageSize: number) => void
  unitLabel?: string
  note?: ReactNode
  footer?: ReactNode
  initialSort?: { key: string; dir: "asc" | "desc" }
  label?: string
}

function sortAccessor<T>(col: DataTableColumn<T>): ((row: T) => string | number | null | undefined) | undefined {
  if (col.sortValue) return col.sortValue
  if (col.sortKey) {
    const k = col.sortKey
    return (row: T) => (row as Record<string, any>)[k]
  }
  return undefined
}

const ALIGN: Record<string, string> = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  loading = false,
  loadingLabel,
  emptyMessage,
  emptyTitle,
  emptyDescription,
  emptyIcon,
  searchValue,
  onSearchChange,
  searchPlaceholder,
  note,
  toolbarRight,
  onRowClick,
  rowClassName,
  pageSize: initialPageSize = 100,
  pageSizeOptions = [50, 100, 500, 1000],
  serverTotal,
  onServerPage,
  unitLabel,
  footer,
  initialSort,
  label,
}: DataTableProps<T>) {
  const ui = useUiText()
  emptyMessage ??= ui.t("nothingToShow")
  searchPlaceholder ??= ui.t("search")
  unitLabel ??= ui.t("rows")
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(initialSort ?? null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(initialPageSize)

  const onServer = typeof serverTotal === "number" && Boolean(onServerPage)

  useEffect(() => setPageSize(initialPageSize), [initialPageSize])
  useEffect(() => {
    if (!onServer) setPage(1)
  }, [rows.length, pageSize, onServer])
  useEffect(() => {
    if (onServer) onServerPage?.(page, pageSize)
  }, [onServer, page, pageSize])

  const sorted = useMemo(() => {
    if (!sort) return rows
    const col = columns.find((c) => c.key === sort.key)
    const get = col && sortAccessor(col)
    if (!get) return rows
    return [...rows].sort((a, b) => {
      const av = get(a)
      const bv = get(b)
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      let cmp: number
      if (typeof av === "number" && typeof bv === "number") cmp = av - bv
      else cmp = String(av).localeCompare(String(bv), "en", { numeric: true })
      return sort.dir === "asc" ? cmp : -cmp
    })
  }, [rows, sort, columns])

  // Server-paged: `rows` IS the page, so slicing or sorting it again shows a page of a page.
  const total = onServer ? (serverTotal as number) : sorted.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const safePage = onServer ? page : Math.min(page, totalPages)
  const visible = useMemo(
    () => (onServer ? rows : sorted.slice((safePage - 1) * pageSize, safePage * pageSize)),
    [onServer, rows, sorted, safePage, pageSize]
  )

  function toggleSort(key: string) {
    const col = columns.find((c) => c.key === key)
    if (!col || !sortAccessor(col)) return
    setSort((prev) =>
      prev?.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" }
    )
  }

  return (
    <div className="card flex min-h-0 flex-1 flex-col overflow-hidden">
      {(onSearchChange || toolbarRight) && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-2">
          {onSearchChange && (
            <div className="relative min-w-[180px] flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input
                type="search"
                aria-label={searchPlaceholder.replace(/…$/, "")}
                value={searchValue ?? ""}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder={searchPlaceholder}
                className="input h-9 pl-8"
              />
            </div>
          )}
          {toolbarRight && <div className="ml-auto flex flex-wrap items-center gap-2">{toolbarRight}</div>}
        </div>
      )}
      {note && (
        <div className="shrink-0 border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
          {note}
        </div>
      )}
      <div className="scrollbar-slim min-h-0 flex-1 overflow-auto" tabIndex={0} role="region" aria-label={label ?? ui.t("tableOf", { unit: unitLabel })}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              {columns.map((c) => {
                const sortable = Boolean(sortAccessor(c))
                const active = sort?.key === c.key
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : undefined}
                    style={c.width ? { width: c.width } : undefined}
                    className={cn(
                      "sticky top-0 z-10 bg-slate-50 px-4 py-3 font-semibold",
                      ALIGN[c.align ?? "left"],
                      c.headerClassName
                    )}
                  >
                    {sortable ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(c.key)}
                        className={cn(
                          "inline-flex items-center gap-1 uppercase hover:text-navy",
                          active && "text-navy"
                        )}
                      >
                        {c.header}
                        {active &&
                          (sort!.dir === "asc" ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
                      </button>
                    ) : (
                      c.header || (c.srHeader && <span className="sr-only">{c.srHeader}</span>)
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={columns.length} className="px-4 py-0">
                  <Spinner label={loadingLabel} />
                </td>
              </tr>
            )}
            {!loading && visible.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-4 py-10 text-center">
                  {emptyIcon || emptyTitle || emptyDescription ? (
                    <div className="flex flex-col items-center gap-2">
                      {emptyIcon}
                      <p className="text-sm font-medium text-slate-600">{emptyTitle ?? emptyMessage}</p>
                      {emptyDescription && <p className="text-xs text-slate-400">{emptyDescription}</p>}
                    </div>
                  ) : (
                    <span className="text-slate-400">{emptyMessage}</span>
                  )}
                </td>
              </tr>
            )}
            {!loading &&
              visible.map((row, i) => {
                const absoluteIndex = (safePage - 1) * pageSize + i
                return (
                  <tr
                    key={rowKey ? rowKey(row, absoluteIndex) : absoluteIndex}
                    onClick={onRowClick ? () => onRowClick(row, absoluteIndex) : undefined}
                    tabIndex={onRowClick ? 0 : undefined}
                    onKeyDown={onRowClick ? (e) => {
                      if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return
                      e.preventDefault()
                      onRowClick(row, absoluteIndex)
                    } : undefined}
                    className={cn(
                      "border-b border-slate-100 last:border-0 hover:bg-slate-50",
                      onRowClick && "cursor-pointer focus-visible:bg-slate-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand",
                      rowClassName?.(row, absoluteIndex)
                    )}
                  >
                    {columns.map((c) => (
                      <td
                        key={c.key}
                        className={cn("px-4 py-3", ALIGN[c.align ?? "left"], c.className)}
                      >
                        {c.render(row, absoluteIndex)}
                      </td>
                    ))}
                  </tr>
                )
              })}
          </tbody>
          {footer}
        </table>
      </div>

      {total > 0 && (
        <TableFooter
          page={safePage}
          totalPages={totalPages}
          total={total}
          unitLabel={unitLabel}
          pageSize={pageSize}
          pageSizeOptions={pageSizeOptions}
          onPage={setPage}
          onPageSize={(n) => {
            setPageSize(n)
            setPage(1)
          }}
        />
      )}
    </div>
  )
}

function pageWindow(page: number, totalPages: number): (number | "…")[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1)
  const out: (number | "…")[] = [1]
  const from = Math.max(2, page - 1)
  const to = Math.min(totalPages - 1, page + 1)
  if (from > 2) out.push("…")
  for (let p = from; p <= to; p++) out.push(p)
  if (to < totalPages - 1) out.push("…")
  out.push(totalPages)
  return out
}

export function TableFooter({
  page,
  totalPages,
  total,
  unitLabel,
  pageSize,
  pageSizeOptions = [50, 100, 500, 1000],
  onPage,
  onPageSize,
}: {
  page: number
  totalPages: number
  total: number
  unitLabel?: string
  pageSize: number
  pageSizeOptions?: number[]
  onPage: (p: number) => void
  onPageSize: (n: number) => void
}) {
  const ui = useUiText()
  return (
    <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-4 py-2">
      <div className="flex items-center gap-2">
        <p className="text-xs text-slate-500">
          {ui.rich("pageOf", {
            page: <span className="font-num">{page}</span>,
            pages: <span className="font-num">{totalPages}</span>,
            total: <span className="font-num">{ui.num(total)}</span>,
            unit: unitLabel ?? ui.t("rows"),
          })}
        </p>
        <select
          aria-label={ui.t("rowsPerPage")}
          value={pageSize}
          onChange={(e) => onPageSize(Number(e.target.value))}
          className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs text-slate-600"
        >
          {pageSizeOptions.map((n) => (
            <option key={n} value={n}>
              {ui.t("perPage", { n })}
            </option>
          ))}
        </select>
      </div>
      <Pager page={page} totalPages={totalPages} onChange={onPage} label={`${ui.t("pages")} · ${unitLabel ?? ui.t("rows")}`} />
    </div>
  )
}

export function Pager({
  page,
  totalPages,
  onChange,
  label,
}: {
  page: number
  totalPages: number
  onChange: (p: number) => void
  label?: string
}) {
  const ui = useUiText()
  const btn =
    "flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
  return (
    <nav className="flex items-center gap-1" aria-label={label ?? ui.t("pages")}>
      <button type="button" onClick={() => onChange(page - 1)} disabled={page <= 1} className={btn}>
        <ChevronLeft size={13} aria-hidden="true" /> {ui.t("prev")}
      </button>
      {pageWindow(page, totalPages).map((p, i) =>
        p === "…" ? (
          <span key={`gap-${i}`} className="px-1 text-xs text-slate-400">
            …
          </span>
        ) : (
          <button
            key={p}
            type="button"
            aria-label={ui.t("pageN", { n: p })}
            aria-current={p === page ? "page" : undefined}
            onClick={() => onChange(p)}
            className={cn(
              "rounded border px-2 py-1 text-xs font-medium font-num",
              p === page
                ? "border-brand bg-brand text-white"
                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
            )}
          >
            {p}
          </button>
        )
      )}
      <button type="button" onClick={() => onChange(page + 1)} disabled={page >= totalPages} className={btn}>
        {ui.t("next")} <ChevronRight size={13} aria-hidden="true" />
      </button>
    </nav>
  )
}
