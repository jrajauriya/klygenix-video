import { useEffect, useRef, useState, type FormEvent } from "react"
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom"
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Bell, ChevronRight, Crown, Download, FileText, History, ListVideo, LogOut, PlayCircle, Scale, ShieldAlert, ShoppingBag, Trash2, UserX, Users, X } from "lucide-react"
import { api, useAuthStore } from "@klygenixvideo/auth"
import { formatMoney } from "@klygenixvideo/client"
import { cn, saveBlob, useConfirm } from "@klygenixvideo/ui"
import { LangSwitch, PageShell } from "../components/Layout"
import { Btn, ChannelAvatar, Empty, Field, INPUT, Skel, TEXTAREA } from "../components/bits"
import { FollowButton } from "../components/FollowButton"
import { TierBadge } from "../components/Support"
import { Thumb } from "../components/VideoCards"
import { STUDIO_URL, errStatus, errText, getJson, useMe, useSignedIn } from "../lib/api"
import { LANG_NAMES, compactNumber, longDate, rupees, timeAgo } from "../lib/format"
import { useTitle } from "../lib/title"
import type { ChannelCard, HistoryItem, Invoice, Membership, Moderation, Purchase } from "../lib/types"
import type { UserSettings } from "@klygenixvideo/types"
import { useT } from "../i18n"

type Tab = "profile" | "notifications" | "plans" | "memberships" | "purchases" | "invoices" | "history" | "following" | "notices" | "privacy"

const TABS: { key: Tab; label: string }[] = [
  { key: "profile", label: "Profile" },
  { key: "notifications", label: "Notifications" },
  { key: "plans", label: "Plans & usage" },
  { key: "memberships", label: "Memberships" },
  { key: "purchases", label: "Purchases" },
  { key: "invoices", label: "Invoices" },
  { key: "history", label: "History" },
  { key: "following", label: "Following" },
  { key: "notices", label: "Notices" },
  { key: "privacy", label: "Privacy & data" },
]

const HISTORY_PAGE = 24

function Panel({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-panel p-4 sm:p-6">
      <div className="mb-4 flex items-center gap-3">
        <h2 className="flex-1 text-base font-bold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function Profile() {
  const t = useT("account")
  const { data: me, isLoading } = useMe()
  const qc = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const [name, setName] = useState("")
  const [language, setLanguage] = useState("en")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!me) return
    setName(me.profile?.display_name ?? me.user.name)
    setLanguage(me.profile?.language ?? "en")
  }, [me])

  async function save(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const { data } = await api.patch("/api/video/me", { display_name: name.trim(), language })
      qc.setQueryData(["me"], data)
      const { token, setAuth } = useAuthStore.getState()
      if (token && user) setAuth(token, { ...user, settings: { ...(user.settings ?? {}), language: language as UserSettings["language"] } })
      toast.success(t("Profile saved"))
    } catch (err) {
      toast.error(errText(err, t("Your profile could not be saved.")))
    } finally {
      setSaving(false)
    }
  }

  if (isLoading || !me) return <Skel className="h-64 w-full rounded-2xl" />
  return (
    <div className="space-y-5">
      <Panel title={t("Display language")}>
        <div className="flex flex-wrap items-center gap-3">
          <p className="min-w-0 flex-1 text-sm text-muted">{t("The language of menus and buttons on Klygenix Play. Error messages from our servers follow it too.")}</p>
          <LangSwitch />
        </div>
      </Panel>
      <Panel title={t("Profile")}>
        <form onSubmit={save} className="grid max-w-xl gap-4">
          <Field label={t("Display name")} hint={t("Shown next to your comments.")}>
            <input className={INPUT} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
          </Field>
          <Field label={t("Content language")} hint={t("Used for AI answers and the default subtitle language.")}>
            <select className={INPUT} value={language} onChange={(e) => setLanguage(e.target.value)}>
              {Object.entries(LANG_NAMES).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
            </select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("Email")}><input className={cn(INPUT, "opacity-70")} value={me.user.email} readOnly /></Field>
            <Field label={t("Country")}><input className={cn(INPUT, "opacity-70")} value={me.profile?.country ?? "—"} readOnly /></Field>
          </div>
          <div><Btn type="submit" tone="brand" disabled={saving || !name.trim()}>{saving ? t("Saving…") : t("Save changes")}</Btn></div>
        </form>
      </Panel>
      <Panel title={t("Creator channel")}>
        {me.channel ? (
          <div className="flex flex-wrap items-center gap-3">
            <ChannelAvatar channel={me.channel} size={44} />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{me.channel.name}</p>
              <p className="text-xs text-muted">@{me.channel.handle} · {t("{n} followers", { n: compactNumber(me.channel.followers) })}</p>
            </div>
            <Link to={`/@${me.channel.handle}`} className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/15">{t("View channel")}</Link>
            <a href={STUDIO_URL} className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover">{t("Open Studio")}</a>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <p className="flex-1 text-sm text-muted">{t("You don't have a channel yet. Open one in Studio to upload videos and reels.")}</p>
            <a href={STUDIO_URL} className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover">{t("Go to Studio")}</a>
          </div>
        )}
      </Panel>
    </div>
  )
}

