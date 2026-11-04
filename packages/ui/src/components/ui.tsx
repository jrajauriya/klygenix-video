import {
  cloneElement, isValidElement, useCallback, useEffect, useId, useRef, useState,
  type ChangeEvent, type InputHTMLAttributes, type ReactElement, type ReactNode,
} from "react"
import { createPortal } from "react-dom"
import {
  X, ArrowLeft, ChevronDown, Check, Trash2, Eye, EyeOff, Maximize2, Minimize2,
} from "lucide-react"
import { cn } from "../utils"
import { Popover, useOutsidePopover } from "./Popover"
import { useDialog } from "./useDialog"
import { useUiText } from "../text"

export function useOutside(ref: React.RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [ref, onClose])
}

export function Card({
  children,
  className,
  ...props
}: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("card", className)} {...props}>
      {children}
    </div>
  )
}

export function Avatar({
  name,
  size = "md",
  className,
}: {
  name?: string
  size?: "sm" | "md" | "lg" | "xl"
  className?: string
}) {
  const sz = {
    sm: "h-8 w-8 text-xs",
    md: "h-9 w-9 text-sm",
    lg: "h-11 w-11 text-base",
    xl: "h-14 w-14 text-xl",
  }[size]
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-slate-200 font-bold text-slate-700",
        sz,
        className
      )}
    >
      {(name || "?").charAt(0).toUpperCase()}
    </div>
  )
}

export interface SelectOption {
  value: string
  label: string
  hint?: string
  icon?: ReactNode
}

export function Select({
  value,
  onChange,
  options,
  placeholder,
  className,
  clearable = false,
  disabled = false,
  onSearch,
  searchHint,
  id,
  "aria-label": ariaLabel,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
}: {
  value: string
  onChange: (v: string) => void
  options: SelectOption[]
  placeholder?: string
  className?: string
  clearable?: boolean
  disabled?: boolean
  onSearch?: (text: string) => void
  searchHint?: string
  id?: string
  "aria-label"?: string
  "aria-invalid"?: boolean
  "aria-describedby"?: string
}) {
  const ui = useUiText()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const ref = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useOutsidePopover(ref, close, open)

  useEffect(() => {
    if (!open) {
      setQuery("")
      onSearch?.("")
    }
  }, [open])

  const selected = options.find((o) => o.value === value)
  const showClear = clearable && value !== ""
  const showSearch = options.length > 8 || Boolean(onSearch)
  const shown =
    query && !onSearch
      ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
      : options

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        id={id}
        disabled={disabled}
        aria-expanded={open}
        aria-label={ariaLabel ? `${ariaLabel}: ${selected ? selected.label : placeholder ?? ui.t("select")}` : undefined}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white py-2 pl-3 pr-2.5 text-sm font-medium text-slate-700 outline-none transition-colors hover:border-slate-400 focus:border-brand focus:ring-1 focus:ring-brand disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
      >
        <span className={cn("flex min-w-0 items-center gap-2", !selected && "text-slate-400")}>
          {selected?.icon}
          <span className="truncate">{selected ? selected.label : placeholder ?? ui.t("select")}</span>
        </span>
        {showClear ? (
          <span
            title={ui.t("clearSelection")}
            onClick={(e) => {
              e.stopPropagation()
              onChange("")
              setOpen(false)
            }}
            className="shrink-0 rounded p-0.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            <X size={15} />
          </span>
        ) : (
          <ChevronDown
            size={16}
            className={cn("shrink-0 text-slate-400 transition-transform", open && "rotate-180")}
          />
        )}
      </button>
      <Popover anchorRef={ref} open={open}>
        <>
          {showSearch && (
            <div className="sticky top-0 z-10 bg-white p-1">
              <input
                autoFocus
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  onSearch?.(e.target.value)
                }}
                placeholder={searchHint ?? ui.t("search")}
                aria-label={searchHint ?? ui.t("searchOptions")}
                className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-brand"
              />
            </div>
          )}
          {shown.length === 0 && <div className="px-3 py-2 text-sm text-slate-400">{ui.t("noMatches")}</div>}
          {shown.map((o) => {
            const active = o.value === value
            return (
              <button
                key={o.value}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  onChange(o.value)
                  setOpen(false)
                }}
                className={cn(
                  "flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                  active ? "bg-brand-50 font-semibold text-brand" : "text-slate-700 hover:bg-slate-100"
                )}
              >
                <span className="flex min-w-0 items-center gap-2">
                  {o.icon}
                  <span className="min-w-0">
                    <span className="block truncate">{o.label}</span>
                    {o.hint && <span className="block truncate text-xs text-slate-400">{o.hint}</span>}
                  </span>
                </span>
                {active && <Check size={15} className="shrink-0" />}
              </button>
            )
          })}
        </>
      </Popover>
    </div>
  )
}

