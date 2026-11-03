import { useRef, useState, type ReactNode } from "react"
import { Menu, LogOut, ChevronDown, Palette } from "lucide-react"
import { cn } from "../utils"
import { Avatar, useOutside } from "../components/ui"
import { useUiText } from "../text"

export function Header({
  onMenu,
  title,
  subtitle,
  right,
  user,
}: {
  onMenu: () => void
  title: string
  subtitle?: string
  right?: ReactNode
  user?: {
    name: string
    email: string
    roleLabel?: string
    onLogout: () => void
    extra?: ReactNode
    onTheme?: () => void
  }
}) {
  const ui = useUiText()
  return (
    <header data-chrome="header" className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4 lg:px-6 print:hidden">
      <div className="flex items-center gap-2">
        <button
          onClick={onMenu}
          className="rounded-lg p-2 text-navy hover:bg-slate-100 lg:hidden"
          aria-label={ui.t("openMenu")}
        >
          <Menu size={22} />
        </button>
        <div className="hidden leading-tight lg:block">
          <div className="text-sm font-semibold text-navy-800">{title}</div>
          {subtitle && <div className="text-[11px] text-slate-500">{subtitle}</div>}
        </div>
      </div>
      <div className="flex items-center gap-1 sm:gap-2">
        {right}
        {user && <UserMenu {...user} />}
      </div>
    </header>
  )
}

function UserMenu({
  name,
  email,
  roleLabel,
  onLogout,
  extra,
  onTheme,
}: {
  name: string
  email: string
  roleLabel?: string
  onLogout: () => void
  extra?: ReactNode
  onTheme?: () => void
}) {
  const ui = useUiText()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useOutside(ref, () => setOpen(false))

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 hover:bg-slate-100"
      >
        <span aria-hidden="true"><Avatar name={name} size="md" /></span>
        <span className="sr-only sm:hidden">{name}</span>
        <div className="hidden text-left sm:block">
          <div className="text-sm font-semibold leading-tight text-navy">{name}</div>
          {roleLabel && (
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              {roleLabel}
            </div>
          )}
        </div>
        <ChevronDown size={15} aria-hidden="true" className={cn("text-slate-400 transition-transform", open && "rotate-180")} />
        <span className="sr-only">{ui.t("accountMenu")}</span>
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="border-b border-slate-100 px-4 py-3">
            <div className="truncate text-sm font-semibold text-navy">{name}</div>
            <div className="truncate text-xs text-slate-500">{email}</div>
          </div>
          {extra}
          {onTheme && (
            <button
              onClick={() => {
                setOpen(false)
                onTheme()
              }}
              className="flex w-full items-center gap-2 border-b border-slate-100 px-4 py-2.5 text-left text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              <Palette size={16} /> {ui.t("theme")}
            </button>
          )}
          <button
            onClick={onLogout}
            className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-medium text-red-600 hover:bg-red-50"
          >
            <LogOut size={16} /> {ui.t("signOut")}
          </button>
        </div>
      )}
    </div>
  )
}
