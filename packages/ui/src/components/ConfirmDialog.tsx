import { createContext, useCallback, useContext, useId, useRef, useState, type ReactNode } from "react"
import { AlertTriangle } from "lucide-react"
import { cn } from "../utils"
import { useDialog } from "./useDialog"
import { useUiText } from "../text"

export interface ConfirmOptions {
  title: string
  message?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  variant?: "default" | "destructive"
}

type Resolver = (ok: boolean) => void

const ConfirmContext = createContext<((opts: ConfirmOptions) => Promise<boolean>) | null>(null)

export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null)
  const resolver = useRef<Resolver | null>(null)

  const confirm = useCallback((next: ConfirmOptions) => {
    setOpts(next)
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve
    })
  }, [])

  function settle(ok: boolean) {
    setOpts(null)
    resolver.current?.(ok)
    resolver.current = null
  }

  const destructive = opts?.variant === "destructive"

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {opts && <ConfirmBox opts={opts} destructive={destructive} settle={settle} />}
    </ConfirmContext.Provider>
  )
}

function ConfirmBox({ opts, destructive, settle }: { opts: ConfirmOptions; destructive: boolean; settle: (ok: boolean) => void }) {
  const box = useDialog<HTMLDivElement>(true, () => settle(false))
  const titleId = useId()
  const ui = useUiText()
  return (
    <div className="fixed inset-0 z-[1600] flex items-center justify-center bg-black/40 p-4">
      <div ref={box} role="alertdialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl outline-none">
        <div className="flex gap-3">
          {destructive && (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600">
              <AlertTriangle size={18} aria-hidden="true" />
            </div>
          )}
          <div className="min-w-0">
            <h2 id={titleId} className="font-semibold text-navy">{opts.title}</h2>
            {opts.message && <div className="mt-1 text-sm text-slate-600">{opts.message}</div>}
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={() => settle(false)} className="btn btn-ghost">
            {opts.cancelLabel ?? ui.t("cancel")}
          </button>
          <button
            type="button"
            onClick={() => settle(true)}
            className={cn("btn", destructive ? "btn-danger" : "btn-primary")}
          >
            {opts.confirmLabel ?? ui.t("confirm")}
          </button>
        </div>
      </div>
    </div>
  )
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error("useConfirm must be used inside <ConfirmDialogProvider>")
  return ctx
}
