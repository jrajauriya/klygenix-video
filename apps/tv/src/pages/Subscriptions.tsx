import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { getJson, useSignedIn } from "../lib/api"
import { useT } from "../lib/i18n"
import type { Subscriptions as Data } from "../lib/types"
import { Grid, Status, VideoTile } from "../components/Tiles"

export default function Subscriptions() {
  const signedIn = useSignedIn()
  const t = useT()
  const qc = useQueryClient()
  const [opened] = useState(() => Date.now())
  const q = useQuery({
    queryKey: ["feed", "subscriptions", "page", opened],
    enabled: signedIn,
    staleTime: Infinity,
    queryFn: () => getJson<Data>("/api/video/feed/subscriptions", { limit: 48 }),
  })
  useEffect(() => {
    if (q.data) qc.invalidateQueries({ queryKey: ["feed", "subscriptions", "row"] })
  }, [q.data, qc])

  const items = q.data?.items ?? []
  const fresh = q.data?.new_count ?? 0

  return (
    <div className="safe-x">
      <h1 className="text-5xl font-bold">{t("Subscriptions")}</h1>
      {!signedIn ? (
        <>
          <p className="mt-6 max-w-[70rem] text-2xl leading-snug text-muted">{t("Sign in to see new videos from the channels you follow.")}</p>
          <div className="mt-8 flex gap-6" data-focus-group>
            <Link to="/login" data-autofocus className="inline-block rounded-full bg-brand px-10 py-4 text-2xl font-semibold text-white">{t("Sign in with your phone")}</Link>
          </div>
        </>
      ) : q.isLoading ? (
        <Status>{t("Loading…")}</Status>
      ) : q.isError ? (
        <Status>{t("Your subscriptions did not load. Try again in a moment.")}</Status>
      ) : items.length === 0 ? (
        <Status>{t("Follow channels to see their new videos here.")}</Status>
      ) : (
        <>
          {fresh > 0 && <p className="mt-3 text-2xl text-muted" role="status">{t("{n} new since you last looked", { n: fresh })}</p>}
          <div className="mt-6">
            <Grid label={t("Videos from channels you follow")}>
              {items.map((v, i) => (
                <li key={v.id}>
                  <VideoTile video={{ ...v, kind: "long" }} group="subs-page" src="follow" auto={i === 0} fill />
                </li>
              ))}
            </Grid>
          </div>
        </>
      )}
    </div>
  )
}