export function PageHeader({
  title,
  subtitle,
  description,
  actions,
  children,
  onBack,
  center,
  className,
}: {
  title: string
  subtitle?: string
  description?: string
  actions?: ReactNode
  children?: ReactNode
  onBack?: () => void
  center?: ReactNode
  className?: string
}) {
  const ui = useUiText()
  const sub = subtitle ?? description
  const right = actions ?? children
  return (
    <div className={cn("mb-3 flex shrink-0 items-center gap-3", className)}>
      <div className="flex min-w-0 items-center gap-2">
        {onBack && (
          <button
            onClick={onBack}
            title={ui.t("back")}
            aria-label={ui.t("back")}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white text-navy hover:bg-slate-50"
          >
            <ArrowLeft size={16} />
          </button>
        )}
        <div className="min-w-0">
          <h1 className="text-base font-bold leading-tight text-navy md:truncate md:text-lg">{title}</h1>
          {sub && <p className="truncate text-[13px] text-slate-500">{sub}</p>}
        </div>
      </div>
      {center && <div className="hidden flex-1 justify-center md:flex">{center}</div>}
      {right && (
        <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2">{right}</div>
      )}
    </div>
  )
}

export type Accent = "brand" | "navy" | "red" | "green" | "blue" | "amber"

const ACCENT_TILE: Record<Accent, string> = {
  brand: "text-brand bg-brand-50",
  navy: "text-navy bg-navy-50",
  red: "text-red-600 bg-red-50",
  green: "text-green-600 bg-green-50",
  blue: "text-blue-600 bg-blue-50",
  amber: "text-amber-600 bg-amber-50",
}

export function StatCard({
  label,
  value,
  icon,
  accent = "brand",
  hint,
  onClick,
  size = "md",
  className,
}: {
  label: string
  value: ReactNode
  icon?: ReactNode
  accent?: Accent
  hint?: ReactNode
  onClick?: () => void
  size?: "xs" | "sm" | "md"
  className?: string
}) {
  const xs = size === "xs"
  const sm = size === "sm"
  const body = (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className={cn(
          "font-semibold uppercase tracking-wide text-slate-500",
          xs ? "text-[10px] leading-tight" : sm ? "text-[11px]" : "text-xs"
        )}>{label}</p>
        <p className={cn(
          "truncate font-bold text-navy",
          xs ? "text-base leading-tight" : sm ? "text-lg" : "mt-1 text-2xl"
        )}>{value}</p>
        {hint && <p className="truncate text-xs text-slate-400">{hint}</p>}
      </div>
      {icon && (
        <div
          className={cn(
            "flex shrink-0 items-center justify-center rounded-lg",
            xs ? "h-7 w-7" : sm ? "h-9 w-9" : "h-11 w-11",
            ACCENT_TILE[accent]
          )}
        >
          {icon}
        </div>
      )}
    </div>
  )
  if (onClick) {
    return (
      <button
        onClick={onClick}
        className={cn("card w-full text-left transition hover:border-slate-300", xs ? "p-2" : sm ? "p-3" : "p-4", className)}
      >
        {body}
      </button>
    )
  }
  return <Card className={cn(xs ? "p-2" : sm ? "p-3" : "p-4", className)}>{body}</Card>
}

export type BadgeColor =
  | "slate"
  | "brand"
  | "navy"
  | "red"
  | "green"
  | "blue"
  | "amber"
  | "purple"

const BADGE: Record<BadgeColor, string> = {
  slate: "bg-slate-100 text-slate-700",
  brand: "bg-brand-50 text-brand",
  navy: "bg-navy-50 text-navy",
  red: "bg-red-100 text-red-700",
  green: "bg-green-100 text-green-700",
  blue: "bg-blue-100 text-blue-700",
  amber: "bg-amber-100 text-amber-800",
  purple: "bg-purple-100 text-purple-700",
}

export type BadgeVariant = "default" | "secondary" | "outline" | "destructive"

const BADGE_VARIANT: Record<BadgeVariant, BadgeColor> = {
  default: "brand",
  secondary: "slate",
  outline: "slate",
  destructive: "red",
}

export function Badge({
  children,
  color,
  variant,
  className,
  ...props
}: {
  children: ReactNode
  color?: BadgeColor
  variant?: BadgeVariant
  className?: string
} & React.HTMLAttributes<HTMLSpanElement>) {
  const resolved = color ?? (variant ? BADGE_VARIANT[variant] : "slate")
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold",
        BADGE[resolved],
        variant === "outline" && "border border-slate-300 bg-white",
        className
      )}
      {...props}
    >
      {children}
    </span>
  )
}

