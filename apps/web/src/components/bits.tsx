import type { ButtonHTMLAttributes, ReactNode } from "react"
import { Link } from "react-router-dom"
import { BadgeCheck, Sparkles } from "lucide-react"
import { cn } from "@klygenixvideo/ui"
import type { ChannelCard } from "../lib/types"
import { hue, initials } from "../lib/format"

type Tone = "brand" | "ghost" | "soft" | "danger" | "light"

const TONES: Record<Tone, string> = {
  brand: "bg-brand text-white hover:bg-brand-hover",
  ghost: "text-ink hover:bg-white/10",
  soft: "bg-white/10 text-ink hover:bg-white/15",
  danger: "bg-[#b91c1c] text-white hover:bg-[#dc2626]",
  light: "bg-snow text-black hover:bg-snow/85",
}

export function Btn({
  tone = "soft", size = "md", className, children, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone; size?: "sm" | "md" | "lg" }) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-8 px-3 text-xs" : size === "lg" ? "h-11 px-6 text-sm" : "h-9 px-4 text-sm",
        TONES[tone],
        className,
      )}
    >
      {children}
    </button>
  )
}

export function ChannelAvatar({ channel, size = 36, className }: { channel: Pick<ChannelCard, "name" | "handle" | "avatar"> | null | undefined; size?: number; className?: string }) {
  const name = channel?.name ?? "?"
  if (channel?.avatar) {
    return <img src={channel.avatar} alt="" width={size} height={size} loading="lazy" className={cn("shrink-0 rounded-full object-cover", className)} style={{ width: size, height: size }} />
  }
  const h = hue(channel?.handle ?? name)
  return (
    <span
      aria-hidden="true"
      data-initials={initials(name)}
      className={cn("inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white before:content-[attr(data-initials)]", className)}
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.38), background: `linear-gradient(135deg, hsl(${h} 65% 45%), hsl(${(h + 50) % 360} 70% 35%))` }}
    />
  )
}

export function ChannelName({ channel, className }: { channel: ChannelCard | null | undefined; className?: string }) {
  if (!channel) return null
  return (
    <Link to={`/@${channel.handle}`} className={cn("inline-flex min-w-0 items-center gap-1 hover:text-ink", className)}>
      <span className="truncate">{channel.name}</span>
      {channel.verified && <BadgeCheck size={14} className="shrink-0 text-brand-soft" aria-label="Verified" />}
    </Link>
  )
}

export function AiBadge({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md bg-brand/20 px-1.5 py-0.5 text-[11px] font-semibold text-brand-soft ring-1 ring-brand/40", className)}>
      <Sparkles size={11} aria-hidden="true" />
      AI-generated
    </span>
  )
}

export function Empty({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line px-6 py-12 text-center">
      {icon && <div className="mb-1 text-faint">{icon}</div>}
      <p className="text-sm font-semibold text-ink">{title}</p>
      {body && <p className="max-w-sm text-sm text-muted">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export function Skel({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-white/[0.07]", className)} />
}

export function CardSkeletons({ count = 8 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="space-y-3">
          <Skel className="aspect-video w-full rounded-xl" />
          <div className="flex gap-3">
            <Skel className="h-9 w-9 shrink-0 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skel className="h-4 w-11/12" />
              <Skel className="h-3 w-2/3" />
            </div>
          </div>
        </div>
      ))}
    </>
  )
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn("block space-y-1.5", className)}>
      <span className="block text-sm font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="block text-xs text-faint">{hint}</span>}
    </label>
  )
}

export const INPUT =
  "w-full h-10 rounded-xl border border-line bg-panel-2 px-3 text-sm text-ink placeholder:text-faint outline-none transition-colors focus:border-brand focus:ring-1 focus:ring-brand"

export const TEXTAREA =
  "w-full rounded-xl border border-line bg-panel-2 px-3 py-2 text-sm text-ink placeholder:text-faint outline-none transition-colors focus:border-brand focus:ring-1 focus:ring-brand"

export function Tabs<T extends string>({ value, onChange, tabs, className }: { value: T; onChange: (v: T) => void; tabs: { key: T; label: ReactNode }[]; className?: string }) {
  return (
    <div role="tablist" className={cn("flex gap-1 overflow-x-auto scrollbar-none", className)}>
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={value === t.key}
          onClick={() => onChange(t.key)}
          className={cn(
            "h-8 shrink-0 rounded-full px-3.5 text-sm font-medium transition-colors",
            value === t.key ? "bg-snow text-black" : "bg-white/[0.08] text-ink hover:bg-white/15",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
