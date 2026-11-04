import { useMemo, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { CalendarClock, ChevronLeft, ChevronRight, Clapperboard, PlaySquare, X } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { Button, Card, DataTable, Field, Input, Modal, PageHeader, StatusPill, cn, useConfirm } from "@klygenixvideo/ui"
import { useHasPermission } from "@klygenixvideo/client"
import { STUDIO } from "../lib/hooks"
import { TZ, detail, fromLocalInput, toLocalInput, when } from "../lib/format"
import type { CalendarItem } from "../lib/types"
import { useLang, useT } from "../i18n"

const TARGET: Record<string, { label: string; hex: string }> = {
  play: { label: "Klygenix Play", hex: "#86198f" },
  youtube: { label: "YouTube Shorts", hex: "#b91c1c" },
  instagram: { label: "Instagram Reels", hex: "#9d174d" },
}

const STATUS: Record<string, { label: string; hex: string }> = {
  scheduled: { label: "Scheduled", hex: "#92400e" },
  queued: { label: "Queued", hex: "#1d4ed8" },
  publishing: { label: "Publishing", hex: "#6d28d9" },
  processing: { label: "Encoding", hex: "#1d4ed8" },
  scanning: { label: "Safety check", hex: "#6d28d9" },
  in_review: { label: "In review", hex: "#92400e" },
  published: { label: "Published", hex: "#166534" },
  failed: { label: "Failed", hex: "#b91c1c" },
  blocked: { label: "Blocked", hex: "#b91c1c" },
  cancelled: { label: "Cancelled", hex: "#475569" },
  uploading: { label: "Uploading", hex: "#475569" },
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

const istDay = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso))

const istTime = (iso: string) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(new Date(iso))

function thisMonth(): string {
  return istDay(new Date().toISOString()).slice(0, 7)
}

