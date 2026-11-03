import { cn } from "../utils"

export function StatusPill({
  label,
  hex,
  ring,
  className,
}: {
  label: string
  hex: string
  ring?: boolean
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold",
        ring && "ring-1",
        className
      )}
      style={{
        background: `color-mix(in srgb, ${hex} calc(var(--color-pill-tint) * 100%), transparent)`,
        color: `color-mix(in srgb, ${hex} 100%, var(--color-navy) var(--color-pill-lift))`,
        ...(ring
          ? { boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${hex} 40%, transparent)` }
          : {}),
      }}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: hex }} />
      {label}
    </span>
  )
}
