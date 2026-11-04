import { useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { ArrowDown, ArrowUp, ExternalLink, ListVideo, Plus, Search, X } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { fromMinor, useHasFeature } from "@klygenixvideo/client"
import { useHasPermission } from "../../lib/team"
import { ViewOnly } from "../team/ViewOnly"
import {
  Badge, Button, Card, Drawer, DrawerFooter, EmptyState, Field, Input, Select, Spinner, Textarea, useConfirm,
} from "@klygenixvideo/ui"
import { STUDIO } from "../../lib/hooks"
import { WEB_URL, detail, when } from "../../lib/format"
import type { Playlist, PlaylistDetail, PlaylistKind, PlaylistVisibility, StudioVideo, Visibility } from "../../lib/types"
import { VisibilityField } from "../VisibilityField"
import { inr, parseRupees, priceProblem, useEarnings } from "../earnings/shared"
import { useT } from "../../i18n"

const KIND_OPTIONS = [
  { value: "playlist", label: "Playlist", hint: "Any videos, in any order" },
  { value: "series", label: "Series", hint: "Watched in order; viewers see their progress" },
]

const VISIBILITY_LABEL: Record<PlaylistVisibility, string> = { public: "Public", unlisted: "Unlisted", private: "Private" }

const playlistUrl = (id: number) => `${WEB_URL.replace(/\/$/, "")}/playlist/${id}`

function Cover({ src, className }: { src: string | null; className?: string }) {
  return (
    <div className={`relative aspect-video shrink-0 overflow-hidden rounded-md bg-slate-100 ${className ?? ""}`}>
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-slate-400"><ListVideo size={20} /></div>
      )}
    </div>
  )
}

