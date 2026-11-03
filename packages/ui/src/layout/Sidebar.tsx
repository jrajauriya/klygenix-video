import { useEffect, useRef, useState, type ReactNode } from "react"
import { NavLink, useLocation } from "react-router-dom"
import {
  ChevronDown,
  PanelLeftClose,
  PanelLeftOpen,
  X,
  type LucideIcon,
} from "lucide-react"
import { cn } from "../utils"
import { useUiText } from "../text"

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  featureKey?: string
  permissionKey?: string
}

export interface NavSection {
  key: string
  label: string
  icon: LucideIcon
  items: NavItem[]
}

export interface SidebarProps {
  logo: ReactNode
  glyph: ReactNode
  topLinks?: NavItem[]
  sections: NavSection[]
  bottomLinks?: NavItem[]
  canSee?: (item: NavItem) => boolean
  itemBadge?: (item: NavItem) => ReactNode
  storageKey: string
  expanded: boolean
  setExpanded: (v: boolean) => void
  mobileOpen: boolean
  setMobileOpen: (v: boolean) => void
  title?: string
}

function covers(pathname: string, to: string): boolean {
  if (to === "/") return pathname === "/"
  return pathname === to || pathname.startsWith(`${to}/`)
}

function longestMatch(pathname: string, paths: string[]): string | null {
  let best: string | null = null
  for (const to of paths) {
    if (covers(pathname, to) && (best === null || to.length > best.length)) best = to
  }
  return best
}

