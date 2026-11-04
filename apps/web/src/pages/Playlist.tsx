import { Link, useParams } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { CheckCircle2, ListVideo, Loader2, Lock, Play } from "lucide-react"
import { PageShell } from "../components/Layout"
import { Btn, ChannelAvatar, ChannelName, Empty, Skel } from "../components/bits"
import { SeriesBadge, playlistWatchUrl, usePlaylist, useSeriesProgress } from "../components/Playlists"
import { usePay } from "../components/Support"
import { ScopedAsk } from "../components/ScopedAsk"
import { Thumb } from "../components/VideoCards"
import { loginPath, useMe, useSignedIn } from "../lib/api"
import { rupees, views } from "../lib/format"
import { useTitle } from "../lib/title"
import NotFound from "./NotFound"
import { useT } from "../i18n"
import { rich } from "../i18n/rich"

export default function PlaylistPage() {
  const { id = "" } = useParams()
  const t = useT("channel")
  const pid = /^\d+$/.test(id) ? Number(id) : null
  const signedIn = useSignedIn()
  const q = usePlaylist(pid)
  const p = q.data
  const progress = useSeriesProgress(p)
  const qc = useQueryClient()
  const pay = usePay()
  const { data: me } = useMe()
  const paid = Boolean(p?.kind === "series" && p.price_minor)
  useTitle(p?.title)

  if (pid === null || q.isError) return <NotFound what="playlist" />
  if (q.isLoading || !p) {
    return (
      <PageShell>
        <div className="space-y-3"><Skel className="h-8 w-2/3" /><Skel className="h-4 w-1/3" /><Skel className="h-24 w-full" /><Skel className="h-24 w-full" /></div>
      </PageShell>
    )
  }

  const series = p.kind === "series"
  const prog = progress.data
  const done = new Set((prog?.videos ?? []).filter((v) => v.completed).map((v) => v.id))
  const first = p.videos[0]?.id
  const target = series && prog?.next ? prog.next : first
  const owned = Boolean(p.owned)
  const isCreator = Boolean(me?.channel && p.channel && me.channel.handle === p.channel.handle)

  function buy() {
    if (!p) return
    pay.start({
      body: { purpose: "series", playlist_id: p.id },
      label: t("Series: {title}", { title: p.title }),
      done: t("The whole series \"{title}\" is yours.", { title: p.title }),
      onPaid: async () => {
        await qc.invalidateQueries({ queryKey: ["playlist", p.id] })
        qc.invalidateQueries({ queryKey: ["purchases"] })
        qc.invalidateQueries({ queryKey: ["video"] })
      },
    }, "series")
  }

  const resumeLabel = series && prog && prog.completed > 0 ? (prog.next ? t("Continue") : t("Watch again")) : t("Play all")

  return (
    <PageShell className="max-w-5xl">
      <header className="rounded-2xl bg-panel p-4 sm:p-6">
        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
          <ListVideo size={14} aria-hidden="true" />
          {series ? <SeriesBadge /> : <span>{t("Playlist")}</span>}
          {p.visibility !== "public" && <span className="rounded-md bg-white/10 px-1.5 py-0.5 normal-case tracking-normal">{p.visibility === "unlisted" ? t("Unlisted") : t("Private")}</span>}
        </div>
        <h1 className="mt-2 break-words text-2xl font-bold leading-tight sm:text-3xl">{p.title}</h1>
        {p.channel && (
          <div className="mt-3 flex min-w-0 items-center gap-2 text-sm text-muted">
            <Link to={`/@${p.channel.handle}`} aria-label={p.channel.name}><ChannelAvatar channel={p.channel} size={28} /></Link>
            <ChannelName channel={p.channel} className="font-semibold text-ink" />
            <span aria-hidden="true">·</span>
            <span className="shrink-0">{t(p.video_count === 1 ? "{n} video" : "{n} videos", { n: p.video_count })}</span>
          </div>
        )}
        {p.description && <p className="mt-3 max-w-3xl whitespace-pre-wrap break-words text-sm leading-relaxed text-ink/85">{p.description}</p>}

        {series && signedIn && prog && prog.total > 0 && (
          <div className="mt-4 max-w-md">
            <div className="flex items-center justify-between text-sm">
              <span className="font-semibold text-ink">{t("{done} of {total} watched", { done: prog.completed, total: prog.total })}</span>
              <span className="tabular-nums text-muted">{prog.percent}%</span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={prog.percent} aria-label={t("Series progress")}>
              <div className="h-full rounded-full bg-brand" style={{ width: `${prog.percent}%` }} />
            </div>
          </div>
        )}
        {series && !signedIn && p.videos.length > 0 && (
          <p className="mt-4 text-sm text-muted">{rich(t("{signin} to keep track of what you have watched."), { signin: <Link to={`/login?returnUrl=${encodeURIComponent(`/playlist/${p.id}`)}`} className="font-semibold text-brand-soft hover:underline">{t("Sign in")}</Link> })}</p>
        )}

        {paid && p.price_minor && !isCreator && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-panel-2 px-3 py-2.5">
            <Lock size={16} className="shrink-0 text-brand-soft" aria-hidden="true" />
            <p className="min-w-0 flex-1 text-sm">
              {owned ? <span className="font-semibold">{t("You own this series.")}</span> : <><span className="font-semibold">{t("Paid series · {price}", { price: rupees(p.price_minor) })}</span> <span className="text-muted">{t("— every video in it, yours to keep.")}</span></>}
            </p>
            {!owned && (signedIn ? (
              <Btn tone="brand" size="sm" onClick={buy} disabled={pay.busy !== null}>
                {pay.busy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : null} {t("Buy series {price}", { price: rupees(p.price_minor) })}
              </Btn>
            ) : (
              <Link to={loginPath()} className="inline-flex h-8 items-center rounded-full bg-snow px-3 text-xs font-semibold text-black hover:bg-snow/85">{t("Sign in to buy")}</Link>
            ))}
          </div>
        )}

        {target && (
          <Link to={playlistWatchUrl(target, p.id)} className="mt-5 inline-flex h-10 items-center gap-2 rounded-full bg-brand px-5 text-sm font-semibold text-white hover:bg-brand-hover">
            <Play size={16} fill="currentColor" aria-hidden="true" /> {resumeLabel}
          </Link>
        )}
      </header>

      {p.videos.length > 0 && p.visibility === "public" && (
        <div className="mt-6">
          <ScopedAsk
            endpoint={`/api/video/playlists/${p.id}/ask`}
            title={series ? t("Ask this series") : t("Ask this playlist")}
            blurb={series ? t("Get answers from every video in this series, with links to the exact moments.") : t("Get answers from every video in this playlist, with links to the exact moments.")}
          />
        </div>
      )}

      <div className="mt-6">
        {p.videos.length === 0 ? (
          <Empty icon={<ListVideo size={30} />} title={t("Nothing to watch here yet")} body={t("Videos added to this playlist will show up here.")} />
        ) : (
          <ol className="space-y-2">
            {p.videos.map((v, i) => {
              const watched = done.has(v.id)
              const next = series && prog?.next === v.id
              return (
                <li key={v.id}>
                  <Link to={playlistWatchUrl(v.id, p.id)} className="group flex min-w-0 items-center gap-3 rounded-xl p-1.5 hover:bg-white/[0.05]">
                    <span className="w-6 shrink-0 text-center text-sm tabular-nums text-muted">{i + 1}</span>
                    <Thumb video={v} className="aspect-video w-32 shrink-0 sm:w-44" rounded="rounded-lg" progress={watched ? 1 : undefined} />
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-sm font-semibold leading-snug text-ink sm:text-[15px]">{v.title}</p>
                      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                        <span>{views(v.views)}</span>
                        {watched && <span className="inline-flex items-center gap-1 text-emerald-400"><CheckCircle2 size={13} aria-hidden="true" /> {t("Watched")}</span>}
                        {next && <span className="rounded-md bg-brand/25 px-1.5 py-0.5 font-semibold text-brand-soft">{t("Up next")}</span>}
                      </p>
                    </div>
                  </Link>
                </li>
              )
            })}
          </ol>
        )}
      </div>
      {pay.sheet}
    </PageShell>
  )
}
