import { useEffect, useRef, useState, type FormEvent } from "react"
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom"
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { ChevronRight, Crown, Download, FileText, History, ListVideo, LogOut, PlayCircle, Scale, ShieldAlert, ShoppingBag, Trash2, UserX, Users, X } from "lucide-react"
import { api, useAuthStore } from "@klygenixvideo/auth"
import { formatMoney } from "@klygenixvideo/client"
import { cn, saveBlob, useConfirm } from "@klygenixvideo/ui"
import { PageShell } from "../components/Layout"
import { Btn, ChannelAvatar, Empty, Field, INPUT, Skel, TEXTAREA } from "../components/bits"
import { FollowButton } from "../components/FollowButton"
import { TierBadge } from "../components/Support"
import { Thumb } from "../components/VideoCards"
import { STUDIO_URL, errStatus, errText, getJson, useMe, useSignedIn } from "../lib/api"
import { LANG_NAMES, compactNumber, longDate, rupees, timeAgo } from "../lib/format"
import { useTitle } from "../lib/title"
import type { ChannelCard, HistoryItem, Invoice, Membership, Moderation, Purchase } from "../lib/types"
import type { UserSettings } from "@klygenixvideo/types"

type Tab = "profile" | "plans" | "memberships" | "purchases" | "invoices" | "history" | "following" | "notices" | "privacy"

const TABS: { key: Tab; label: string }[] = [
  { key: "profile", label: "Profile" },
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
      toast.success("Profile saved")
    } catch (err) {
      toast.error(errText(err, "Your profile could not be saved."))
    } finally {
      setSaving(false)
    }
  }

  if (isLoading || !me) return <Skel className="h-64 w-full rounded-2xl" />
  return (
    <div className="space-y-5">
      <Panel title="Profile">
        <form onSubmit={save} className="grid max-w-xl gap-4">
          <Field label="Display name" hint="Shown next to your comments.">
            <input className={INPUT} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
          </Field>
          <Field label="Language" hint="Used for AI answers and the default subtitle language.">
            <select className={INPUT} value={language} onChange={(e) => setLanguage(e.target.value)}>
              {Object.entries(LANG_NAMES).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
            </select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Email"><input className={cn(INPUT, "opacity-70")} value={me.user.email} readOnly /></Field>
            <Field label="Country"><input className={cn(INPUT, "opacity-70")} value={me.profile?.country ?? "—"} readOnly /></Field>
          </div>
          <div><Btn type="submit" tone="brand" disabled={saving || !name.trim()}>{saving ? "Saving…" : "Save changes"}</Btn></div>
        </form>
      </Panel>
      <Panel title="Creator channel">
        {me.channel ? (
          <div className="flex flex-wrap items-center gap-3">
            <ChannelAvatar channel={me.channel} size={44} />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{me.channel.name}</p>
              <p className="text-xs text-muted">@{me.channel.handle} · {compactNumber(me.channel.followers)} followers</p>
            </div>
            <Link to={`/@${me.channel.handle}`} className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/15">View channel</Link>
            <a href={STUDIO_URL} className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover">Open Studio</a>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <p className="flex-1 text-sm text-muted">You don't have a channel yet. Open one in Studio to upload videos and reels.</p>
            <a href={STUDIO_URL} className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover">Go to Studio</a>
          </div>
        )}
      </Panel>
    </div>
  )
}

