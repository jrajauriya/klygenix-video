import { useCallback, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Bell, CheckCheck, ExternalLink } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { Spinner, cn, useOutside } from "@klygenixvideo/ui"
import { WEB_URL, when } from "../../lib/format"
import type { InboxNote } from "../../lib/types"
import { useT } from "../../i18n"

const ME = "/api/video/me"
const INTERNAL = ["/sponsorships/", "/videos/", "/clips/", "/earnings", "/brand", "/moderation", "/comments", "/calendar"]

function target(url: string | null): { to: string; internal: boolean } | null {
  if (!url) return null
  if (/^https?:\/\//.test(url)) return { to: url, internal: false }
  if (INTERNAL.some((p) => url.startsWith(p))) return { to: url, internal: true }
  return { to: `${WEB_URL.replace(/\/$/, "")}${url.startsWith("/") ? "" : "/"}${url}`, internal: false }
}

export function NotificationBell() {
  const t = useT()
  const qc = useQueryClient()
  const ref = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  useOutside(ref, close)

  const { data: count = 0 } = useQuery({
    queryKey: ["studio-inbox-count"],
    queryFn: async () => (await api.get<{ unread: number }>(`${ME}/inbox/count`)).data.unread,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  })
  const { data, isLoading } = useQuery({
    queryKey: ["studio-inbox"],
    queryFn: async () => (await api.get<{ unread: number; items: InboxNote[] }>(`${ME}/inbox`, { params: { limit: 20 } })).data,
    enabled: open,
  })

  async function markRead(ids?: number[]) {
    try {
      const { data: res } = await api.post<{ unread: number }>(`${ME}/inbox/read`, { ids: ids ?? null })
      qc.setQueryData(["studio-inbox-count"], res.unread)
      qc.setQueryData<{ unread: number; items: InboxNote[] }>(["studio-inbox"], (old) =>
        old ? { unread: res.unread, items: old.items.map((n) => (!ids || ids.includes(n.id) ? { ...n, read: true } : n)) } : old,
      )
    } catch {
      return
    }
  }

  const items = data?.items ?? []
  const label = count ? t("Notifications, {n} unread", { n: count }) : t("Notifications")

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((o) => !o)}
        className="relative flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 hover:border-brand hover:text-brand"
      >
        <Bell size={16} aria-hidden="true" />
        {count > 0 && (
          <span aria-hidden="true" className="absolute -right-1.5 -top-1.5 min-w-[18px] rounded-full bg-[#b91c1c] px-1 text-center text-[10px] font-bold leading-[18px] text-white">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
            <h2 className="text-sm font-bold text-navy">{t("Notifications")}</h2>
            <button
              type="button"
              disabled={count === 0}
              onClick={() => markRead()}
              className="inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline disabled:cursor-default disabled:text-slate-400 disabled:no-underline"
            >
              <CheckCheck size={13} aria-hidden="true" /> {t("Mark all as read")}
            </button>
          </div>
          <div className="scrollbar-slim max-h-96 overflow-y-auto">
            {isLoading ? (
              <div className="py-6"><Spinner /></div>
            ) : items.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-slate-500">{t("You are all caught up.")}</p>
            ) : (
              <ul>
                {items.map((n) => {
                  const dest = target(n.url)
                  const body = (
                    <>
                      {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand" aria-hidden="true" />}
                      <span className={cn("min-w-0 flex-1", n.read && "pl-4")}>
                        <span className={cn("block text-sm", n.read ? "text-slate-700" : "font-semibold text-navy")}>
                          {n.title}
                          {!n.read && <span className="sr-only"> ({t("unread")})</span>}
                        </span>
                        {n.body && <span className="block truncate text-xs text-slate-500">{n.body}</span>}
                        <span className="block text-[11px] text-slate-500">{when(n.created_at, true)}</span>
                      </span>
                      {dest && !dest.internal && <ExternalLink size={12} className="mt-1 shrink-0 text-slate-400" aria-hidden="true" />}
                    </>
                  )
                  const cls = "flex w-full items-start gap-2 border-b border-slate-100 px-3 py-2.5 text-left hover:bg-slate-50"
                  const onClick = () => {
                    if (!n.read) markRead([n.id])
                    if (dest?.internal) setOpen(false)
                  }
                  return (
                    <li key={n.id}>
                      {dest?.internal ? (
                        <Link to={dest.to} onClick={onClick} className={cls}>{body}</Link>
                      ) : dest ? (
                        <a href={dest.to} target="_blank" rel="noopener noreferrer" onClick={onClick} className={cls}>{body}</a>
                      ) : (
                        <button type="button" onClick={onClick} className={cls}>{body}</button>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