function shift(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number)
  const d = new Date(Date.UTC(y, m - 1 + by, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
}

function grid(month: string): string[] {
  const [y, m] = month.split("-").map(Number)
  const first = new Date(Date.UTC(y, m - 1, 1))
  const lead = (first.getUTCDay() + 6) % 7
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const count = Math.ceil((lead + days) / 7) * 7
  return Array.from({ length: count }, (_, i) => new Date(Date.UTC(y, m - 1, 1 - lead + i)).toISOString().slice(0, 10))
}

const istMidnight = (day: string) => new Date(`${day}T00:00:00+05:30`).toISOString()

const itemKey = (i: CalendarItem) => `${i.type}-${i.id}`

function ItemIcon({ item }: { item: CalendarItem }) {
  return item.type === "video" ? <PlaySquare size={12} aria-hidden="true" /> : <Clapperboard size={12} aria-hidden="true" />
}

export default function Calendar() {
  const t = useT()
  const lang = useLang()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const canVideos = useHasPermission("video.uploads", "full")
  const canClips = useHasPermission("video.clips", "full")
  const [params, setParams] = useSearchParams()
  const month = /^\d{4}-\d{2}$/.test(params.get("month") ?? "") ? params.get("month")! : thisMonth()
  const days = useMemo(() => grid(month), [month])
  const from = istMidnight(days[0])
  const to = istMidnight(new Date(Date.parse(`${days[days.length - 1]}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10))
  const key = ["studio-calendar", from, to]
  const { data, isLoading, isError } = useQuery({
    queryKey: key,
    queryFn: async () => (await api.get<{ items: CalendarItem[] }>(`${STUDIO}/calendar`, { params: { from, to } })).data.items,
  })
  const [editing, setEditing] = useState<CalendarItem | null>(null)
  const [at, setAt] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const today = istDay(new Date().toISOString())

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarItem[]>()
    for (const i of data ?? []) {
      if (!i.at) continue
      const d = istDay(i.at)
      map.set(d, [...(map.get(d) ?? []), i])
    }
    return map
  }, [data])

  const inMonth = (data ?? []).filter((i) => i.at && istDay(i.at).startsWith(month))
  const upcoming = inMonth.filter((i) => i.status === "scheduled").length

  const monthLabel = new Date(`${month}-01T00:00:00Z`).toLocaleDateString(lang === "hi" ? "hi-IN" : "en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  })

  const canChange = (i: CalendarItem) => i.status === "scheduled" && (i.type === "video" ? canVideos : canClips)
  const go = (by: number) => setParams({ month: shift(month, by) }, { replace: true })
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["studio-calendar"] })
    qc.invalidateQueries({ queryKey: ["studio-videos"] })
  }

  function open(i: CalendarItem) {
    setEditing(i)
    setAt(toLocalInput(i.at))
  }

  async function reschedule() {
    if (!editing) return
    const iso = fromLocalInput(at)
    if (!iso || new Date(iso).getTime() <= Date.now()) {
      toast.error(t("Pick a time in the future."))
      return
    }
    setBusy("save")
    try {
      if (editing.type === "video") {
        await api.patch(`${STUDIO}/videos/${editing.id}`, { visibility: "scheduled", publish_at: iso })
      } else {
        await api.patch(`${STUDIO}/calendar/targets/${editing.id}`, { scheduled_at: iso })
      }
      toast.success(t("Rescheduled for {when}", { when: when(iso, true) }))
      setEditing(null)
      refresh()
    } catch (err) {
      toast.error(detail(err, t("Could not reschedule")))
    } finally {
      setBusy(null)
    }
  }

  async function cancel(i: CalendarItem) {
    const ok = await confirm({
      title: t("Cancel this post?"),
      message: t("The clip will not be posted to {where}. You can send it again from the clip later.", { where: t(TARGET[i.target]?.label ?? i.target) }),
      confirmLabel: t("Cancel post"),
      variant: "destructive",
    })
    if (!ok) return
    setBusy(itemKey(i))
    try {
      await api.patch(`${STUDIO}/calendar/targets/${i.id}`, { cancel: true })
      toast.success(t("Post cancelled"))
      setEditing(null)
      refresh()
    } catch (err) {
      toast.error(detail(err, t("Could not cancel the post")))
    } finally {
      setBusy(null)
    }
  }

  const link = (i: CalendarItem) => (i.type === "video" ? `/videos/${i.id}` : `/clips/${i.clip_id}`)

  return (
    <div className="pb-8">
      <PageHeader
        title={t("Calendar")}
        subtitle={t("Scheduled videos and clip posts to Play, YouTube and Instagram, in India time.")}
        actions={
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" aria-label={t("Previous month")} onClick={() => go(-1)}><ChevronLeft size={15} /></Button>
            <Button variant="outline" size="sm" onClick={() => setParams({}, { replace: true })} disabled={month === thisMonth()}>{t("Today")}</Button>
            <Button variant="outline" size="sm" aria-label={t("Next month")} onClick={() => go(1)}><ChevronRight size={15} /></Button>
          </div>
        }
      />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold text-navy" aria-live="polite">{monthLabel}</h2>
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
          {Object.entries(TARGET).map(([k, v]) => (
            <span key={k} className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: v.hex }} aria-hidden="true" /> {t(v.label)}
            </span>
          ))}
          <span>{upcoming === 1 ? t("1 scheduled") : t("{n} scheduled", { n: upcoming })}</span>
        </div>
      </div>

      {isError && <p role="alert" className="mb-3 text-sm text-red-700">{t("The calendar could not be loaded.")}</p>}

      <Card className="overflow-hidden p-0">
        <div className="hidden grid-cols-7 border-b border-slate-200 bg-slate-50 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-500 md:grid" aria-hidden="true">
          {WEEKDAYS.map((d) => <div key={d} className="py-1.5">{t(d)}</div>)}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-7">
          {days.map((d) => {
            const items = byDay.get(d) ?? []
            const outside = !d.startsWith(month)
            if (outside && items.length === 0) return <div key={d} className="hidden min-h-24 border-b border-r border-slate-100 bg-slate-50/60 md:block" aria-hidden="true" />
            return (
              <div
                key={d}
                className={cn(
                  "min-h-24 border-b border-r border-slate-100 p-1.5",
                  outside && "bg-slate-50/60",
                  items.length === 0 && "hidden md:block",
                )}
              >
                <p className={cn("mb-1 text-xs font-semibold", d === today ? "text-brand" : "text-slate-500")}>
                  <span className="md:hidden">{when(d)}</span>
                  <span className="hidden md:inline">{Number(d.slice(8))}</span>
                  {d === today && <span className="sr-only"> ({t("today")})</span>}
                </p>
                <ul className="space-y-1">
                  {items.map((i) => {
                    const tone = TARGET[i.target] ?? { label: i.target, hex: "#475569" }
                    const label = `${i.at ? istTime(i.at) : ""} ${i.title} · ${t(tone.label)} · ${t(STATUS[i.status]?.label ?? i.status)}`
                    const body = (
                      <>
                        <ItemIcon item={i} />
                        <span className="font-num">{i.at ? istTime(i.at) : ""}</span>
                        <span className="truncate">{i.title}</span>
                        <span className="sr-only">{` · ${t(tone.label)} · ${t(STATUS[i.status]?.label ?? i.status)}`}</span>
                      </>
                    )
                    const cls = cn(
                      "flex w-full items-center gap-1 rounded px-1.5 py-0.5 text-left text-[11px] font-medium text-white hover:opacity-90",
                      (i.status === "cancelled" || i.status === "failed") && "line-through opacity-75",
                    )
                    return (
                      <li key={itemKey(i)}>
                        {canChange(i) ? (
                          <button type="button" onClick={() => open(i)} className={cls} style={{ background: tone.hex }} title={label}>
                            {body}
                          </button>
                        ) : (
                          <Link to={link(i)} className={cls} style={{ background: tone.hex }} title={label}>
                            {body}
                          </Link>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>
            )
          })}
        </div>
      </Card>

      <div className="mt-5">
        <DataTable
          label={t("This month")}
          loading={isLoading}
          rows={inMonth}
          rowKey={itemKey}
          unitLabel={t("posts")}
          emptyTitle={t("Nothing planned this month")}
          emptyDescription={t("Schedule a video from its Details tab, or a clip post from the clip editor.")}
          columns={[
            { key: "at", header: t("When"), render: (i) => <span className="whitespace-nowrap font-num">{i.at ? when(i.at, true) : "—"}</span> },
            {
              key: "title",
              header: t("What"),
              render: (i) => (
                <Link to={link(i)} className="inline-flex max-w-xs items-center gap-1.5 font-medium text-navy hover:text-brand">
                  <ItemIcon item={i} /> <span className="truncate">{i.title}</span>
                </Link>
              ),
            },
            {
              key: "target",
              header: t("Where"),
              render: (i) => <span className="whitespace-nowrap text-slate-700">{t(TARGET[i.target]?.label ?? i.target)}</span>,
            },
            {
              key: "status",
              header: t("Status"),
              render: (i) => {
                const s = STATUS[i.status] ?? { label: i.status.replace(/_/g, " "), hex: "#475569" }
                return (
                  <span className="inline-flex flex-col gap-0.5">
                    <StatusPill label={t(s.label)} hex={s.hex} />
                    {i.error && <span className="text-xs text-red-700">{i.error}</span>}
                  </span>
                )
              },
            },
            {
              key: "actions",
              header: "",
              align: "right",
              render: (i) =>
                canChange(i) ? (
                  <span className="inline-flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => open(i)} disabled={busy !== null}>
                      <CalendarClock size={13} /> {t("Reschedule")}
                    </Button>
                    {i.type === "clip" && (
                      <Button size="sm" variant="ghost" className="text-red-700" onClick={() => cancel(i)} disabled={busy !== null}>
                        <X size={13} /> {t("Cancel")}
                      </Button>
                    )}
                  </span>
                ) : null,
            },
          ]}
        />
      </div>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={t("Reschedule")}
        footer={
          <div className="flex flex-wrap justify-between gap-2">
            {editing?.type === "clip" ? (
              <Button variant="ghost" className="text-red-700" onClick={() => editing && cancel(editing)} disabled={busy !== null}>
                <X size={14} /> {t("Cancel post")}
              </Button>
            ) : <span />}
            <span className="flex gap-2">
              <Button variant="outline" onClick={() => setEditing(null)}>{t("Close")}</Button>
              <Button onClick={reschedule} disabled={busy !== null || !at}>{busy === "save" ? t("Saving…") : t("Save new time")}</Button>
            </span>
          </div>
        }
      >
        {editing && (
          <div className="space-y-3">
            <p className="text-sm text-slate-700">
              <span className="font-semibold text-navy">{editing.title}</span> · {t(TARGET[editing.target]?.label ?? editing.target)}
            </p>
            <Field label={t("Publish at")} hint={t("Your device's time zone.")}>
              <Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
            </Field>
            <Link to={link(editing)} className="text-sm font-semibold text-brand hover:underline">
              {editing.type === "video" ? t("Open the video") : t("Open the clip")}
            </Link>
          </div>
        )}
      </Modal>
    </div>
  )
}
