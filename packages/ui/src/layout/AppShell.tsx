import { useState, type ReactNode } from "react"
import { cn } from "../utils"

export function AppShell({
  storageKey,
  sidebar,
  header,
  children,
}: {
  storageKey: string
  sidebar: (state: {
    expanded: boolean
    setExpanded: (v: boolean) => void
    mobileOpen: boolean
    setMobileOpen: (v: boolean) => void
  }) => ReactNode
  header: (state: { onMenu: () => void }) => ReactNode
  children: ReactNode
}) {
  const [expanded, setExpandedState] = useState(
    () => localStorage.getItem(`${storageKey}-expanded`) !== "0"
  )
  const [mobileOpen, setMobileOpen] = useState(false)

  function setExpanded(v: boolean) {
    setExpandedState(v)
    localStorage.setItem(`${storageKey}-expanded`, v ? "1" : "0")
  }

  return (
    <div className="h-dvh overflow-hidden bg-slate-50 print:h-auto print:overflow-visible">
      {sidebar({ expanded, setExpanded, mobileOpen, setMobileOpen })}
      <div
        className={cn(
          "flex h-full min-h-0 flex-col transition-all duration-200",
          "print:h-auto print:pl-0",
          expanded ? "lg:pl-60" : "lg:pl-14"
        )}
      >
        {header({ onMenu: () => setMobileOpen(true) })}
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4 lg:p-5 print:overflow-visible print:p-0">
          {children}
        </main>
      </div>
    </div>
  )
}

export function ListPage({ children }: { children: ReactNode }) {
  return <div className="-mb-4 flex min-h-0 flex-1 flex-col lg:-mb-5">{children}</div>
}
