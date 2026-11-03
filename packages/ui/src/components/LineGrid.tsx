import { Plus, Trash2 } from "lucide-react"
import type { ReactNode } from "react"
import { cn } from "../utils"
import { Button } from "./primitives"
import {
  Table,
  TableBody,
  TableCell,
  TableFoot,
  TableHead,
  TableHeader,
  TableRow,
} from "./primitives"
import { useUiText } from "../text"

/** An editable document grid — invoice lines, credit note lines, bill lines. */

export interface LineGridColumn<T> {
  key: string
  header: string
  /** A column of money or quantity: right-aligned, tabular figures. */
  numeric?: boolean
  width?: string
  headerClassName?: string
  className?: string
  render: (row: T, index: number) => ReactNode
}

export interface LineGridProps<T> {
  rows: T[]
  columns: LineGridColumn<T>[]
  rowKey?: (row: T, index: number) => string | number
  onAdd?: () => void
  addLabel?: string
  onRemove?: (index: number) => void
  /** Rendered inside a `<tfoot>`: subtotal, tax, total. */
  footer?: ReactNode
  /** Read-only mode: no add, no remove, no empty-state prompt. */
  readOnly?: boolean
  emptyMessage?: string
  maxHeight?: string
}

export function LineGrid<T>({
  rows,
  columns,
  rowKey,
  onAdd,
  addLabel,
  onRemove,
  footer,
  readOnly = false,
  emptyMessage,
  maxHeight,
}: LineGridProps<T>) {
  const ui = useUiText()
  const showRemove = Boolean(onRemove) && !readOnly

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <Table
        // The sticky header needs a scrolling ancestor, so the height goes on the wrapper.
        wrapperClassName={cn(maxHeight && "overflow-y-auto", maxHeight)}
      >
        <TableHeader>
          <TableRow>
            {columns.map((c) => (
              <TableHead
                key={c.key}
                style={c.width ? { width: c.width } : undefined}
                className={cn(
                  "px-2 py-2",
                  c.numeric && "text-right",
                  c.headerClassName,
                )}
              >
                {c.header}
              </TableHead>
            ))}
            {showRemove && <TableHead className="w-10 px-2 py-2" />}
          </TableRow>
        </TableHeader>

        <TableBody>
          {rows.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={columns.length + (showRemove ? 1 : 0)}
                className="px-3 py-6 text-center text-sm text-slate-400"
              >
                {emptyMessage ?? ui.t("line.empty")}
              </TableCell>
            </TableRow>
          )}

          {rows.map((row, index) => (
            <TableRow key={rowKey ? rowKey(row, index) : index}>
              {columns.map((c) => (
                <TableCell
                  key={c.key}
                  // Down from px-4 py-3, or an h-9 input makes the row 60px tall.
                  className={cn("px-2 py-1", c.numeric && "text-right font-num", c.className)}
                >
                  {c.render(row, index)}
                </TableCell>
              ))}
              {showRemove && (
                <TableCell className="px-2 py-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={ui.t("line.remove", { n: index + 1 })}
                    onClick={() => onRemove?.(index)}
                    className="h-8 w-8 text-slate-400 hover:text-red-600"
                  >
                    <Trash2 size={15} />
                  </Button>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>

        {footer && <TableFoot>{footer}</TableFoot>}
      </Table>

      {onAdd && !readOnly && (
        <div className="border-t border-slate-100 px-2 py-2">
          <Button type="button" variant="ghost" size="sm" onClick={onAdd}>
            <Plus size={15} /> {addLabel ?? ui.t("line.add")}
          </Button>
        </div>
      )}
    </div>
  )
}

/** A totals row for the grid's `<tfoot>`. */
export function LineGridTotal({
  label,
  value,
  span,
  strong = false,
}: {
  label: string
  value: ReactNode
  span: number
  strong?: boolean
}) {
  return (
    <TableRow>
      <TableCell
        colSpan={span}
        className={cn("px-2 py-1.5 text-right text-sm", strong ? "font-semibold text-slate-900" : "text-slate-500")}
      >
        {label}
      </TableCell>
      <TableCell
        className={cn(
          "px-2 py-1.5 text-right font-num text-sm",
          strong ? "text-base font-semibold text-slate-900" : "text-slate-700",
        )}
      >
        {value}
      </TableCell>
    </TableRow>
  )
}