export function PasswordField({
  value,
  onChange,
  placeholder,
  autoComplete,
  disabled,
  className,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  value?: string
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void
}) {
  const ui = useUiText()
  const [shown, setShown] = useState(false)
  return (
    <div className="relative">
      <input
        {...rest}
        type={shown ? "text" : "password"}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        autoComplete={autoComplete}
        disabled={disabled}
        className={cn("input pr-10", className)}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setShown((v) => !v)}
        aria-label={shown ? ui.t("hidePassword") : ui.t("showPassword")}
        title={shown ? ui.t("hidePassword") : ui.t("showPassword")}
        className="absolute right-0 top-0 flex h-full w-10 items-center justify-center text-slate-400 hover:text-slate-600 disabled:opacity-40"
        disabled={disabled}
      >
        {shown ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  )
}

export function Field({
  label,
  children,
  required,
  error,
  hint,
  className,
}: {
  label: ReactNode
  children: ReactNode
  required?: boolean
  error?: string
  hint?: string
  className?: string
}) {
  const auto = useId()
  const own = isValidElement(children) ? (children.props as { id?: string }).id : undefined
  const id = own ?? auto
  const msgId = error || hint ? `${id}-msg` : undefined

  // Pair the label with the control and put `error` on the control, not just under it.
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, {
        id,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": msgId,
        className: cn((children.props as { className?: string }).className, error && "input-error"),
      })
    : children

  return (
    <div className={className}>
      <label htmlFor={id} className="label">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {control}
      {error ? (
        <p id={msgId} role="alert" className="mt-1 text-xs font-medium text-red-600">
          {error}
        </p>
      ) : (
        hint && (
          <p id={msgId} className="mt-1 text-xs text-slate-400">
            {hint}
          </p>
        )
      )}
    </div>
  )
}

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
  size,
  footer,
  dismissible = true,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  wide?: boolean
  size?: "sm" | "md" | "lg" | "xl"
  footer?: ReactNode
  dismissible?: boolean
}) {
  const box = useDialog<HTMLDivElement>(open, onClose, dismissible)
  const titleId = useId()
  const ui = useUiText()

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  if (!open) return null

  const max = size
    ? { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-3xl", xl: "max-w-5xl" }[size]
    : wide
      ? "max-w-3xl"
      : "max-w-lg"

  return createPortal(
    <div
      className="fixed inset-0 z-[1500] flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8"
      onMouseDown={dismissible ? (e) => e.target === e.currentTarget && onClose() : undefined}
    >
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className={cn("card my-4 w-full outline-none", max)}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 id={titleId} className="font-semibold text-navy">{title}</h2>
          {dismissible && (
            <button type="button" onClick={onClose} aria-label={ui.t("close")} title={ui.t("close")} className="rounded p-1 text-slate-400 hover:bg-slate-100">
              <X size={18} aria-hidden />
            </button>
          )}
        </div>
        <div className="p-5">{children}</div>
        {footer && <div className="border-t border-slate-200 px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body
  )
}

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  width = "md",
  footer,
  maximizable,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  subtitle?: ReactNode
  children: ReactNode
  width?: "sm" | "md" | "lg" | "xl" | (string & {})
  footer?: ReactNode
  maximizable?: boolean
}) {
  const [maximized, setMaximized] = useState(false)
  const box = useDialog<HTMLDivElement>(open, onClose)
  const titleId = useId()
  const ui = useUiText()
  if (!open) return null
  const NAMED: Record<string, string> = {
    sm: "sm:w-[400px]",
    md: "sm:w-[480px]",
    lg: "sm:w-[640px]",
    xl: "sm:w-[860px]",
  }
  const w = maximizable && maximized ? "" : NAMED[width] ?? width
  return (
    <div className="fixed inset-0 z-[1500]">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        className={cn("absolute inset-y-0 right-0 flex w-full flex-col bg-white shadow-2xl outline-none", w)}>
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-3">
          <div className="min-w-0">
            <h2 id={titleId} className="truncate font-semibold text-navy">{title}</h2>
            {subtitle && <p className="truncate text-xs text-slate-500">{subtitle}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {maximizable && (
              <button
                onClick={() => setMaximized((m) => !m)}
                title={maximized ? ui.t("shrinkBack") : ui.t("fullScreen")}
                aria-label={maximized ? ui.t("shrinkBack") : ui.t("fullScreen")}
                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-navy"
              >
                {maximized ? <Minimize2 size={17} aria-hidden /> : <Maximize2 size={17} aria-hidden />}
              </button>
            )}
            <button type="button" onClick={onClose} aria-label={ui.t("close")} title={ui.t("close")} className="rounded p-1 text-slate-400 hover:bg-slate-100">
              <X size={18} aria-hidden />
            </button>
          </div>
        </div>
        <div className="scrollbar-slim flex-1 overflow-y-auto p-5">{children}</div>
        {footer && <div className="border-t border-slate-200 px-5 py-3">{footer}</div>}
      </div>
    </div>
  )
}

export interface DrawerAction {
  label: string
  onClick: () => void
  icon?: ReactNode
  pending?: boolean
  disabled?: boolean
}

export function DrawerFooter({
  destructive,
  secondary,
  onCancel,
  cancelLabel,
  save,
}: {
  destructive?: DrawerAction
  secondary?: DrawerAction[]
  onCancel?: () => void
  cancelLabel?: string
  save?: DrawerAction
}) {
  const ui = useUiText()
  const left = [...(secondary ?? []), ...(destructive ? [destructive] : [])]
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {left.length > 0 && (
        <div className="mr-auto flex flex-wrap items-center gap-2">
          {secondary?.map((a) => (
            <button
              key={a.label}
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={a.disabled || a.pending}
              onClick={a.onClick}
            >
              {a.icon}
              {a.pending ? ui.t("working") : a.label}
            </button>
          ))}
          {destructive && (
            <button
              type="button"
              className="btn btn-danger btn-sm"
              disabled={destructive.disabled || destructive.pending}
              onClick={destructive.onClick}
            >
              {destructive.icon ?? <Trash2 size={15} />}
              {destructive.pending ? ui.t("removing") : destructive.label}
            </button>
          )}
        </div>
      )}
      {onCancel && (
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          {cancelLabel ?? ui.t("cancel")}
        </button>
      )}
      {save && (
        <button
          type="button"
          className="btn btn-primary"
          disabled={save.disabled || save.pending}
          onClick={save.onClick}
        >
          {save.icon}
          {save.pending ? ui.t("saving") : save.label}
        </button>
      )}
    </div>
  )
}

