import { useEffect, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { getJson } from "../lib/api"
import type { SearchResult } from "../lib/types"
import { Keyboard, TypedText } from "../components/Keyboard"
import { VideoTile } from "../components/Tiles"

export default function Search() {
  const [params, setParams] = useSearchParams()
  const [text, setText] = useState(params.get("q") ?? "")
  const [query, setQuery] = useState(text.trim())

  useEffect(() => {
    const t = window.setTimeout(() => {
      const next = text.trim()
      setQuery(next)
      setParams(next ? { q: next } : {}, { replace: true })
    }, 450)
    return () => window.clearTimeout(t)
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
        <h1 className="text-4xl font-bold">Search</h1>
        <div className="mt-6">
          <TypedText id="search" label="Search for" value={text} placeholder="Type with the keys below" />
        </div>
        <div className="mt-6">
          <Keyboard label="On-screen keyboard" value={text} onChange={setText} onSubmit={() => setQuery(text.trim())} submitLabel="Search" max={100} auto />
        </div>
      </div>
      <section aria-labelledby="results-title">
        <h2 id="results-title" className="text-3xl font-bold">
          {query.length >= 2 ? `Results for “${query}”` : "Results"}
        </h2>
        <p role="status" className="mt-2 text-2xl text-muted">
          {query.length < 2 ? "Type two letters or more." : results.isLoading ? "Searching…" : results.isError ? "Search did not work. Try again." : list.length === 0 ? "Nothing matched." : `${list.length} videos`}
        </p>
        <ul aria-label="Search results" className="mt-4 grid grid-cols-3 gap-4" data-focus-group>
          {list.map((v) => (
            <li key={v.id}>
              <VideoTile video={{ ...v, kind: "long" }} group="search" src="search" fill />
              {v.moment && <p className="line-clamp-2 px-2 text-lg text-muted">At {v.moment.label}: {v.moment.snippet}</p>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
