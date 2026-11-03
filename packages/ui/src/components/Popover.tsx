import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react"
import { createPortal } from "react-dom"
import { cn } from "../utils"

/** A popup anchored to an element, rendered into document.body. */
export function Popover({
  anchorRef,
  open,
  children,
  className,
  matchWidth = true,
  maxHeight = 256,
  gap = 6,
}: {
  anchorRef: RefObject<HTMLElement | null>
  open: boolean
  children: ReactNode
  className?: string
  /** Match the anchor's width. Off for menus that should size to their content. */
  matchWidth?: boolean
  maxHeight?: number
  gap?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number; width: number; up: boolean } | null>(null)

  // useLayoutEffect, or the panel paints at 0,0 for a frame and visibly jumps.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null)
      return
    }

    function place() {
      const anchor = anchorRef.current
      if (!anchor) return
      const r = anchor.getBoundingClientRect()
      const below = window.innerHeight - r.bottom
      const up = below < maxHeight + gap && r.top > below
      const width = r.width
      // Keep the panel on screen when the anchor is near the right edge.
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8))
      setPos({
        top: up ? r.top - gap : r.bottom + gap,
        left,
        width,
        up,
      })
    }

    place()
    // `true` captures scroll from any ancestor, not just the window.
    window.addEventListener("scroll", place, true)
    window.addEventListener("resize", place)
    return () => {
      window.removeEventListener("scroll", place, true)
      window.removeEventListener("resize", place)
    }
  }, [open, anchorRef, maxHeight, gap])

  if (!open || !pos) return null

  return createPortal(
    <div
      ref={ref}
      data-popover=""
      style={{
        position: "fixed",
        top: pos.up ? undefined : pos.top,
        bottom: pos.up ? window.innerHeight - pos.top : undefined,
        left: pos.left,
        ...(matchWidth ? { width: pos.width } : { minWidth: pos.width }),
        maxHeight,
      }}
      className={cn(
        "scrollbar-slim z-[1700] overflow-auto rounded-xl border border-slate-200 bg-white p-1 shadow-lg",
        className,
      )}
    >
      {children}
    </div>,
    document.body,
  )
}

/** Close when a click lands outside BOTH the anchor and the portalled panel. */
export function useOutsidePopover(
  anchorRef: RefObject<HTMLElement | null>,
  onClose: () => void,
  active = true,
) {
  useEffect(() => {
    if (!active) return
    function onDown(e: MouseEvent) {
      const t = e.target as Node
      if (anchorRef.current?.contains(t)) return
      if ((t as HTMLElement).closest?.("[data-popover]")) return
      onClose()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [anchorRef, onClose, active])
}