const DIGESTS = [
  { value: "off", label: "Off", hint: "No email digests." },
  { value: "daily", label: "Daily", hint: "One email a day with new videos from channels you follow." },
  { value: "weekly", label: "Weekly", hint: "One email a week with the best of what you missed." },
] as const

function NotificationSettings() {
  const t = useT("account")
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ["digest"], queryFn: () => getJson<{ frequency: string }>("/api/video/me/digest") })
  const [saving, setSaving] = useState<string | null>(null)

  async function choose(frequency: string) {
    setSaving(frequency)
    try {
      const { data } = await api.put<{ frequency: string }>("/api/video/me/digest", { frequency })
      qc.setQueryData(["digest"], data)
      toast.success(t("Digest setting saved"))
    } catch (err) {
      toast.error(errText(err, t("Your digest setting could not be saved.")))
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="space-y-5">
      <Panel title={t("Email digest")}>
        {q.isLoading ? (
          <Skel className="h-32 w-full" />
        ) : (
          <fieldset className="max-w-xl space-y-2" disabled={saving !== null}>
            <legend className="mb-3 text-sm text-muted">{t("How often should we email you a summary of new videos?")}</legend>
            {DIGESTS.map((d) => (
              <label key={d.value} className={cn("flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3", q.data?.frequency === d.value ? "border-brand bg-brand/[0.08]" : "border-line bg-panel-2 hover:border-white/20")}>
                <input type="radio" name="digest" value={d.value} checked={q.data?.frequency === d.value} onChange={() => void choose(d.value)} className="mt-1 accent-[#C026D3]" />
                <span>
                  <span className="block text-sm font-semibold">{t(d.label)}</span>
                  <span className="block text-xs text-muted">{t(d.hint)}</span>
                </span>
              </label>
            ))}
          </fieldset>
        )}
      </Panel>
      <Link to="/notifications" className="flex items-center gap-3 rounded-2xl border border-line bg-panel p-4 hover:border-brand/50 sm:px-6">
        <Bell size={20} className="shrink-0 text-brand-soft" aria-hidden="true" />
        <span className="min-w-0 flex-1 text-sm font-semibold">{t("See all notifications")}</span>
        <ChevronRight size={18} className="shrink-0 text-muted" aria-hidden="true" />
      </Link>
    </div>
  )
}

function PlansUsage() {
  const t = useT("account")
  const { data: me, isLoading } = useMe()
  if (isLoading || !me) return <Skel className="h-64 w-full rounded-2xl" />
  return (
    <div className="space-y-5">
      <Panel title={t("Your plans")} action={<Link to="/plans" className="text-sm font-semibold text-brand-soft hover:underline">{t("Change plan")}</Link>}>
        <div className="grid gap-3 sm:grid-cols-2">
          {(["viewer", "creator"] as const).map((aud) => {
            const plan = me.plans[aud]
            const sub = me.subscriptions.find((s) => s.audience === aud)
            return (
              <div key={aud} className="rounded-xl bg-panel-2 p-4">
                <p className="text-xs uppercase tracking-wide text-faint">{aud === "viewer" ? t("Watching") : t("Creating")}</p>
                <p className="mt-1 text-lg font-bold">{plan.name}</p>
                <p className="text-sm text-muted">{plan.free ? t("Free") : t("{price} / month", { price: formatMoney(plan.price_minor, plan.currency) })}</p>
                {sub && <p className="mt-2 text-xs text-muted">{t(sub.cancel_at_period_end ? "Ends on {date}" : "Renews on {date}", { date: longDate(sub.current_period_end) })}{sub.status === "grace" ? ` · ${t("payment pending")}` : ""}</p>}
              </div>
            )
          })}
        </div>
      </Panel>
      <Panel title={t("Usage")}>
        <ul className="space-y-4">
          {me.usage.map((u) => {
            const pct = u.limit ? Math.min(100, (u.used / u.limit) * 100) : 0
            return (
              <li key={u.metric}>
                <div className="mb-1.5 flex justify-between text-sm">
                  <span className="font-medium capitalize">{u.label ? t(u.label) : u.metric}</span>
                  <span className="tabular-nums text-muted">{u.used} / {u.limit ?? "∞"} <span className="text-faint">· {u.metric === "ask" ? t("today") : t("this month")}</span></span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-white/10">
                  <div className={cn("h-full rounded-full", pct >= 90 ? "bg-[#f97316]" : "bg-brand")} style={{ width: `${pct}%` }} />
                </div>
              </li>
            )
          })}
        </ul>
      </Panel>
    </div>
  )
}

