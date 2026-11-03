import { useRef, type ReactNode } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"

export function Shelf({ title, icon, action, children }: { title: ReactNode; icon?: ReactNode; action?: ReactNode; children: ReactNode }) {
  const row = useRef<HTMLDivElement>(null)
  const scroll = (dir: number) => row.current?.scrollBy({ left: dir * Math.max(240, (row.current?.clientWidth ?? 600) * 0.8), behavior: "smooth" })
  return (
    <section className="relative">
      <div className="mb-3 flex items-center gap-2">
        {icon}
        <h2 className="text-lg font-bold tracking-tight">{title}</h2>
        <div className="flex-1" />
        {action}
        <div className="hidden gap-1 md:flex">
          <button type="button" aria-label="Scroll left" onClick={() => scroll(-1)} className="rounded-full bg-white/[0.07] p-1.5 text-ink hover:bg-white/15"><ChevronLeft size={18} /></button>
          <button type="button" aria-label="Scroll right" onClick={() => scroll(1)} className="rounded-full bg-white/[0.07] p-1.5 text-ink hover:bg-white/15"><ChevronRight size={18} /></button>
        </div>
      </div>
      <div ref={row} className="-mx-3 flex snap-x scroll-px-3 gap-3 overflow-x-auto px-3 pb-1 scrollbar-none sm:-mx-6 sm:scroll-px-6 sm:px-6">
        {children}
      </div>
    </section>
  )
}
