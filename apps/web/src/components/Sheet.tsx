import { useEffect, useId, useRef, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { X } from "lucide-react"
import { cn } from "@klygenixvideo/ui"
import { useT } from "../i18n"

export function Sheet({
  open, onClose, title, children, footer, wide = false, className,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
  className?: string
}) {
  const t = useT()
  const panel = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const close = useRef(onClose)
  close.current = onClose

  useEffect(() => {
    if (!open) return
    const before = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation()
        close.current()
      }
    }
    document.addEventListener("keydown", onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    window.setTimeout(() => {
      const first = panel.current?.querySelector<HTMLElement>("input, textarea, select, button:not([data-close])")
      ;(first ?? panel.current)?.focus()
    }, 30)
    return () => {
      document.removeEventListener("keydown", onKey)
      document.body.style.overflow = prevOverflow
      before?.focus?.()
    }
  }, [open])

  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-[1500] flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-[2px]" onClick={onClose} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          "relative flex max-h-[88dvh] w-full flex-col rounded-t-2xl border border-line bg-panel text-ink shadow-2xl outline-none sm:rounded-2xl",
          wide ? "sm:max-w-2xl" : "sm:max-w-md",
          className,
        )}
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-white/20 sm:hidden" />
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <h2 id={titleId} className="min-w-0 flex-1 truncate text-base font-semibold">{title}</h2>
          <button type="button" data-close onClick={onClose} aria-label={t("Close")} className="rounded-full p-1.5 text-muted hover:bg-white/10 hover:text-ink">
            <X size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
