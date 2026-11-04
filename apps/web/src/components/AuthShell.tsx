import type { ReactNode } from "react"
import { Logo } from "./Layout"

export function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="relative flex min-h-[calc(100dvh-3.5rem)] items-start justify-center overflow-hidden px-4 py-10 sm:items-center">
      <div className="pointer-events-none absolute -top-40 left-1/2 h-96 w-[42rem] -translate-x-1/2 rounded-full bg-brand/25 blur-[120px]" />
      <div className="relative w-full max-w-[440px]">
        <div className="mb-6 flex justify-center"><Logo /></div>
        <div className="rounded-3xl border border-line bg-panel/90 p-6 shadow-2xl backdrop-blur sm:p-8">
          <h1 className="text-center text-xl font-bold">{title}</h1>
          {subtitle && <p className="mt-1 text-center text-sm text-muted">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
        {footer && <div className="mt-5 text-center text-sm text-muted">{footer}</div>}
      </div>
    </div>
  )
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return <div role="alert" className="rounded-xl border border-[#7f1d1d] bg-[#450a0a]/60 px-3 py-2 text-sm text-[#fecaca]">{children}</div>
}
