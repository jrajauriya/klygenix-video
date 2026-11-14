import { useEffect } from "react"
import { Link, Navigate } from "react-router-dom"
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query"
import { Users } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { PageShell } from "../components/Layout"
import { Btn, CardSkeletons, ChannelAvatar, Empty } from "../components/bits"
import { VideoGridCard } from "../components/VideoCards"
import { getJson, useSignedIn } from "../lib/api"
import { useTitle } from "../lib/title"
import type { ChannelCard, VideoCard } from "../lib/types"
import { useT } from "../i18n"

const PAGE = 24

interface SubsPage {
  new_count: number
  since: string
  channels: number
  items: (VideoCard & { new: boolean })[]
  offset: number
}

export default function SubscriptionsPage() {
  const t = useT("account")
  useTitle("Subscriptions")
  const signedIn = useSignedIn()
  const qc = useQueryClient()
  const q = useInfiniteQuery({
    queryKey: ["subscriptions"],
    enabled: signedIn,
    initialPageParam: 0,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    queryFn: async ({ pageParam }) => {
      const { data } = await api.get<Omit<SubsPage, "offset">>("/api/video/feed/subscriptions", { params: { limit: PAGE, offset: pageParam, mark_seen: pageParam === 0 } })
      return { ...data, offset: pageParam }
    },
    getNextPageParam: (last) => (last.items.length === PAGE ? last.offset + PAGE : undefined),
  })
  const first = q.data?.pages[0]
  const following = useQuery({ queryKey: ["following"], enabled: signedIn, queryFn: () => getJson<ChannelCard[]>("/api/video/me/following") })

  useEffect(() => {
    if (first) qc.setQueryData(["subs-count"], { new_count: 0 })
  }, [first, qc])

  useEffect(() => () => qc.removeQueries({ queryKey: ["subscriptions"] }), [qc])

  if (!signedIn) return <Navigate to="/login?returnUrl=%2Fsubscriptions" replace />
  const items = q.data?.pages.flatMap((p) => p.items) ?? []

  return (
    <PageShell>
      <div className="mb-5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-2xl font-bold">{t("Subscriptions")}</h1>
        {first && first.channels > 0 && (
          <p className="text-sm text-muted">
            {first.new_count > 0 ? t("{n} new since your last visit", { n: first.new_count }) : t("Nothing new since your last visit")}
          </p>
        )}
      </div>
      {(following.data ?? []).length > 0 && (
        <nav aria-label={t("Channels you follow")} className="-mx-3 mb-7 flex items-start gap-4 overflow-x-auto px-3 pb-1 scrollbar-none sm:mx-0 sm:px-0">
          {(following.data ?? []).map((c) => (
            <Link key={c.id} to={`/@${c.handle}`} className="group flex w-20 shrink-0 flex-col items-center gap-1.5 text-center">
              <ChannelAvatar channel={c} size={56} />
              <span className="line-clamp-2 text-xs font-medium text-ink group-hover:text-brand-soft">{c.name}</span>
            </Link>
          ))}
          <Link to="/account?tab=following" className="ml-auto flex h-14 shrink-0 items-center self-start rounded-full px-3 text-sm font-semibold text-brand-soft hover:bg-white/10">
            {t("Manage")}
          </Link>
        </nav>
      )}
      {q.isLoading ? (
        <div className="grid gap-x-4 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4"><CardSkeletons count={8} /></div>
      ) : !first || first.channels === 0 ? (
        <Empty
          icon={<Users size={28} />}
          title={t("You don't follow any channels yet")}
          body={t("Follow channels you like and their new videos and reels land here.")}
          action={<Link to="/" className="inline-flex h-9 items-center rounded-full bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-hover">{t("Find channels on Home")}</Link>}
        />
      ) : items.length === 0 ? (
        <Empty icon={<Users size={28} />} title={t("No videos yet")} body={t("The channels you follow haven't published anything yet.")} />
      ) : (
        <>
          <ul className="grid gap-x-4 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {items.map((v) => (
              <li key={v.id} className="relative">
                <VideoGridCard video={v} to={v.kind === "reel" ? `/reels?start=${v.id}` : undefined} />
                {v.new && (
                  <span className="pointer-events-none absolute left-2 top-2 rounded-md bg-brand px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">
                    {t("New")}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {q.hasNextPage && (
            <div className="mt-8 flex justify-center">
              <Btn tone="soft" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>
                {q.isFetchingNextPage ? t("Loading…") : t("Show more")}
              </Btn>
            </div>
          )}
        </>
      )}
    </PageShell>
  )
}