const MEMBER_STATUS: Record<string, string> = {
  active: "Active", grace: "Payment pending", cancelled: "Ended", lapsed: "Lapsed", expired: "Ended",
}

function Memberships() {
  const t = useT("account")
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [busy, setBusy] = useState<number | null>(null)
  const q = useQuery({ queryKey: ["memberships"], queryFn: () => getJson<Membership[]>("/api/video/me/memberships") })

  async function cancel(m: Membership) {
    if (!m.tier) return
    const ok = await confirm({
      title: t("Cancel {name}?", { name: m.tier.name }),
      message: t("You keep your membership of {channel} until {date}. It will not renew after that.", { channel: m.channel_name ?? t("this channel"), date: longDate(m.current_period_end) }),
      confirmLabel: t("Cancel membership"),
      cancelLabel: t("Keep it"),
      variant: "destructive",
    })
    if (!ok) return
    setBusy(m.tier.id)
    try {
      await api.post(`/api/video/me/memberships/${m.tier.id}/cancel`)
      await qc.invalidateQueries({ queryKey: ["memberships"] })
      qc.invalidateQueries({ queryKey: ["support"] })
      toast.success(t("Cancelled. You keep it until {date}.", { date: longDate(m.current_period_end) }))
    } catch (err) {
      toast.error(errText(err, t("The membership could not be cancelled.")))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Panel title={t("Memberships")}>
      {q.isLoading ? (
        <Skel className="h-24 w-full" />
      ) : (q.data ?? []).length === 0 ? (
        <Empty icon={<Crown size={28} />} title={t("No memberships")} body={t("Join a channel's membership to watch its members-only videos. They show up here.")} />
      ) : (
        <ul className="divide-y divide-line">
          {(q.data ?? []).map((m, i) => {
            const live = m.status === "active" || m.status === "grace"
            return (
              <li key={`${m.tier?.id ?? "x"}-${i}`} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                    {m.channel ? <Link to={`/@${m.channel}`} className="hover:underline">{m.channel_name ?? m.channel}</Link> : <span>{m.channel_name ?? t("Channel")}</span>}
                    {m.tier && <TierBadge>{m.tier.badge || m.tier.name}</TierBadge>}
                  </p>
                  <p className="text-xs text-muted">
                    {m.tier ? `${m.tier.name} · ${t("{price} / month", { price: rupees(m.tier.price_minor, m.tier.currency) })}` : t("Membership")} · {MEMBER_STATUS[m.status] ? t(MEMBER_STATUS[m.status]) : m.status}
                    {live && m.current_period_end ? ` · ${t(m.cancel_at_period_end ? "Ends on {date}" : "Renews on {date}", { date: longDate(m.current_period_end) })}` : ""}
                  </p>
                </div>
                {live && m.status === "active" && !m.cancel_at_period_end && m.tier && (
                  <Btn tone="ghost" size="sm" className="text-muted" onClick={() => cancel(m)} disabled={busy !== null}>
                    {busy === m.tier.id ? t("Cancelling…") : t("Cancel")}
                  </Btn>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

function Purchases() {
  const t = useT("account")
  const q = useQuery({ queryKey: ["purchases"], queryFn: () => getJson<Purchase[]>("/api/video/me/purchases") })
  return (
    <Panel title={t("Purchases")}>
      {q.isLoading ? (
        <Skel className="h-24 w-full" />
      ) : (q.data ?? []).length === 0 ? (
        <Empty icon={<ShoppingBag size={28} />} title={t("Nothing bought yet")} body={t("Videos and series you buy are yours to keep. They show up here.")} />
      ) : (
        <ul className="divide-y divide-line">
          {(q.data ?? []).map((p, i) => {
            const to = p.id === null ? null : p.kind === "series" ? `/playlist/${p.id}` : `/watch/${p.id}`
            return (
              <li key={`${p.kind}-${p.id ?? i}`} className="flex items-center gap-3 py-3">
                {p.kind === "series" ? <ListVideo size={18} className="shrink-0 text-faint" aria-hidden="true" /> : <PlayCircle size={18} className="shrink-0 text-faint" aria-hidden="true" />}
                <div className="min-w-0 flex-1">
                  {to ? <Link to={to} className="block truncate text-sm font-semibold hover:underline">{p.title || t("Untitled")}</Link> : <p className="truncate text-sm font-semibold">{p.title || t("Untitled")}</p>}
                  <p className="text-xs text-muted">{p.kind === "series" ? t("Series") : t("Video")} · {t("bought {date}", { date: longDate(p.bought_at) })}</p>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

function Invoices() {
  const t = useT("account")
  const q = useQuery({ queryKey: ["invoices"], queryFn: () => getJson<Invoice[]>("/api/video/me/invoices") })
  const [busy, setBusy] = useState<number | null>(null)

  async function download(inv: Invoice) {
    setBusy(inv.id)
    try {
      const res = await api.get(`/api/video/me/invoices/${inv.id}.pdf`, { responseType: "blob" })
      saveBlob(res.data as Blob, `${inv.number || `invoice-${inv.id}`}.pdf`)
    } catch (err) {
      toast.error(errText(err, t("The invoice could not be downloaded.")))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Panel title={t("Invoices")}>
      {q.isLoading ? (
        <Skel className="h-24 w-full" />
      ) : (q.data ?? []).length === 0 ? (
        <Empty icon={<FileText size={28} />} title={t("No invoices yet")} body={t("When you pay for a plan, its tax invoice appears here.")} />
      ) : (
        <ul className="divide-y divide-line">
          {(q.data ?? []).map((inv) => (
            <li key={inv.id} className="flex flex-wrap items-center gap-3 py-3">
              <FileText size={18} className="text-faint" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{inv.number}</p>
                <p className="text-xs text-muted">{longDate(inv.date)} · {inv.kind === "credit_note" ? t("Credit note") : t("Tax invoice")}</p>
              </div>
              <span className="text-sm font-semibold tabular-nums">{formatMoney(inv.total_minor, inv.currency)}</span>
              <Btn size="sm" tone="soft" onClick={() => download(inv)} disabled={!inv.has_pdf || busy === inv.id}>
                <Download size={14} aria-hidden="true" /> {busy === inv.id ? "…" : "PDF"}
              </Btn>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

function WatchHistory() {
  const t = useT("account")
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [busy, setBusy] = useState<string | null>(null)
  const q = useInfiniteQuery({
    queryKey: ["history"],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const res = await api.get<HistoryItem[]>("/api/video/me/history", { params: { limit: HISTORY_PAGE, offset: pageParam } })
      return { rows: res.data, offset: pageParam, total: Number(res.headers["x-total-count"] ?? res.data.length) }
    },
    getNextPageParam: (last) => (last.offset + last.rows.length < last.total && last.rows.length > 0 ? last.offset + last.rows.length : undefined),
  })
  const rows = q.data?.pages.flatMap((p) => p.rows) ?? []
  const total = q.data?.pages[0]?.total ?? 0

  async function removeOne(h: HistoryItem) {
    setBusy(h.id)
    try {
      await api.delete(`/api/video/me/history/${h.id}`)
      await qc.invalidateQueries({ queryKey: ["history"] })
      toast.success(t("Removed from history"))
    } catch (err) {
      toast.error(errText(err, t("It could not be removed.")))
    } finally {
      setBusy(null)
    }
  }

  async function clearAll() {
    const ok = await confirm({
      title: t("Clear your watch history?"),
      message: t("Every video you watched is removed from this list, and you lose the place you stopped in each one. This cannot be undone."),
      confirmLabel: t("Clear history"),
      variant: "destructive",
    })
    if (!ok) return
    setBusy("all")
    try {
      await api.delete("/api/video/me/history")
      await qc.invalidateQueries({ queryKey: ["history"] })
      toast.success(t("Watch history cleared"))
    } catch (err) {
      toast.error(errText(err, t("Your history could not be cleared.")))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Panel
      title={total > 0 ? `${t("Watch history")} · ${total}` : t("Watch history")}
      action={rows.length > 0 ? <Btn tone="ghost" size="sm" onClick={clearAll} disabled={busy !== null}><Trash2 size={14} aria-hidden="true" /> {t("Clear all")}</Btn> : undefined}
    >
      {q.isLoading ? (
        <Skel className="h-40 w-full" />
      ) : rows.length === 0 ? (
        <Empty icon={<History size={28} />} title={t("Nothing watched yet")} body={t("Videos you watch while signed in show up here so you can pick up where you left off.")} />
      ) : (
        <>
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {rows.map((h) => (
              <li key={h.id} className="group/item relative">
                <Link to={h.kind === "reel" ? `/reels?start=${h.id}` : `/watch/${h.id}`} className="group flex gap-3 pr-8">
                  <Thumb video={h} className={cn("shrink-0", h.kind === "reel" ? "aspect-[9/16] w-20" : "aspect-video w-36")} progress={h.completed ? 1 : h.duration_ms ? h.position_ms / h.duration_ms : 0} rounded="rounded-lg" />
                  <div className="min-w-0">
                    <p className="line-clamp-2 text-sm font-semibold">{h.title}</p>
                    <p className="mt-1 truncate text-xs text-muted">{h.channel?.name}</p>
                    <p className="text-xs text-faint">{h.completed ? t("Watched") : t("In progress")}{h.watched_at ? ` · ${timeAgo(h.watched_at)}` : ""}</p>
                  </div>
                </Link>
                <button
                  type="button"
                  onClick={() => removeOne(h)}
                  disabled={busy !== null}
                  aria-label={t("Remove {title} from history", { title: h.title })}
                  title={t("Remove from history")}
                  className="absolute right-0 top-0 flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-white/10 hover:text-ink disabled:opacity-50"
                >
                  <X size={16} />
                </button>
              </li>
            ))}
          </ul>
          {q.hasNextPage && (
            <div className="mt-5 flex justify-center">
              <Btn tone="soft" size="sm" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>
                {q.isFetchingNextPage ? t("Loading…") : t("Show more")}
              </Btn>
            </div>
          )}
        </>
      )}
    </Panel>
  )
}

function PrivacyData({ onErased }: { onErased: () => void }) {
  const t = useT("account")
  const { data: me } = useMe()
  const [exporting, setExporting] = useState(false)
  const [typed, setTyped] = useState("")
  const [erasing, setErasing] = useState(false)
  const [blocked, setBlocked] = useState<string | null>(null)

  async function exportData() {
    setExporting(true)
    try {
      const res = await api.post("/api/video/me/export", null, { responseType: "blob" })
      const name = /filename="?([^";]+)"?/.exec(String(res.headers["content-disposition"] ?? ""))?.[1] ?? `klygenix-play-${me?.user.id ?? "data"}.json`
      saveBlob(res.data as Blob, name)
      toast.success(t("Your data was downloaded"))
    } catch (err) {
      toast.error(errText(err, t("Your data could not be exported.")))
    } finally {
      setExporting(false)
    }
  }

  async function erase(e: FormEvent) {
    e.preventDefault()
    if (typed !== "DELETE") return
    setErasing(true)
    setBlocked(null)
    try {
      await api.delete("/api/video/me", { data: { confirm: "DELETE" } })
      toast.success(t("Your account was deleted"))
      onErased()
    } catch (err) {
      if (errStatus(err) === 409) setBlocked(errText(err, t("Cancel your paid plan before deleting the account.")))
      else toast.error(errText(err, t("Your account could not be deleted.")))
    } finally {
      setErasing(false)
    }
  }

  return (
    <div className="space-y-5">
      <Panel title={t("Download my data")}>
        <p className="mb-4 max-w-2xl text-sm text-muted">
          {t("A JSON file with your account, profile, channel, follows, likes, watch history, comments, danmaku, questions you asked videos, plans, payments, reports and appeals.")}
        </p>
        <Btn tone="soft" onClick={exportData} disabled={exporting}><Download size={15} aria-hidden="true" /> {exporting ? t("Preparing…") : t("Download my data")}</Btn>
      </Panel>
      <Panel title={t("Delete my account")}>
        <div className="max-w-2xl space-y-3 text-sm text-muted">
          <p>{t("Deleting your account signs you out for good. We erase your email, name, password and phone, your likes, follows, watch history and questions, and the text of your comments and danmaku.")}{me?.channel ? ` ${t("Your channel is closed and its videos are removed.")}` : ""}</p>
          <p>{t("Invoices and payment records are kept for as long as tax law requires. Cancel any paid plan first.")}</p>
        </div>
        <form onSubmit={erase} className="mt-4 max-w-md space-y-3">
          <Field label={t("Type DELETE to confirm")}>
            <input className={INPUT} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} placeholder="DELETE" />
          </Field>
          {blocked && (
            <p role="alert" className="rounded-xl border border-[#f97316]/40 bg-[#7c2d12]/30 px-3 py-2 text-sm text-[#fed7aa]">
              {blocked} <Link to="/account?tab=plans" className="font-semibold underline">{t("Go to plans")}</Link>
            </p>
          )}
          <Btn type="submit" tone="danger" disabled={typed !== "DELETE" || erasing}><UserX size={15} aria-hidden="true" /> {erasing ? t("Deleting…") : t("Delete my account")}</Btn>
        </form>
      </Panel>
    </div>
  )
}

function Following() {
  const t = useT("account")
  const q = useQuery({ queryKey: ["following"], queryFn: () => getJson<ChannelCard[]>("/api/video/me/following") })
  return (
    <Panel title={t("Channels you follow")}>
      {q.isLoading ? (
        <Skel className="h-32 w-full" />
      ) : (q.data ?? []).length === 0 ? (
        <Empty icon={<Users size={28} />} title={t("You don't follow anyone yet")} body={t("Follow channels to see their new videos in your Subscriptions feed.")} action={<Link to="/" className="text-sm font-semibold text-brand-soft hover:underline">{t("Find channels on Home")}</Link>} />
      ) : (
        <ul className="divide-y divide-line">
          {(q.data ?? []).map((c) => (
            <li key={c.id} className="flex items-center gap-3 py-3">
              <Link to={`/@${c.handle}`} className="flex min-w-0 flex-1 items-center gap-3">
                <ChannelAvatar channel={c} size={40} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{c.name}</p>
                  <p className="text-xs text-muted">@{c.handle} · {t("{n} followers", { n: compactNumber(c.followers) })}</p>
                </div>
              </Link>
              <FollowButton handle={c.handle} following size="sm" />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

const ACTION_LABELS: Record<string, string> = {
  remove: "Removed", hide: "Hidden", restrict: "Age-restricted", warn: "Warning", strike: "Strike", suspend: "Channel suspended",
  label: "Label added", block: "Blocked", restore: "Restored",
}

function Notices() {
  const t = useT("account")
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ["moderation"], queryFn: () => getJson<Moderation>("/api/video/me/moderation") })
  const [appealFor, setAppealFor] = useState<number | null>(null)
  const [text, setText] = useState("")
  const [sending, setSending] = useState(false)

  async function appeal(e: FormEvent) {
    e.preventDefault()
    if (appealFor === null) return
    setSending(true)
    try {
      await api.post("/api/video/appeals", { action_id: appealFor, text: text.trim() })
      toast.success(t("Appeal sent. We'll review it and let you know."))
      setAppealFor(null)
      setText("")
      qc.invalidateQueries({ queryKey: ["moderation"] })
    } catch (err) {
      toast.error(errText(err, t("The appeal could not be sent.")))
    } finally {
      setSending(false)
    }
  }

  const data = q.data
  return (
    <div className="space-y-5">
      <Link to="/account/notices" className="flex items-center gap-3 rounded-2xl border border-line bg-panel p-4 hover:border-brand/50 sm:px-6">
        <Scale size={20} className="shrink-0 text-brand-soft" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{t("Copyright notices and counter-notices")}</span>
          <span className="block text-xs text-muted">{t("See notices rights holders sent about your content and file a counter-notice.")}</span>
        </span>
        <ChevronRight size={18} className="shrink-0 text-muted" aria-hidden="true" />
      </Link>
      <Panel title={t("Moderation notices")}>
        {q.isLoading ? (
          <Skel className="h-24 w-full" />
        ) : !data || data.actions.length === 0 ? (
          <Empty icon={<ShieldAlert size={28} />} title={t("No notices")} body={t("If our team ever takes action on something you posted, it shows up here and you can appeal.")} />
        ) : (
          <ul className="space-y-3">
            {data.actions.map((a) => (
              <li key={a.id} className="rounded-xl bg-panel-2 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-md bg-[#7c2d12]/60 px-2 py-0.5 text-xs font-semibold text-[#fed7aa]">{ACTION_LABELS[a.action] ? t(ACTION_LABELS[a.action]) : a.action}</span>
                  <span className="text-sm font-semibold capitalize">{a.target_type} #{a.target_id}</span>
                  <span className="ml-auto text-xs text-faint">{timeAgo(a.created_at)}</span>
                </div>
                <p className="mt-2 text-sm text-ink/85">{a.reason}</p>
                {a.appeal ? (
                  <p className="mt-2 text-xs text-muted">{t("Appeal:")} <span className="font-semibold capitalize text-ink">{a.appeal.status}</span>{a.appeal.note ? ` — ${a.appeal.note}` : ""}</p>
                ) : appealFor === a.id ? (
                  <form onSubmit={appeal} className="mt-3 space-y-2">
                    <textarea className={TEXTAREA} rows={4} minLength={10} maxLength={3000} value={text} onChange={(e) => setText(e.target.value)} placeholder={t("Tell us why you think this was a mistake (at least 10 characters).")} aria-label={t("Appeal")} required />
                    <div className="flex justify-end gap-2">
                      <Btn tone="ghost" size="sm" onClick={() => setAppealFor(null)}>{t("Cancel")}</Btn>
                      <Btn tone="brand" size="sm" type="submit" disabled={sending || text.trim().length < 10}>{sending ? t("Sending…") : t("Send appeal")}</Btn>
                    </div>
                  </form>
                ) : (
                  <Btn tone="soft" size="sm" className="mt-3" onClick={() => { setAppealFor(a.id); setText("") }}>{t("Appeal")}</Btn>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {data && data.strikes.length > 0 && (
        <Panel title={t("Strikes")}>
          <ul className="divide-y divide-line">
            {data.strikes.map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-3 text-sm">
                <span className="flex-1">{s.reason}</span>
                <span className="text-xs text-muted">{s.lifted ? t("Lifted") : t("Expires {date}", { date: longDate(s.expires_at) })}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  )
}

export default function AccountPage() {
  const t = useT("account")
  useTitle("Account")
  const signedIn = useSignedIn()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const clearAuth = useAuthStore((s) => s.clearAuth)
  const qc = useQueryClient()
  const leaving = useRef(false)
  const tab = (TABS.some((t) => t.key === params.get("tab")) ? params.get("tab") : "profile") as Tab
  if (!signedIn) return leaving.current ? null : <Navigate to="/login?returnUrl=%2Faccount" replace />

  function signOut() {
    leaving.current = true
    clearAuth()
    qc.clear()
    navigate("/")
  }

  return (
    <PageShell className="max-w-5xl">
      <div className="mb-5 flex items-center gap-3">
        <h1 className="flex-1 text-2xl font-bold">{t("Account")}</h1>
        <Btn tone="ghost" size="sm" onClick={signOut}><LogOut size={15} aria-hidden="true" /> {t("Sign out")}</Btn>
      </div>
      <div role="tablist" className="-mx-3 mb-6 flex gap-1 overflow-x-auto px-3 scrollbar-none sm:mx-0 sm:px-0">
        {TABS.map((tab2) => (
          <button
            key={tab2.key}
            type="button"
            role="tab"
            aria-selected={tab === tab2.key}
            onClick={() => setParams({ tab: tab2.key }, { replace: true })}
            className={cn("h-9 shrink-0 rounded-full px-4 text-sm font-medium", tab === tab2.key ? "bg-snow text-black" : "bg-white/[0.07] hover:bg-white/15")}
          >
            {t(tab2.label)}
          </button>
        ))}
      </div>
      {tab === "profile" && <Profile />}
      {tab === "notifications" && <NotificationSettings />}
      {tab === "plans" && <PlansUsage />}
      {tab === "memberships" && <Memberships />}
      {tab === "purchases" && <Purchases />}
      {tab === "invoices" && <Invoices />}
      {tab === "history" && <WatchHistory />}
      {tab === "following" && <Following />}
      {tab === "notices" && <Notices />}
      {tab === "privacy" && <PrivacyData onErased={signOut} />}
    </PageShell>
  )
}
