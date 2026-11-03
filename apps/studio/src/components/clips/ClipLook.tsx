import { Monitor, RectangleVertical, Square } from "lucide-react"
import { cn } from "@klygenixvideo/ui"
import type { Aspect, CaptionStyle } from "../../lib/types"

export const ASPECTS: { value: Aspect; label: string; hint: string; icon: typeof Square; ratio: number }[] = [
  { value: "9:16", label: "9:16", hint: "Reels, Shorts", icon: RectangleVertical, ratio: 9 / 16 },
  { value: "1:1", label: "1:1", hint: "Square feed", icon: Square, ratio: 1 },
  { value: "16:9", label: "16:9", hint: "Widescreen", icon: Monitor, ratio: 16 / 9 },
]

export const STYLES: { value: CaptionStyle; label: string }[] = [
  { value: "none", label: "No captions" },
  { value: "clean", label: "Clean" },
  { value: "bold", label: "Bold" },
  { value: "karaoke", label: "Karaoke" },
]

export function CaptionSample({ style, small = false }: { style: CaptionStyle; small?: boolean }) {
  const size = small ? "text-[10px]" : "text-sm"
  if (style === "none") return <span className={cn(size, "text-slate-400")}>—</span>
  if (style === "clean") {
    return <span className={cn(size, "rounded bg-black/60 px-1.5 py-0.5 font-medium text-white")}>Say it once</span>
  }
  if (style === "bold") {
    return (
      <span className={cn(size, "font-black uppercase text-white")} style={{ WebkitTextStroke: "0.6px #000", textShadow: "0 2px 0 #000" }}>
        Say it once
      </span>
    )
  }
  return (
    <span className={cn(size, "font-extrabold text-white")} style={{ textShadow: "0 1px 2px #000" }}>
      Say <span className="rounded bg-brand px-0.5 text-white">it</span> once
    </span>
  )
}

export function AspectPicker({ value, onChange, disabled }: { value: Aspect; onChange: (a: Aspect) => void; disabled?: boolean }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {ASPECTS.map((a) => {
        const Icon = a.icon
        const on = a.value === value
        return (
          <button key={a.value} type="button" disabled={disabled} aria-pressed={on} onClick={() => onChange(a.value)}
            className={cn("flex flex-col items-center gap-0.5 rounded-lg border p-2 text-center disabled:opacity-60",
              on ? "border-brand bg-brand-50 text-brand" : "border-slate-200 text-slate-600 hover:border-slate-300")}>
            <Icon size={18} />
            <span className="text-sm font-semibold">{a.label}</span>
            <span className="text-[11px] text-slate-500">{a.hint}</span>
          </button>
        )
      })}
    </div>
  )
}

export function StylePicker({ value, onChange, disabled }: { value: CaptionStyle; onChange: (s: CaptionStyle) => void; disabled?: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {STYLES.map((s) => {
        const on = s.value === value
        return (
          <button key={s.value} type="button" disabled={disabled} aria-pressed={on} onClick={() => onChange(s.value)}
            className={cn("overflow-hidden rounded-lg border text-left disabled:opacity-60",
              on ? "border-brand ring-2 ring-brand/30" : "border-slate-200 hover:border-slate-300")}>
            <div className="flex h-12 items-end justify-center bg-gradient-to-b from-slate-500 to-slate-800 pb-1.5">
              <CaptionSample style={s.value} small />
            </div>
            <p className={cn("px-2 py-1 text-xs font-semibold", on ? "text-brand" : "text-slate-700")}>{s.label}</p>
          </button>
        )
      })}
    </div>
  )
}

export function FrameOverlay({
  aspect,
  sourceRatio,
  centerX,
  style,
}: {
  aspect: Aspect
  sourceRatio: number
  centerX: number
  style: CaptionStyle
}) {
  const target = ASPECTS.find((a) => a.value === aspect)?.ratio ?? 16 / 9
  const width = Math.min(1, target / sourceRatio)
  const left = Math.min(1 - width, Math.max(0, centerX - width / 2))
  return (
    <div className="pointer-events-none absolute inset-0">
      {width < 1 && (
        <>
          <div className="absolute inset-y-0 left-0 bg-black/55" style={{ width: `${left * 100}%` }} />
          <div className="absolute inset-y-0 right-0 bg-black/55" style={{ width: `${(1 - left - width) * 100}%` }} />
        </>
      )}
      <div className="absolute inset-y-0 border-2 border-white/90" style={{ left: `${left * 100}%`, width: `${width * 100}%` }}>
        <div className="absolute inset-x-0 bottom-[14%] flex justify-center px-1 text-center">
          <CaptionSample style={style} small={width < 0.5} />
        </div>
      </div>
    </div>
  )
}
