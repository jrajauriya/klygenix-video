import { useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { ArrowDown, ArrowUp, ExternalLink, ListVideo, Plus, Search, X } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import {
  Badge, Button, Card, Drawer, DrawerFooter, EmptyState, Field, Input, Select, Spinner, Textarea, useConfirm,
} from "@klygenixvideo/ui"
import { STUDIO } from "../../lib/hooks"
import { WEB_URL, detail, when } from "../../lib/format"
import type { Playlist, PlaylistDetail, PlaylistKind, PlaylistVisibility, StudioVideo, Visibility } from "../../lib/types"
import { VisibilityField } from "../VisibilityField"

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
  const [open, setOpen] = useState<Playlist | "new" | null>(null)
  const { data: rows, isLoading } = useQuery({
    queryKey: ["studio-playlists"],
    queryFn: async () => (await api.get<Playlist[]>(`${STUDIO}/playlists`)).data,
  })

  return (
    <>
      <Card className="p-0">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-sm font-bold text-navy">Playlists and series</h2>
            <p className="mt-0.5 text-sm text-slate-500">Group your videos. A series is watched in order, and signed-in viewers see how far they got.</p>
          </div>
          <Button size="sm" onClick={() => setOpen("new")}><Plus size={14} /> New playlist</Button>
        </div>
        {isLoading ? (
          <Spinner />
        ) : (rows ?? []).length === 0 ? (
          <div className="p-5">
            <EmptyState title="No playlists yet" hint="Public playlists with at least one published video show on your channel page." />
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
                      <Badge color={p.kind === "series" ? "brand" : "slate"}>{p.kind === "series" ? "Series" : "Playlist"}</Badge>
                      <Badge color={p.visibility === "public" ? "green" : p.visibility === "unlisted" ? "blue" : "amber"}>{VISIBILITY_LABEL[p.visibility]}</Badge>
                      <span>{p.video_count} {p.video_count === 1 ? "video" : "videos"}</span>
                      <span>· created {when(p.created_at)}</span>
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
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [current, setCurrent] = useState<Playlist | null>(initial)
  const [title, setTitle] = useState(initial?.title ?? "")
  const [description, setDescription] = useState(initial?.description ?? "")
  const [kind, setKind] = useState<PlaylistKind>(initial?.kind ?? "playlist")
  const [visibility, setVisibility] = useState<PlaylistVisibility>(initial?.visibility ?? "public")
  const [busy, setBusy] = useState<"save" | "delete" | null>(null)

  async function save() {
    setBusy("save")
    const body = { title: title.trim(), description, kind, visibility }
    try {
      if (current) {
        const { data } = await api.patch<Playlist>(`${STUDIO}/playlists/${current.id}`, body)
        setCurrent(data)
        toast.success("Playlist saved")
      } else {
        const { data } = await api.post<Playlist>(`${STUDIO}/playlists`, body)
        setCurrent(data)
        toast.success("Created. Now add videos to it.")
      }
      qc.invalidateQueries({ queryKey: ["studio-playlists"] })
    } catch (err) {
      toast.error(detail(err, "Could not save the playlist"))
    } finally {
      setBusy(null)
    }
  }

  async function remove() {
    if (!current) return
    const ok = await confirm({
      title: `Delete “${current.title}”?`,
      message: "The playlist goes for good. The videos in it stay on your channel.",
      confirmLabel: "Delete",
      variant: "destructive",
    })
    if (!ok) return
    setBusy("delete")
    try {
      await api.delete(`${STUDIO}/playlists/${current.id}`)
      toast.success("Playlist deleted")
      qc.invalidateQueries({ queryKey: ["studio-playlists"] })
      onClose()
    } catch (err) {
      toast.error(detail(err, "Could not delete the playlist"))
      setBusy(null)
    }
  }

  const dirty = !current || title.trim() !== current.title || description !== current.description || kind !== current.kind || visibility !== current.visibility

  return (
    <Drawer
      open
      onClose={onClose}
      width="lg"
      title={current ? current.title : "New playlist"}
      subtitle={current ? (
        <a href={playlistUrl(current.id)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand hover:underline">
          View on Klygenix Play <ExternalLink size={12} />
        </a>
      ) : "Give it a name. You add videos after it is created."}
      footer={
        <DrawerFooter
          destructive={current ? { label: "Delete", onClick: remove, pending: busy === "delete", disabled: busy !== null } : undefined}
          onCancel={onClose}
          cancelLabel={current ? "Close" : "Cancel"}
          save={{ label: current ? "Save" : "Create", onClick: save, pending: busy === "save", disabled: busy !== null || !title.trim() || !dirty }}
        />
      }
    >
      <div className="space-y-4">
        <Field label="Title" required>
          <Input value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Description">
          <Textarea rows={3} value={description} maxLength={5000} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="Kind">
          <Select value={kind} onChange={(v) => setKind(v as PlaylistKind)} options={KIND_OPTIONS} aria-label="Kind" />
        </Field>
        <Field label="Visibility">
          <VisibilityField schedule={false} value={visibility as Visibility} publishAt="" onPublishAt={() => undefined}
            onChange={(v) => setVisibility(v as PlaylistVisibility)} />
        </Field>
        {current && <Items playlistId={current.id} />}
      </div>
    </Drawer>
  )
}

function Items({ playlistId }: { playlistId: number }) {
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
    run(() => api.put(`${STUDIO}/playlists/${playlistId}/order`, { video_ids: order }), "Could not save the new order")
  }

  return (
    <div className="space-y-3 border-t border-slate-100 pt-4">
      <div>
        <h3 className="text-sm font-bold text-navy">Videos</h3>
        <p className="text-xs text-slate-500">Viewers see only the published public and unlisted ones, in this order.</p>
      </div>
      {isLoading ? (
        <Spinner />
      ) : items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-sm text-slate-500">No videos in it yet. Add some below.</p>
      ) : (
        <ol className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {items.map(({ card, video }, i) => (
            <li key={card.id} className="flex items-center gap-2 px-2 py-2 sm:gap-3 sm:px-3">
              <span className="w-5 shrink-0 text-center font-num text-xs text-slate-400">{i + 1}</span>
              <Cover src={card.thumbnail} className="w-14 sm:w-20" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-800">{card.title}</p>
                <p className="flex flex-wrap items-center gap-1 text-xs text-slate-500">
                  <span>{card.kind === "reel" ? "Reel" : card.duration}</span>
                  {video && (video.status !== "published" || video.visibility === "private" || video.visibility === "scheduled") && (
                    <Badge color="amber">Not shown to viewers</Badge>
                  )}
                </p>
              </div>
              <div className="flex shrink-0 items-center">
                <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Move ${card.title} up`} disabled={busy || i === 0} onClick={() => move(i, -1)}>
                  <ArrowUp size={15} />
                </Button>
                <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Move ${card.title} down`} disabled={busy || i === items.length - 1} onClick={() => move(i, 1)}>
                  <ArrowDown size={15} />
                </Button>
                <Button size="icon" variant="ghost" className="h-8 w-8 text-red-600" aria-label={`Remove ${card.title}`} disabled={busy || !video}
                  onClick={() => video && run(() => api.delete(`${STUDIO}/playlists/${playlistId}/items/${video.id}`), "Could not remove it")}>
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
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find one of your videos to add" aria-label="Find a video to add" />
        </label>
        {candidates.length === 0 ? (
          <p className="px-1 text-xs text-slate-500">{needle ? "No video matches that." : "Every video you have is already in it."}</p>
        ) : (
          <ul className="max-h-64 space-y-1 overflow-y-auto">
            {candidates.slice(0, 30).map((v) => (
              <li key={v.id} className="flex items-center gap-2 rounded-md bg-white px-2 py-1.5">
                <Cover src={v.thumbnail} className="w-16" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-slate-800">{v.title}</p>
                  <p className="text-xs text-slate-500">{v.kind === "reel" ? "Reel" : "Video"} · {v.status === "published" ? (v.visibility === "public" ? "Public" : v.visibility) : v.status.replace("_", " ")}</p>
                </div>
                <Button size="sm" variant="outline" disabled={busy}
                  onClick={() => run(() => api.post(`${STUDIO}/playlists/${playlistId}/items`, { video_id: v.id }), "Could not add it")}>
                  <Plus size={13} /> Add
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
