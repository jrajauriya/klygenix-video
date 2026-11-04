import { useEffect, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { getJson } from "../lib/api"
import { useT } from "../lib/i18n"
import type { SearchResult } from "../lib/types"
import { Keyboard, TypedText } from "../components/Keyboard"
import { VideoTile } from "../components/Tiles"

export default function Search() {
  const [params, setParams] = useSearchParams()
  const [text, setText] = useState(params.get("q") ?? "")
  const [query, setQuery] = useState(text.trim())
  const t = useT()

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const next = text.trim()
      setQuery(next)
      setParams(next ? { q: next } : {}, { replace: true })
    }, 450)
    return () => window.clearTimeout(timer)
  }, [text])

  const results = useQuery({
    queryKey: ["search", query],
    enabled: query.length >= 2,
    queryFn: () => getJson<{ results: SearchResult[] }>("/api/video/search", { q: query, limit: 24 }),
  })
  const list = results.data?.results ?? []

  return (
    <div className="safe-x grid grid-cols-[44rem_1fr] gap-12">
      <div>
        <h1 className="text-4xl font-bold">{t("Search")}</h1>
        <div className="mt-6">
          <TypedText id="search" label={t("Search for")} value={text} placeholder={t("Type with the keys below")} />
        </div>
        <div className="mt-6">
          <Keyboard label={t("On-screen keyboard")} value={text} onChange={setText} onSubmit={() => setQuery(text.trim())} submitLabel={t("Search")} max={100} auto />
        </div>
      </div>
      <section aria-labelledby="results-title">
        <h2 id="results-title" className="text-3xl font-bold">
          {query.length >= 2 ? t("Results for “{q}”", { q: query }) : t("Results")}
        </h2>
        <p role="status" className="mt-2 text-2xl text-muted">
          {query.length < 2 ? t("Type two letters or more.") : results.isLoading ? t("Searching…") : results.isError ? t("Search did not work. Try again.") : list.length === 0 ? t("Nothing matched.") : t("{n} videos", { n: list.length })}
        </p>
        <ul aria-label={t("Search results")} className="mt-4 grid grid-cols-3 gap-4" data-focus-group>
          {list.map((v) => (
            <li key={v.id}>
              <VideoTile video={{ ...v, kind: "long" }} group="search" src="search" fill />
              {v.moment && <p className="line-clamp-2 px-2 text-lg text-muted">{t("At {label}: {snippet}", { label: v.moment.label, snippet: v.moment.snippet })}</p>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
