import { useState } from "react"
import { Link, Navigate } from "react-router-dom"
import { useInfiniteQuery } from "@tanstack/react-query"
import { Bell, Settings2 } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { PageShell } from "../components/Layout"
import { Btn, Empty, Skel, Tabs } from "../components/bits"
import { MarkAllRead, NoteRow } from "../components/InboxPanel"
import { useSignedIn } from "../lib/api"
import { INBOX_APP, useOpenNote, type Inbox } from "../lib/inbox"
import { useTitle } from "../lib/title"
import { useT } from "../i18n"

const PAGE = 30

export default function NotificationsPage() {
  const t = useT("account")
  useTitle("Notifications")
  const signedIn = useSignedIn()
  const [filter, setFilter] = useState<"all" | "unread">("all")
  const open = useOpenNote()
  const q = useInfiniteQuery({
    queryKey: ["inbox", "page", filter],
    enabled: signedIn,
    initialPageParam: 0,
    staleTime: 0,
    queryFn: async ({ pageParam }) => {
      const { data } = await api.get<Inbox>("/api/video/me/inbox", { params: { unread: filter === "unread", limit: PAGE, offset: pageParam, app: INBOX_APP } })
      return { ...data, offset: pageParam }
    },
    getNextPageParam: (last) => (last.items.length === PAGE ? last.offset + PAGE : undefined),
  })
  if (!signedIn) return <Navigate to="/login?returnUrl=%2Fnotifications" replace />
  const items = q.data?.pages.flatMap((p) => p.items) ?? []
  const unread = q.data?.pages[0]?.unread ?? 0

  return (
    <PageShell className="max-w-3xl">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="flex-1 text-2xl font-bold">{t("Notifications")}</h1>
        <MarkAllRead disabled={!unread} />
        <Link to="/account?tab=notifications" className="inline-flex h-8 items-center gap-1.5 rounded-full bg-white/10 px-3 text-xs font-semibold hover:bg-white/15">
          <Settings2 size={14} aria-hidden="true" /> {t("Email digest")}
        </Link>
      </div>
      <Tabs
        className="mb-4"
        value={filter}
        onChange={setFilter}
        tabs={[{ key: "all", label: t("All") }, { key: "unread", label: unread ? t("Unread ({n})", { n: unread }) : t("Unread") }]}
      />
      {q.isLoading ? (
        <div className="space-y-2"><Skel className="h-16 w-full" /><Skel className="h-16 w-full" /><Skel className="h-16 w-full" /></div>
      ) : items.length === 0 ? (
        <Empty
          icon={<Bell size={28} />}
          title={filter === "unread" ? t("You're all caught up") : t("No notifications yet")}
          body={t("New videos from channels you follow, replies and live streams show up here.")}
        />
      ) : (
        <>
          <ul className="divide-y divide-line rounded-2xl border border-line bg-panel p-1.5">
            {items.map((n) => <li key={n.id}><NoteRow note={n} onOpen={(note) => open(note)} /></li>)}
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
    </PageShell>
  )
}
