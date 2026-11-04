import { useState, type FormEvent } from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { useInfiniteQuery } from "@tanstack/react-query"
import { Search as SearchIcon, Sparkles } from "lucide-react"
import { PageShell } from "../components/Layout"
import { Btn, Empty, Skel } from "../components/bits"
import { VideoRowCard } from "../components/VideoCards"
import { api } from "@klygenixvideo/auth"
import { useSignedIn } from "../lib/api"
import { useTitle } from "../lib/title"
import type { SearchResult } from "../lib/types"
import { useT } from "../i18n"

const PAGE = 20
const MAX_OFFSET = 500

export default function SearchPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const q = (params.get("q") ?? "").trim()
  const [draft, setDraft] = useState(q)
  const t = useT("home")
  useTitle(q ? t("{q} – Search", { q }) : t("Search"))
  const signedIn = useSignedIn()
  const res = useInfiniteQuery({
    queryKey: ["search", q, signedIn],
    enabled: q.length >= 2,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const r = await api.get<{ results: SearchResult[]; total?: number }>("/api/video/search", { params: { q, limit: PAGE, offset: pageParam } })
      const total = Number(r.headers["x-total-count"] ?? r.data.total ?? r.data.results.length)
      return { rows: r.data.results, offset: pageParam, total }
    },
    getNextPageParam: (last) => {
      const next = last.offset + last.rows.length
      return last.rows.length > 0 && next < last.total && next <= MAX_OFFSET ? next : undefined
    },
  })
  const results = res.data?.pages.flatMap((p) => p.rows) ?? []
  const total = res.data?.pages[0]?.total ?? 0

  function submit(e: FormEvent) {
    e.preventDefault()
    if (draft.trim()) navigate(`/search?q=${encodeURIComponent(draft.trim())}`)
  }

  return (
    <PageShell className="max-w-5xl">
      <form onSubmit={submit} role="search" className="mb-6 md:hidden">
        <div className="relative">
          <SearchIcon size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
          <input
            type="search"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t("Search videos and moments inside them")}
            aria-label={t("Search")}
            className="h-11 w-full rounded-full border border-line bg-panel pl-10 pr-4 text-sm text-ink placeholder:text-faint outline-none focus:border-brand"
          />
        </div>
      </form>

      {q.length < 2 ? (
        <Empty icon={<SearchIcon size={30} />} title={t("Search inside every video")} body={t("Klygenix Play searches what is said in videos, not just titles. Try a topic, a phrase or a question.")} />
      ) : (
        <>
          <h1 className="mb-1 text-lg font-bold">{t("Results for “{q}”", { q })}{total > 0 && <span className="ml-2 text-sm font-normal text-muted">{t(total === 1 ? "{n} video" : "{n} videos", { n: total })}</span>}</h1>
          <p className="mb-5 flex items-center gap-1.5 text-xs text-muted"><Sparkles size={13} className="text-brand-soft" aria-hidden="true" /> {t("Matches inside videos open at the moment they are said.")}</p>
          {res.isLoading ? (
            <div className="space-y-4">
              {Array.from({ length: 5 }, (_, i) => (
                <div key={i} className="flex gap-3"><Skel className="aspect-video w-44 shrink-0 sm:w-72" /><div className="flex-1 space-y-2"><Skel className="h-4 w-3/4" /><Skel className="h-3 w-1/2" /><Skel className="h-10 w-full" /></div></div>
              ))}
            </div>
          ) : res.isError ? (
            <Empty title={t("Search did not work")} body={t("Check your connection and try again.")} />
          ) : results.length === 0 ? (
            <Empty icon={<SearchIcon size={30} />} title={t("No matches")} body={t("Try fewer or different words.")} />
          ) : (
            <div className="space-y-5">
              {results.map((r) => {
                const href = r.kind === "reel" ? `/reels?start=${r.id}` : r.moment ? `/watch/${r.id}?t=${r.moment.start_ms}` : `/watch/${r.id}`
                return (
                  <VideoRowCard
                    key={r.id}
                    video={r}
                    to={href}
                    snippet={
                      r.moment && (
                        <Link to={href} className="block rounded-xl border border-line bg-panel px-3 py-2 text-[13px] leading-relaxed text-ink/85 hover:border-brand/60">
                          <span className="mr-2 inline-flex rounded-md bg-brand/25 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-brand-soft">{t("at {time}", { time: r.moment.label })}</span>
                          <span className="line-clamp-2 sm:line-clamp-none">{r.moment.snippet}</span>
                        </Link>
                      )
                    }
                  />
                )
              })}
              {res.hasNextPage && (
                <div className="flex justify-center pt-2">
                  <Btn tone="soft" size="sm" onClick={() => res.fetchNextPage()} disabled={res.isFetchingNextPage}>
                    {res.isFetchingNextPage ? t("Loading…") : t("Load more")}
                  </Btn>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </PageShell>
  )
}
