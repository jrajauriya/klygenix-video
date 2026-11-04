import { Link } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Bell, CheckCheck, CheckCircle2, Crown, Handshake, MessageCircle, Radio, Scissors, Video } from "lucide-react"
import { cn } from "@klygenixvideo/ui"
import { errText, getJson } from "../lib/api"
import { timeAgo } from "../lib/format"
import { INBOX_APP, markAllRead, useOpenNote, type Inbox, type Note } from "../lib/inbox"
import { useT } from "../i18n"
import { Btn, Empty, Skel } from "./bits"

const ICONS: Record<string, typeof Bell> = {
  new_video: Video, reply: MessageCircle, published: CheckCircle2, render_ready: Scissors, live: Radio, membership: Crown, deal: Handshake,
}

export function NoteRow({ note, onOpen }: { note: Note; onOpen: (n: Note) => void }) {
  const t = useT("account")
  const Icon = ICONS[note.kind] ?? Bell
  return (
    <button
      type="button"
      onClick={() => onOpen(note)}
      className={cn("flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-white/[0.06]", !note.read && "bg-brand/[0.08]")}
    >
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/10 text-brand-soft">
        {note.image ? <img src={note.image} alt="" className="h-full w-full object-cover" loading="lazy" /> : <Icon size={17} aria-hidden="true" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("line-clamp-2 text-sm", note.read ? "text-ink/85" : "font-semibold text-ink")}>{note.title}</span>
        {note.body && <span className="mt-0.5 line-clamp-2 block text-xs text-muted">{note.body}</span>}
        <span className="mt-1 block text-xs text-faint">{timeAgo(note.created_at)}</span>
      </span>
      {!note.read && (
        <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-brand-soft">
          <span className="sr-only">{t("Unread")}</span>
        </span>
      )}
    </button>
  )
}

export function MarkAllRead({ disabled }: { disabled?: boolean }) {
  const t = useT("account")
  const qc = useQueryClient()
  async function run() {
    try {
      await markAllRead(qc)
    } catch (err) {
      toast.error(errText(err, t("Notifications could not be marked as read.")))
    }
  }
  return (
    <Btn tone="ghost" size="sm" onClick={run} disabled={disabled}>
      <CheckCheck size={15} aria-hidden="true" /> {t("Mark all read")}
    </Btn>
  )
}

export default function InboxPanel({ onClose }: { onClose: () => void }) {
  const t = useT("account")
  const open = useOpenNote()
  const q = useQuery({ queryKey: ["inbox", "panel"], queryFn: () => getJson<Inbox>("/api/video/me/inbox", { limit: 8, app: INBOX_APP }), staleTime: 0 })
  const items = q.data?.items ?? []
  return (
    <div role="dialog" aria-label={t("Notifications")} className="absolute right-0 top-11 z-50 flex max-h-[min(80vh,560px)] w-[min(92vw,380px)] flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <h2 className="flex-1 text-sm font-bold">{t("Notifications")}</h2>
        <MarkAllRead disabled={!q.data?.unread} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {q.isLoading ? (
          <div className="space-y-2 p-2"><Skel className="h-14 w-full" /><Skel className="h-14 w-full" /></div>
        ) : items.length === 0 ? (
          <div className="p-3"><Empty icon={<Bell size={26} />} title={t("No notifications yet")} body={t("New videos from channels you follow, replies and live streams show up here.")} /></div>
        ) : (
          <ul>
            {items.map((n) => <li key={n.id}><NoteRow note={n} onOpen={(note) => open(note, onClose)} /></li>)}
          </ul>
        )}
      </div>
      <Link to="/notifications" onClick={onClose} className="border-t border-line px-4 py-2.5 text-center text-sm font-semibold text-brand-soft hover:bg-white/[0.04]">
        {t("See all notifications")}
      </Link>
    </div>
  )
}