export function Sidebar({
  logo,
  glyph,
  topLinks = [],
  sections,
  bottomLinks = [],
  canSee,
  itemBadge,
  storageKey,
  expanded,
  setExpanded,
  mobileOpen,
  setMobileOpen,
  title,
}: SidebarProps) {
  const location = useLocation()
  const ui = useUiText()
  const show = canSee ?? (() => true)

  const visibleTop = topLinks.filter(show)
  const visibleSections = sections
    .map((s) => ({ ...s, items: s.items.filter(show) }))
    .filter((s) => s.items.length > 0)
  const visibleBottom = bottomLinks.filter(show)

  const allPaths = [
    ...visibleTop.map((i) => i.to),
    ...visibleSections.flatMap((s) => s.items.map((i) => i.to)),
    ...visibleBottom.map((i) => i.to),
  ]
  const activePath = longestMatch(location.pathname, allPaths)

  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!mobileOpen) return
    const opener = document.activeElement as HTMLElement | null
    let tries = 0
    const focus = () => {
      closeRef.current?.focus({ preventScroll: true })
      if (document.activeElement !== closeRef.current && tries++ < 30) frame = requestAnimationFrame(focus)
    }
    let frame = requestAnimationFrame(focus)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) setMobileOpen(false)
    }
    document.addEventListener("keydown", onKey)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener("keydown", onKey)
      if (opener && document.contains(opener) && opener.getClientRects().length) opener.focus({ preventScroll: true })
    }
  }, [mobileOpen, setMobileOpen])

  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem(`${storageKey}-sections`)
      if (saved) return JSON.parse(saved)
    } catch {
      /* ignore malformed storage */
    }
    return {}
  })

  useEffect(() => {
    setOpen((prev) => {
      const next = { ...prev }
      let changed = false
      for (const s of sections) {
        if (s.items.some((i) => covers(location.pathname, i.to)) && !next[s.key]) {
          next[s.key] = true
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [location.pathname, sections])

  useEffect(() => {
    localStorage.setItem(`${storageKey}-sections`, JSON.stringify(open))
  }, [open, storageKey])

  const widthCls = expanded ? "lg:w-60" : "lg:w-14"
  const labelCls = expanded ? "inline" : "inline lg:hidden"

  function linkClass(isActive: boolean) {
    return cn(
      "group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition active:scale-[0.99]",
      isActive
        ? "bg-brand-50 font-semibold text-brand"
        : "text-slate-600 hover:bg-slate-100 hover:text-navy",
      !expanded && "lg:justify-center lg:px-2"
    )
  }

  const renderFlat = (item: NavItem) => {
    const Icon = item.icon
    return (
      <NavLink
        key={item.to}
        to={item.to}
        title={item.label}
        onClick={() => setMobileOpen(false)}
        className={linkClass(activePath === item.to)}
      >
        <Icon size={20} className="shrink-0" />
        <span className={cn("flex-1 truncate", labelCls)}>{item.label}</span>
        {expanded && itemBadge?.(item)}
      </NavLink>
    )
  }

  return (
    <>
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/30 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside
        data-chrome="sidebar"
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex h-dvh w-60 flex-col border-r border-slate-200 bg-white transition-all duration-200 lg:translate-x-0 print:hidden",
          widthCls,
          mobileOpen ? "translate-x-0" : "-translate-x-full max-lg:invisible"
        )}
      >
        <div className="flex h-14 shrink-0 items-center justify-between gap-1 border-b border-slate-200 px-3">
          <div className={cn("min-w-0", expanded ? "flex" : "flex lg:hidden")}>{logo}</div>
          <div
            className={cn("-mx-1 justify-center", expanded ? "hidden" : "hidden lg:flex")}
            title={title}
          >
            {glyph}
          </div>
          <button
            ref={closeRef}
            onClick={() => setMobileOpen(false)}
            className="text-slate-400 lg:hidden"
            aria-label={ui.t("closeMenu")}
          >
            <X size={20} />
          </button>
        </div>

        <button
          onClick={() => setExpanded(!expanded)}
          title={expanded ? ui.t("collapseSidebar") : ui.t("expandSidebar")}
          aria-label={expanded ? ui.t("collapseSidebar") : ui.t("expandSidebar")}
          aria-expanded={expanded}
          className="absolute right-0 top-12 z-50 hidden h-7 w-7 translate-x-1/2 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 shadow-sm hover:bg-slate-100 hover:text-navy lg:flex"
        >
          {expanded ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
        </button>

        <nav aria-label={ui.t("mainNav")} className="scrollbar-slim min-h-0 flex-1 space-y-1 overflow-y-auto overflow-x-hidden p-2 pb-6">
          {visibleTop.map(renderFlat)}

          {visibleSections.map((section) => {
            const SectionIcon = section.icon
            const isOpen = Boolean(open[section.key])
            const hasActive = section.items.some((i) => i.to === activePath)

            if (!expanded) {
              return (
                <div key={section.key} className="lg:contents">
                  {section.items.map((item) => {
                    const Icon = item.icon
                    return (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        title={`${section.label} — ${item.label}`}
                        onClick={() => setMobileOpen(false)}
                        className={linkClass(activePath === item.to)}
                      >
                        <Icon size={20} className="shrink-0" />
                        <span className={cn("truncate", labelCls)}>{item.label}</span>
                      </NavLink>
                    )
                  })}
                </div>
              )
            }

            return (
              <div key={section.key}>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setOpen((p) => ({ ...p, [section.key]: !p[section.key] }))}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition",
                    hasActive && !isOpen
                      ? "text-brand"
                      : "text-slate-600 hover:bg-slate-100 hover:text-navy"
                  )}
                >
                  <SectionIcon size={20} className="shrink-0" />
                  <span className="flex-1 truncate text-left">{section.label}</span>
                  <ChevronDown
                    size={15}
                    className={cn("shrink-0 text-slate-400 transition-transform", isOpen && "rotate-180")}
                  />
                </button>
                {isOpen && (
                  <div className="mt-0.5 space-y-0.5 border-l border-slate-200 pb-1 pl-3 ml-4">
                    {section.items.map((item) => (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        title={item.label}
                        onClick={() => setMobileOpen(false)}
                        className={({ isActive: _ }) =>
                          cn(
                            "flex items-center rounded-md px-3 py-1.5 text-sm transition",
                            activePath === item.to
                              ? "bg-brand-50 font-semibold text-brand"
                              : "text-slate-600 hover:bg-slate-100 hover:text-navy"
                          )
                        }
                      >
                        <span className="flex-1 truncate">{item.label}</span>
                        {itemBadge?.(item)}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            )
          })}

          {visibleBottom.map(renderFlat)}
        </nav>
      </aside>
    </>
  )
}
