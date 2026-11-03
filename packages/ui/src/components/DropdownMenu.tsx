import * as React from "react"
import { cn } from "../utils"
import { Popover, useOutsidePopover } from "./Popover"

interface MenuCtx {
  open: boolean
  setOpen: (v: boolean) => void
  /** The wrapper element, which the portalled panel positions against. */
  anchor: React.RefObject<HTMLDivElement | null>
}

const Ctx = React.createContext<MenuCtx | null>(null)

function useMenu(component: string) {
  const ctx = React.useContext(Ctx)
  if (!ctx) throw new Error(`${component} must be used inside <DropdownMenu>`)
  return ctx
}

export function DropdownMenu({
  children,
  open: openProp,
  onOpenChange,
}: {
  children: React.ReactNode
  open?: boolean
  onOpenChange?: (v: boolean) => void
}) {
  const [openState, setOpenState] = React.useState(false)
  const controlled = openProp !== undefined
  const open = controlled ? openProp : openState
  const setOpen = React.useCallback(
    (v: boolean) => {
      if (!controlled) setOpenState(v)
      onOpenChange?.(v)
    },
    [controlled, onOpenChange]
  )
  const ref = React.useRef<HTMLDivElement>(null)
  const close = React.useCallback(() => setOpen(false), [setOpen])
  useOutsidePopover(ref, close, open)

  React.useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open])

  return (
    <Ctx.Provider value={{ open, setOpen, anchor: ref }}>
      <div ref={ref} className="relative">
        {children}
      </div>
    </Ctx.Provider>
  )
}

export function DropdownMenuTrigger({
  children,
  asChild = false,
  className,
}: {
  children: React.ReactNode
  asChild?: boolean
  className?: string
}) {
  const { open, setOpen } = useMenu("DropdownMenuTrigger")
  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    setOpen(!open)
  }

  if (asChild && React.isValidElement(children)) {
    const child = children as React.ReactElement<{ onClick?: (e: React.MouseEvent) => void }>
    return React.cloneElement(child, { onClick: toggle })
  }
  return (
    <button type="button" onClick={toggle} className={className}>
      {children}
    </button>
  )
}

export function DropdownMenuContent({
  children,
  align = "start",
  sideOffset = 6,
  alignOffset = 0,
  className,
}: {
  children: React.ReactNode
  align?: "start" | "center" | "end"
  sideOffset?: number
  alignOffset?: number
  className?: string
}) {
  const { open, anchor } = useMenu("DropdownMenuContent")
  if (!open) return null

  // A menu sizes to its content, not its trigger — hence matchWidth off.
  return (
    <Popover
      anchorRef={anchor}
      open={open}
      matchWidth={false}
      gap={sideOffset}
      maxHeight={360}
      className={cn("min-w-[10rem] py-1", className)}
    >
      {children}
    </Popover>
  )
}

export function DropdownMenuItem({
  children,
  onClick,
  disabled,
  className,
}: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  className?: string
}) {
  const { setOpen } = useMenu("DropdownMenuItem")
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        onClick?.()
        setOpen(false)
      }}
      className={cn(
        "flex w-full items-center px-3 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50 hover:text-navy disabled:pointer-events-none disabled:opacity-50",
        className
      )}
    >
      {children}
    </button>
  )
}

export function DropdownMenuLabel({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return <div className={cn("px-3 py-2 text-sm font-semibold text-navy", className)}>{children}</div>
}

export function DropdownMenuSeparator({ className }: { className?: string }) {
  return <div className={cn("my-1 h-px bg-slate-200", className)} />
}