export function Spinner({ label }: { label?: string }) {
  const ui = useUiText()
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-slate-400" role="status">
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-navy" aria-hidden="true" />
      <span className="text-sm">{label ?? ui.t("loading")}</span>
    </div>
  )
}

export function ProgressBar({
  value,
  max,
  showLabel = true,
  size = "md",
  label,
}: {
  value: number
  max: number
  showLabel?: boolean
  size?: "sm" | "md"
  label?: string
}) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  const complete = max > 0 && value >= max
  return (
    <div className="flex items-center gap-2">
      <div
        className={cn(
          "flex-1 overflow-hidden rounded-full bg-slate-200",
          size === "sm" ? "h-1.5" : "h-2"
        )}
      >
        <div
          className={cn("h-full rounded-full transition-all", complete ? "bg-green-500" : "bg-brand")}
          style={{ width: `${pct}%` }}
        />
      </div>
      {showLabel && (
        <span className="shrink-0 text-xs font-semibold text-slate-500">{label ?? `${pct}%`}</span>
      )}
    </div>
  )
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string
  hint?: string
  action?: ReactNode
}) {
  return (
    <div className="card flex flex-col items-center justify-center gap-1 py-14 text-center">
      <p className="font-semibold text-slate-600">{title}</p>
      {hint && <p className="text-sm text-slate-400">{hint}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

export function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-4 border-b border-slate-100 pb-2 text-sm font-bold uppercase tracking-wide text-navy">
      {children}
    </h2>
  )
}

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { key: string; label: string; icon?: ReactNode }[]
  active: string
  onChange: (key: string) => void
}) {
  function onKey(e: React.KeyboardEvent<HTMLDivElement>) {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0
    const edge = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : -1
    if (!step && edge < 0) return
    e.preventDefault()
    const at = tabs.findIndex((t) => t.key === active)
    const next = edge >= 0 ? edge : (at + step + tabs.length) % tabs.length
    onChange(tabs[next].key)
    e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
  }
  return (
    <div role="tablist" onKeyDown={onKey} className="mb-4 flex shrink-0 gap-1 overflow-x-auto shadow-[inset_0_-1px_0_var(--color-slate-200)]">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={t.key === active}
          tabIndex={t.key === active ? 0 : -1}
          onClick={() => onChange(t.key)}
          className={cn(
            "flex items-center gap-1.5 whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition",
            t.key === active
              ? "border-brand text-navy"
              : "border-transparent text-slate-500 hover:text-navy"
          )}
        >
          {t.icon}
          {t.label}
        </button>
      ))}
    </div>
  )
}


export function Switch({
  checked,
  onChange,
  label,
  disabled,
  className,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label?: string
  disabled?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-brand" : "bg-slate-300",
        className
      )}
    >
      <span
        className={cn(
          "inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-4" : "translate-x-0.5"
        )}
      />
    </button>
  )
}

export function ToggleField({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div className="min-w-0">
        <p className="text-sm font-medium text-navy">{label}</p>
        {hint && <p className="text-xs text-slate-500">{hint}</p>}
      </div>
      <Switch checked={checked} onChange={onChange} label={label} disabled={disabled} />
    </div>
  )
}