function PlansUsage() {
  const { data: me, isLoading } = useMe()
  if (isLoading || !me) return <Skel className="h-64 w-full rounded-2xl" />
  return (
    <div className="space-y-5">
      <Panel title="Your plans" action={<Link to="/plans" className="text-sm font-semibold text-brand-soft hover:underline">Change plan</Link>}>
        <div className="grid gap-3 sm:grid-cols-2">
          {(["viewer", "creator"] as const).map((aud) => {
            const plan = me.plans[aud]
            const sub = me.subscriptions.find((s) => s.audience === aud)
            return (
              <div key={aud} className="rounded-xl bg-panel-2 p-4">
                <p className="text-xs uppercase tracking-wide text-faint">{aud === "viewer" ? "Watching" : "Creating"}</p>
                <p className="mt-1 text-lg font-bold">{plan.name}</p>
                <p className="text-sm text-muted">{plan.free ? "Free" : `${formatMoney(plan.price_minor, plan.currency)} / month`}</p>
                {sub && <p className="mt-2 text-xs text-muted">{sub.cancel_at_period_end ? "Ends" : "Renews"} on {longDate(sub.current_period_end)}{sub.status === "grace" ? " · payment pending" : ""}</p>}
              </div>
            )
          })}
        </div>
      </Panel>
      <Panel title="Usage">
        <ul className="space-y-4">
          {me.usage.map((u) => {
            const pct = u.limit ? Math.min(100, (u.used / u.limit) * 100) : 0
            return (
              <li key={u.metric}>
                <div className="mb-1.5 flex justify-between text-sm">
                  <span className="font-medium capitalize">{u.label}</span>
                  <span className="tabular-nums text-muted">{u.used} / {u.limit ?? "∞"} <span className="text-faint">· {u.metric === "ask" ? "today" : "this month"}</span></span>
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
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [busy, setBusy] = useState<number | null>(null)
  const q = useQuery({ queryKey: ["memberships"], queryFn: () => getJson<Membership[]>("/api/video/me/memberships") })

  async function cancel(m: Membership) {
    if (!m.tier) return
    const ok = await confirm({
      title: `Cancel ${m.tier.name}?`,
      message: `You keep your membership of ${m.channel_name ?? "this channel"} until ${longDate(m.current_period_end)}. It will not renew after that.`,
      confirmLabel: "Cancel membership",
      cancelLabel: "Keep it",
      variant: "destructive",
    })
    if (!ok) return
    setBusy(m.tier.id)
    try {
      await api.post(`/api/video/me/memberships/${m.tier.id}/cancel`)
      await qc.invalidateQueries({ queryKey: ["memberships"] })
      qc.invalidateQueries({ queryKey: ["support"] })
      toast.success(`Cancelled. You keep it until ${longDate(m.current_period_end)}.`)
    } catch (err) {
      toast.error(errText(err, "The membership could not be cancelled."))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Panel title="Memberships">
      {q.isLoading ? (
        <Skel className="h-24 w-full" />
      ) : (q.data ?? []).length === 0 ? (
        <Empty icon={<Crown size={28} />} title="No memberships" body="Join a channel's membership to watch its members-only videos. They show up here." />
      ) : (
        <ul className="divide-y divide-line">
          {(q.data ?? []).map((m, i) => {
            const live = m.status === "active" || m.status === "grace"
            return (
              <li key={`${m.tier?.id ?? "x"}-${i}`} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                    {m.channel ? <Link to={`/@${m.channel}`} className="hover:underline">{m.channel_name ?? m.channel}</Link> : <span>{m.channel_name ?? "Channel"}</span>}
                    {m.tier && <TierBadge>{m.tier.badge || m.tier.name}</TierBadge>}
                  </p>
                  <p className="text-xs text-muted">
                    {m.tier ? `${m.tier.name} · ${rupees(m.tier.price_minor, m.tier.currency)} / month` : "Membership"} · {MEMBER_STATUS[m.status] ?? m.status}
                    {live && m.current_period_end ? ` · ${m.cancel_at_period_end ? "Ends" : "Renews"} on ${longDate(m.current_period_end)}` : ""}
                  </p>
                </div>
                {live && m.status === "active" && !m.cancel_at_period_end && m.tier && (
                  <Btn tone="ghost" size="sm" className="text-muted" onClick={() => cancel(m)} disabled={busy !== null}>
                    {busy === m.tier.id ? "Cancelling…" : "Cancel"}
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
  const q = useQuery({ queryKey: ["purchases"], queryFn: () => getJson<Purchase[]>("/api/video/me/purchases") })
  return (
    <Panel title="Purchases">
      {q.isLoading ? (
        <Skel className="h-24 w-full" />
      ) : (q.data ?? []).length === 0 ? (
        <Empty icon={<ShoppingBag size={28} />} title="Nothing bought yet" body="Videos and series you buy are yours to keep. They show up here." />
      ) : (
        <ul className="divide-y divide-line">
          {(q.data ?? []).map((p, i) => {
            const to = p.id === null ? null : p.kind === "series" ? `/playlist/${p.id}` : `/watch/${p.id}`
            return (
              <li key={`${p.kind}-${p.id ?? i}`} className="flex items-center gap-3 py-3">
                {p.kind === "series" ? <ListVideo size={18} className="shrink-0 text-faint" aria-hidden="true" /> : <PlayCircle size={18} className="shrink-0 text-faint" aria-hidden="true" />}
                <div className="min-w-0 flex-1">
                  {to ? <Link to={to} className="block truncate text-sm font-semibold hover:underline">{p.title || "Untitled"}</Link> : <p className="truncate text-sm font-semibold">{p.title || "Untitled"}</p>}
                  <p className="text-xs text-muted">{p.kind === "series" ? "Series" : "Video"} · bought {longDate(p.bought_at)}</p>
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
  const q = useQuery({ queryKey: ["invoices"], queryFn: () => getJson<Invoice[]>("/api/video/me/invoices") })
  const [busy, setBusy] = useState<number | null>(null)

  async function download(inv: Invoice) {
    setBusy(inv.id)
    try {
      const res = await api.get(`/api/video/me/invoices/${inv.id}.pdf`, { responseType: "blob" })
      saveBlob(res.data as Blob, `${inv.number || `invoice-${inv.id}`}.pdf`)
    } catch (err) {
      toast.error(errText(err, "The invoice could not be downloaded."))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Panel title="Invoices">
      {q.isLoading ? (
        <Skel className="h-24 w-full" />
      ) : (q.data ?? []).length === 0 ? (
        <Empty icon={<FileText size={28} />} title="No invoices yet" body="When you pay for a plan, its tax invoice appears here." />
      ) : (
        <ul className="divide-y divide-line">
          {(q.data ?? []).map((inv) => (
            <li key={inv.id} className="flex flex-wrap items-center gap-3 py-3">
              <FileText size={18} className="text-faint" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{inv.number}</p>
                <p className="text-xs text-muted">{longDate(inv.date)} · {inv.kind === "credit_note" ? "Credit note" : "Tax invoice"}</p>
              </div>
              <span className="text-sm font-semibold tabular-nums">{formatMoney(inv.total_minor, inv.currency)}</span>
              <Btn size="sm" tone="soft" onClick={() => download(inv)} disabled={!inv.has_pdf || busy === inv.id}>
                <Download size={14} /> {busy === inv.id ? "…" : "PDF"}
              </Btn>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

function WatchHistory() {
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
      toast.success("Removed from history")
    } catch (err) {
      toast.error(errText(err, "It could not be removed."))
    } finally {
      setBusy(null)
    }
  }

  async function clearAll() {
    const ok = await confirm({
      title: "Clear your watch history?",
      message: "Every video you watched is removed from this list, and you lose the place you stopped in each one. This cannot be undone.",
      confirmLabel: "Clear history",
      variant: "destructive",
    })
    if (!ok) return
    setBusy("all")
    try {
      await api.delete("/api/video/me/history")
      await qc.invalidateQueries({ queryKey: ["history"] })
      toast.success("Watch history cleared")
    } catch (err) {
      toast.error(errText(err, "Your history could not be cleared."))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Panel
      title={total > 0 ? `Watch history · ${total}` : "Watch history"}
      action={rows.length > 0 ? <Btn tone="ghost" size="sm" onClick={clearAll} disabled={busy !== null}><Trash2 size={14} /> Clear all</Btn> : undefined}
    >
      {q.isLoading ? (
        <Skel className="h-40 w-full" />
      ) : rows.length === 0 ? (
        <Empty icon={<History size={28} />} title="Nothing watched yet" body="Videos you watch while signed in show up here so you can pick up where you left off." />
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
                    <p className="text-xs text-faint">{h.completed ? "Watched" : "In progress"}{h.watched_at ? ` · ${timeAgo(h.watched_at)}` : ""}</p>
                  </div>
                </Link>
                <button
                  type="button"
                  onClick={() => removeOne(h)}
                  disabled={busy !== null}
                  aria-label={`Remove ${h.title} from history`}
                  title="Remove from history"
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
                {q.isFetchingNextPage ? "Loading…" : "Show more"}
              </Btn>
            </div>
          )}
        </>
      )}
    </Panel>
  )
}

function PrivacyData({ onErased }: { onErased: () => void }) {
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
      toast.success("Your data was downloaded")
    } catch (err) {
      toast.error(errText(err, "Your data could not be exported."))
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
      toast.success("Your account was deleted")
      onErased()
    } catch (err) {
      if (errStatus(err) === 409) setBlocked(errText(err, "Cancel your paid plan before deleting the account."))
      else toast.error(errText(err, "Your account could not be deleted."))
    } finally {
      setErasing(false)
    }
  }

  return (
    <div className="space-y-5">
      <Panel title="Download my data">
        <p className="mb-4 max-w-2xl text-sm text-muted">
          A JSON file with your account, profile, channel, follows, likes, watch history, comments, danmaku, questions you asked videos, plans, payments, reports and appeals.
        </p>
        <Btn tone="soft" onClick={exportData} disabled={exporting}><Download size={15} /> {exporting ? "Preparing…" : "Download my data"}</Btn>
      </Panel>
      <Panel title="Delete my account">
        <div className="max-w-2xl space-y-3 text-sm text-muted">
          <p>Deleting your account signs you out for good. We erase your email, name, password and phone, your likes, follows, watch history and questions, and the text of your comments and danmaku.{me?.channel ? " Your channel is closed and its videos are removed." : ""}</p>
          <p>Invoices and payment records are kept for as long as tax law requires. Cancel any paid plan first.</p>
        </div>
        <form onSubmit={erase} className="mt-4 max-w-md space-y-3">
          <Field label="Type DELETE to confirm">
            <input className={INPUT} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} placeholder="DELETE" />
          </Field>
          {blocked && (
            <p role="alert" className="rounded-xl border border-[#f97316]/40 bg-[#7c2d12]/30 px-3 py-2 text-sm text-[#fed7aa]">
              {blocked} <Link to="/account?tab=plans" className="font-semibold underline">Go to plans</Link>
            </p>
          )}
          <Btn type="submit" tone="danger" disabled={typed !== "DELETE" || erasing}><UserX size={15} /> {erasing ? "Deleting…" : "Delete my account"}</Btn>
        </form>
      </Panel>
    </div>
  )
}

function Following() {
  const q = useQuery({ queryKey: ["following"], queryFn: () => getJson<ChannelCard[]>("/api/video/me/following") })
  return (
    <Panel title="Channels you follow">
      {q.isLoading ? (
        <Skel className="h-32 w-full" />
      ) : (q.data ?? []).length === 0 ? (
        <Empty icon={<Users size={28} />} title="You don't follow anyone yet" body="Follow channels to see their new videos in your Following feed." />
      ) : (
        <ul className="divide-y divide-line">
          {(q.data ?? []).map((c) => (
            <li key={c.id} className="flex items-center gap-3 py-3">
              <Link to={`/@${c.handle}`} className="flex min-w-0 flex-1 items-center gap-3">
                <ChannelAvatar channel={c} size={40} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{c.name}</p>
                  <p className="text-xs text-muted">@{c.handle} · {compactNumber(c.followers)} followers</p>
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
      toast.success("Appeal sent. We'll review it and let you know.")
      setAppealFor(null)
      setText("")
      qc.invalidateQueries({ queryKey: ["moderation"] })
    } catch (err) {
      toast.error(errText(err, "The appeal could not be sent."))
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
          <span className="block text-sm font-semibold">Copyright notices and counter-notices</span>
          <span className="block text-xs text-muted">See notices rights holders sent about your content and file a counter-notice.</span>
        </span>
        <ChevronRight size={18} className="shrink-0 text-muted" aria-hidden="true" />
      </Link>
      <Panel title="Moderation notices">
        {q.isLoading ? (
          <Skel className="h-24 w-full" />
        ) : !data || data.actions.length === 0 ? (
          <Empty icon={<ShieldAlert size={28} />} title="No notices" body="If our team ever takes action on something you posted, it shows up here and you can appeal." />
        ) : (
          <ul className="space-y-3">
            {data.actions.map((a) => (
              <li key={a.id} className="rounded-xl bg-panel-2 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-md bg-[#7c2d12]/60 px-2 py-0.5 text-xs font-semibold text-[#fed7aa]">{ACTION_LABELS[a.action] ?? a.action}</span>
                  <span className="text-sm font-semibold capitalize">{a.target_type} #{a.target_id}</span>
                  <span className="ml-auto text-xs text-faint">{timeAgo(a.created_at)}</span>
                </div>
                <p className="mt-2 text-sm text-ink/85">{a.reason}</p>
                {a.appeal ? (
                  <p className="mt-2 text-xs text-muted">Appeal: <span className="font-semibold capitalize text-ink">{a.appeal.status}</span>{a.appeal.note ? ` — ${a.appeal.note}` : ""}</p>
                ) : appealFor === a.id ? (
                  <form onSubmit={appeal} className="mt-3 space-y-2">
                    <textarea className={TEXTAREA} rows={4} minLength={10} maxLength={3000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Tell us why you think this was a mistake (at least 10 characters)." aria-label="Appeal" required />
                    <div className="flex justify-end gap-2">
                      <Btn tone="ghost" size="sm" onClick={() => setAppealFor(null)}>Cancel</Btn>
                      <Btn tone="brand" size="sm" type="submit" disabled={sending || text.trim().length < 10}>{sending ? "Sending…" : "Send appeal"}</Btn>
                    </div>
                  </form>
                ) : (
                  <Btn tone="soft" size="sm" className="mt-3" onClick={() => { setAppealFor(a.id); setText("") }}>Appeal</Btn>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {data && data.strikes.length > 0 && (
        <Panel title="Strikes">
          <ul className="divide-y divide-line">
            {data.strikes.map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-3 text-sm">
                <span className="flex-1">{s.reason}</span>
                <span className="text-xs text-muted">{s.lifted ? "Lifted" : `Expires ${longDate(s.expires_at)}`}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  )
}

export default function AccountPage() {
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
        <h1 className="flex-1 text-2xl font-bold">Account</h1>
        <Btn tone="ghost" size="sm" onClick={signOut}><LogOut size={15} /> Sign out</Btn>
      </div>
      <div role="tablist" className="-mx-3 mb-6 flex gap-1 overflow-x-auto px-3 scrollbar-none sm:mx-0 sm:px-0">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setParams({ tab: t.key }, { replace: true })}
            className={cn("h-9 shrink-0 rounded-full px-4 text-sm font-medium", tab === t.key ? "bg-snow text-black" : "bg-white/[0.07] hover:bg-white/15")}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "profile" && <Profile />}
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