export function Playlists() {
  const t = useT()
  const [open, setOpen] = useState<Playlist | "new" | null>(null)
  const canEdit = useHasPermission("video.channels", "full")
  const { data: rows, isLoading } = useQuery({
    queryKey: ["studio-playlists"],
    queryFn: async () => (await api.get<Playlist[]>(`${STUDIO}/playlists`)).data,
  })

  return (
    <>
      <Card className="p-0">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-sm font-bold text-navy">{t("Playlists and series")}</h2>
            <p className="mt-0.5 text-sm text-slate-500">{t("Group your videos. A series is watched in order, and signed-in viewers see how far they got.")}</p>
          </div>
          {canEdit && <Button size="sm" onClick={() => setOpen("new")}><Plus size={14} /> {t("New playlist")}</Button>}
        </div>
        {isLoading ? (
          <Spinner />
        ) : (rows ?? []).length === 0 ? (
          <div className="p-5">
            <EmptyState title={t("No playlists yet")} hint={t("Public playlists with at least one published video show on your channel page.")} />
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {(rows ?? []).map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => setOpen(p)}
                  className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none">
                  <Cover src={p.cover} className="w-24 sm:w-32" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-800">{p.title}</p>
                    {p.description && <p className="truncate text-xs text-slate-500">{p.description}</p>}
                    <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                      <Badge color={p.kind === "series" ? "brand" : "slate"}>{p.kind === "series" ? t("Series") : t("Playlist")}</Badge>
                      <Badge color={p.visibility === "public" ? "green" : p.visibility === "unlisted" ? "blue" : "amber"}>{t(VISIBILITY_LABEL[p.visibility])}</Badge>
                      {p.kind === "series" && p.price_minor ? <Badge color="purple">{inr(p.price_minor)}</Badge> : null}
                      <span>{p.video_count === 1 ? t("1 video") : t("{n} videos", { n: p.video_count })}</span>
                      <span>{t("· created {when}", { when: when(p.created_at) })}</span>
                    </p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {open !== null && (
        <PlaylistDrawer key={open === "new" ? "new" : open.id} initial={open === "new" ? null : open} onClose={() => setOpen(null)} />
      )}
    </>
  )
}

function PlaylistDrawer({ initial, onClose }: { initial: Playlist | null; onClose: () => void }) {
  const t = useT()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [current, setCurrent] = useState<Playlist | null>(initial)
  const [title, setTitle] = useState(initial?.title ?? "")
  const [description, setDescription] = useState(initial?.description ?? "")
  const [kind, setKind] = useState<PlaylistKind>(initial?.kind ?? "playlist")
  const [visibility, setVisibility] = useState<PlaylistVisibility>(initial?.visibility ?? "public")
  const [busy, setBusy] = useState<"save" | "delete" | null>(null)
  const canEdit = useHasPermission("video.channels", "full")

  async function save() {
    setBusy("save")
    const body = { title: title.trim(), description, kind, visibility }
    try {
      if (current) {
        const { data } = await api.patch<Playlist>(`${STUDIO}/playlists/${current.id}`, body)
        setCurrent(data)
        toast.success(t("Playlist saved"))
      } else {
        const { data } = await api.post<Playlist>(`${STUDIO}/playlists`, body)
        setCurrent(data)
        toast.success(t("Created. Now add videos to it."))
      }
      qc.invalidateQueries({ queryKey: ["studio-playlists"] })
    } catch (err) {
      toast.error(detail(err, t("Could not save the playlist")))
    } finally {
      setBusy(null)
    }
  }

  async function remove() {
    if (!current) return
    const ok = await confirm({
      title: t("Delete “{title}”?", { title: current.title }),
      message: t("The playlist goes for good. The videos in it stay on your channel."),
      confirmLabel: t("Delete"),
      variant: "destructive",
    })
    if (!ok) return
    setBusy("delete")
    try {
      await api.delete(`${STUDIO}/playlists/${current.id}`)
      toast.success(t("Playlist deleted"))
      qc.invalidateQueries({ queryKey: ["studio-playlists"] })
      onClose()
    } catch (err) {
      toast.error(detail(err, t("Could not delete the playlist")))
      setBusy(null)
    }
  }

  const dirty = !current || title.trim() !== current.title || description !== current.description || kind !== current.kind || visibility !== current.visibility

  return (
    <Drawer
      open
      onClose={onClose}
      width="lg"
      title={current ? current.title : t("New playlist")}
      subtitle={current ? (
        <a href={playlistUrl(current.id)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand hover:underline">
          {t("View on Klygenix Play")} <ExternalLink size={12} />
        </a>
      ) : t("Give it a name. You add videos after it is created.")}
      footer={
        <DrawerFooter
          destructive={current && canEdit ? { label: t("Delete"), onClick: remove, pending: busy === "delete", disabled: busy !== null } : undefined}
          onCancel={onClose}
          cancelLabel={current ? t("Close") : t("Cancel")}
          save={canEdit ? { label: current ? t("Save") : t("Create"), onClick: save, pending: busy === "save", disabled: busy !== null || !title.trim() || !dirty } : undefined}
        />
      }
    >
      {!canEdit && <ViewOnly className="mb-4" />}
      <fieldset disabled={!canEdit} className="m-0 min-w-0 space-y-4 border-0 p-0">
        <Field label={t("Title")} required>
          <Input value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label={t("Description")}>
          <Textarea rows={3} value={description} maxLength={5000} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label={t("Kind")}>
          <Select value={kind} onChange={(v) => setKind(v as PlaylistKind)} options={KIND_OPTIONS.map((o) => ({ ...o, label: t(o.label), hint: t(o.hint) }))} aria-label={t("Kind")} />
        </Field>
        <Field label={t("Visibility")}>
          <VisibilityField schedule={false} value={visibility as Visibility} publishAt="" onPublishAt={() => undefined}
            onChange={(v) => setVisibility(v as PlaylistVisibility)} />
        </Field>
        {current && current.kind === "series" && <SeriesPrice playlist={current} onSaved={(price_minor) => setCurrent({ ...current, price_minor })} />}
        {current && <Items playlistId={current.id} />}
      </fieldset>
    </Drawer>
  )
}

function Items({ playlistId }: { playlistId: number }) {
  const t = useT()
  const qc = useQueryClient()
  const [search, setSearch] = useState("")
  const [busy, setBusy] = useState(false)
  const key = ["studio-playlist", playlistId]
  const { data: playlist, isLoading } = useQuery({
    queryKey: key,
    queryFn: async () => (await api.get<PlaylistDetail>(`/api/video/playlists/${playlistId}`)).data,
  })
  const { data: videos } = useQuery({
    queryKey: ["studio-videos", "playlist-picker"],
    queryFn: async () => (await api.get<StudioVideo[]>(`${STUDIO}/videos?limit=100`)).data,
  })
  const byPublic = useMemo(() => new Map((videos ?? []).map((v) => [v.public_id, v])), [videos])
  const items = (playlist?.videos ?? []).map((card) => ({ card, video: byPublic.get(card.id) }))
  const inList = new Set(items.map((i) => i.card.id))
  const needle = search.trim().toLowerCase()
  const candidates = (videos ?? [])
    .filter((v) => !inList.has(v.public_id) && !["failed", "blocked"].includes(v.status))
    .filter((v) => !needle || v.title.toLowerCase().includes(needle))

  async function run(action: () => Promise<unknown>, fallback: string) {
    setBusy(true)
    try {
      await action()
    } catch (err) {
      toast.error(detail(err, fallback))
    } finally {
      await qc.invalidateQueries({ queryKey: key })
      qc.invalidateQueries({ queryKey: ["studio-playlists"] })
      setBusy(false)
    }
  }

  function move(index: number, step: -1 | 1) {
    const ids = items.map((i) => i.video?.id)
    const target = index + step
    if (target < 0 || target >= ids.length || ids.some((id) => id === undefined) || !playlist) return
    const order = [...ids] as number[]
    ;[order[index], order[target]] = [order[target], order[index]]
    const cards = [...playlist.videos]
    ;[cards[index], cards[target]] = [cards[target], cards[index]]
    qc.setQueryData<PlaylistDetail>(key, { ...playlist, videos: cards })
    run(() => api.put(`${STUDIO}/playlists/${playlistId}/order`, { video_ids: order }), t("Could not save the new order"))
  }

  return (
    <div className="space-y-3 border-t border-slate-100 pt-4">
      <div>
        <h3 className="text-sm font-bold text-navy">{t("Videos")}</h3>
        <p className="text-xs text-slate-500">{t("Viewers see only the published public and unlisted ones, in this order.")}</p>
      </div>
      {isLoading ? (
        <Spinner />
      ) : items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-sm text-slate-500">{t("No videos in it yet. Add some below.")}</p>
      ) : (
        <ol className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {items.map(({ card, video }, i) => (
            <li key={card.id} className="flex items-center gap-2 px-2 py-2 sm:gap-3 sm:px-3">
              <span className="w-5 shrink-0 text-center font-num text-xs text-slate-400">{i + 1}</span>
              <Cover src={card.thumbnail} className="w-14 sm:w-20" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-800">{card.title}</p>
                <p className="flex flex-wrap items-center gap-1 text-xs text-slate-500">
                  <span>{card.kind === "reel" ? t("Reel") : card.duration}</span>
                  {video && (video.status !== "published" || video.visibility === "private" || video.visibility === "scheduled") && (
                    <Badge color="amber">{t("Not shown to viewers")}</Badge>
                  )}
                </p>
              </div>
              <div className="flex shrink-0 items-center">
                <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={t("Move {title} up", { title: card.title })} disabled={busy || i === 0} onClick={() => move(i, -1)}>
                  <ArrowUp size={15} />
                </Button>
                <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={t("Move {title} down", { title: card.title })} disabled={busy || i === items.length - 1} onClick={() => move(i, 1)}>
                  <ArrowDown size={15} />
                </Button>
                <Button size="icon" variant="ghost" className="h-8 w-8 text-red-600" aria-label={t("Remove {title}", { title: card.title })} disabled={busy || !video}
                  onClick={() => video && run(() => api.delete(`${STUDIO}/playlists/${playlistId}/items/${video.id}`), t("Could not remove it"))}>
                  <X size={15} />
                </Button>
              </div>
            </li>
          ))}
        </ol>
      )}
      <div className="space-y-2 rounded-lg bg-slate-50 p-3">
        <label className="flex items-center gap-2">
          <Search size={15} className="shrink-0 text-slate-400" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("Find one of your videos to add")} aria-label={t("Find a video to add")} />
        </label>
        {candidates.length === 0 ? (
          <p className="px-1 text-xs text-slate-500">{needle ? t("No video matches that.") : t("Every video you have is already in it.")}</p>
        ) : (
          <ul className="max-h-64 space-y-1 overflow-y-auto">
            {candidates.slice(0, 30).map((v) => (
              <li key={v.id} className="flex items-center gap-2 rounded-md bg-white px-2 py-1.5">
                <Cover src={v.thumbnail} className="w-16" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-slate-800">{v.title}</p>
                  <p className="text-xs text-slate-500">{v.kind === "reel" ? t("Reel") : t("Video")} · {v.status === "published" ? (v.visibility === "public" ? t("Public") : t(v.visibility)) : t(v.status.replace("_", " "))}</p>
                </div>
                <Button size="sm" variant="outline" disabled={busy}
                  onClick={() => run(() => api.post(`${STUDIO}/playlists/${playlistId}/items`, { video_id: v.id }), t("Could not add it"))}>
                  <Plus size={13} /> {t("Add")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function SeriesPrice({ playlist, onSaved }: { playlist: Playlist; onSaved: (price: number | null) => void }) {
  const t = useT()
  const featureOn = useHasFeature("video.earnings")
  const canView = useHasPermission("video.earnings")
  const canEdit = useHasPermission("video.earnings", "full")
  const qc = useQueryClient()
  const { data: earnings } = useEarnings(featureOn && canView)
  const [price, setPrice] = useState(playlist.price_minor ? fromMinor(playlist.price_minor) : "")
  const [busy, setBusy] = useState(false)
  if (!featureOn || !canView) return null

  const canSell = Boolean(earnings?.can_take_money)
  const minor = price.trim() ? parseRupees(price) : null
  const error = price.trim() ? priceProblem(minor) ?? undefined : undefined
  const dirty = (minor ?? null) !== (playlist.price_minor ?? null)

  async function save() {
    setBusy(true)
    try {
      const { data } = await api.put<{ id: number; price_minor: number | null }>(`${STUDIO}/playlists/${playlist.id}/price`, { price_minor: minor })
      onSaved(data.price_minor)
      toast.success(data.price_minor ? t("Series priced at {price}", { price: inr(data.price_minor) }) : t("The series is free again"))
      qc.invalidateQueries({ queryKey: ["studio-playlists"] })
    } catch (err) {
      toast.error(detail(err, t("Could not save the price")))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-slate-200 p-3">
      <div className="flex flex-wrap items-end gap-2">
        <Field label={t("Price for the whole series (₹)")} error={error} hint={t("Leave empty to keep it free. Between ₹10 and ₹50,000.")} className="min-w-0 flex-1">
          <Input value={price} inputMode="decimal" onChange={(e) => setPrice(e.target.value)} disabled={!canEdit || (!canSell && !playlist.price_minor)} />
        </Field>
        {canEdit && (
          <Button variant="outline" onClick={save} disabled={busy || !dirty || Boolean(error) || (minor !== null && !canSell)} className="mb-5">
            {busy ? t("Saving…") : t("Save price")}
          </Button>
        )}
      </div>
      {!canSell && (
        <p className="text-xs text-amber-800">{t("Selling a series is off until your payouts are active. Set them up under Earnings.")}</p>
      )}
    </div>
  )
}
