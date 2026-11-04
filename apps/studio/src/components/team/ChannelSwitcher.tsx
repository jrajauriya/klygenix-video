import { useCallback, useRef, useState } from "react"
import { toast } from "sonner"
import { Check, ChevronDown, LogOut, Plus } from "lucide-react"
import { api, useAuthStore } from "@klygenixvideo/auth"
import { cn, useConfirm, useOutside } from "@klygenixvideo/ui"
import { roleLabel, switchChannel, useActing, useMyChannels, type MyChannel } from "../../lib/team"
import { detail } from "../../lib/format"
import { useT } from "../../i18n"

export function Initial({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-initials={(name || "?").charAt(0).toUpperCase()}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-brand font-bold text-white before:content-[attr(data-initials)]",
        className ?? "h-6 w-6 text-xs",
      )}
    />
  )
}

export function ChannelSwitcher() {
  const t = useT()
  const confirm = useConfirm()
  const user = useAuthStore((s) => s.user)
  const acting = useActing()
  const { data: channels = [] } = useMyChannels()
  const ref = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  useOutside(ref, close)

  const currentId = acting ?? user?.tenant_id
  const current = channels.find((c) => c.tenant_id === currentId)
  const own = channels.find((c) => c.role === "owner")
  if (!user || (channels.length < 2 && acting === null && (own || channels.length === 0))) return null

  function pick(c: MyChannel | null) {
    setOpen(false)
    if (c && c.tenant_id === currentId) return
    switchChannel(c && c.role !== "owner" ? c.tenant_id : null, c ? "/" : "/welcome")
  }

  async function leave() {
    if (!current || acting === null) return
    setOpen(false)
    const ok = await confirm({
      title: t("Leave {name}?", { name: current.name }),
      message: t("You will lose access to this channel's studio. The owner or a manager can invite you again."),
      confirmLabel: t("Leave channel"),
      variant: "destructive",
    })
    if (!ok) return
    setLeaving(true)
    try {
      await api.post(`/api/video/me/channels/${current.tenant_id}/leave`)
      toast.success(t("You left {name}", { name: current.name }))
      switchChannel(null)
    } catch (err) {
      toast.error(detail(err, t("Could not leave the channel")))
    } finally {
      setLeaving(false)
    }
  }

  const label = current ? t("Channel: {name}, {role}. Switch channel", { name: current.name, role: t(roleLabel(current.role)) }) : t("Switch channel")

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex h-8 max-w-[14rem] items-center gap-1.5 rounded-lg border bg-white px-2 text-sm font-semibold text-slate-700 hover:border-brand hover:text-brand",
          acting !== null ? "border-brand" : "border-slate-200",
        )}
      >
        <Initial name={current?.name ?? "?"} className="h-5 w-5 text-[10px]" />
        <span className="hidden truncate sm:inline">{current?.name ?? t("Switch channel")}</span>
        {acting !== null && current && (
          <span className="hidden rounded bg-brand-50 px-1.5 text-[11px] font-semibold text-brand-dark md:inline">{t(roleLabel(current.role))}</span>
        )}
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[min(18rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          <p className="border-b border-slate-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{t("Your channels")}</p>
          <ul className="scrollbar-slim max-h-80 overflow-y-auto">
            {channels.map((c) => {
              const active = c.tenant_id === currentId
              return (
                <li key={c.tenant_id}>
                  <button
                    type="button"
                    aria-current={active ? "true" : undefined}
                    onClick={() => pick(c)}
                    className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left hover:bg-slate-50"
                  >
                    <Initial name={c.name} className="h-7 w-7 text-xs" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-navy">{c.name}</span>
                      <span className="block truncate text-xs text-slate-500">@{c.handle} · {t(roleLabel(c.role))}</span>
                    </span>
                    {active && <Check size={15} className="shrink-0 text-brand" aria-hidden="true" />}
                  </button>
                </li>
              )
            })}
          </ul>
          {!own && (
            <button type="button" onClick={() => pick(null)}
              className="flex w-full items-center gap-2 border-t border-slate-100 px-3 py-2.5 text-left text-sm font-medium text-slate-700 hover:bg-slate-50">
              <Plus size={15} aria-hidden="true" /> {t("Open your own channel")}
            </button>
          )}
          {acting !== null && current && (
            <button type="button" onClick={leave} disabled={leaving}
              className="flex w-full items-center gap-2 border-t border-slate-100 px-3 py-2.5 text-left text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50">
              <LogOut size={15} aria-hidden="true" /> {t("Leave this channel")}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
