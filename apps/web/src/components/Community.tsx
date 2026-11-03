import { useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Check, Lock, Megaphone } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { cn } from "@klygenixvideo/ui"
import { errText, getJson, loginPath, useSignedIn } from "../lib/api"
import { timeAgo } from "../lib/format"
import type { ChannelCard, CommunityPost } from "../lib/types"
import { Btn, ChannelAvatar, Empty, Skel } from "./bits"

function Poll({ post, onVoted }: { post: CommunityPost; onVoted: (p: CommunityPost) => void }) {
  const signedIn = useSignedIn()
  const navigate = useNavigate()
  const [busy, setBusy] = useState<number | null>(null)
  const poll = post.poll
  if (!poll) return null
  const showResults = poll.my_vote !== null

  async function vote(optionId: number) {
    if (!signedIn) {
      navigate(loginPath())
      return
    }
    setBusy(optionId)
    try {
      const { data } = await api.post<CommunityPost>(`/api/video/posts/${post.id}/vote`, { option_id: optionId })
      onVoted(data)
    } catch (err) {
      toast.error(errText(err, "Your vote could not be counted."))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mt-3 space-y-2">
      {poll.options.map((o) => {
        const pct = poll.total ? Math.round((o.votes / poll.total) * 100) : 0
        const mine = poll.my_vote === o.id
        return showResults ? (
          <div key={o.id} className="relative overflow-hidden rounded-xl border border-line px-3 py-2">
            <div className={cn("absolute inset-y-0 left-0", mine ? "bg-brand/30" : "bg-white/[0.07]")} style={{ width: `${pct}%` }} aria-hidden="true" />
            <div className="relative flex items-center gap-2 text-sm">
              {mine && <Check size={14} className="text-brand-soft" aria-hidden="true" />}
              <span className="flex-1">{o.label}{mine ? " (your vote)" : ""}</span>
              <span className="font-semibold tabular-nums">{pct}%</span>
            </div>
          </div>
        ) : (
          <button
            key={o.id}
            type="button"
            onClick={() => vote(o.id)}
            disabled={busy !== null}
            className="flex w-full items-center rounded-xl border border-line px-3 py-2 text-left text-sm hover:border-brand hover:bg-brand/10 disabled:opacity-60"
          >
            {o.label}
          </button>
        )
      })}
      <p className="text-xs text-muted">{poll.total} {poll.total === 1 ? "vote" : "votes"}{showResults ? "" : " · tap an option to vote"}</p>
    </div>
  )
}

export function CommunityPosts({ handle, channel, onJoin }: { handle: string; channel: Pick<ChannelCard, "name" | "handle" | "avatar">; onJoin?: () => void }) {
  const signedIn = useSignedIn()
  const qc = useQueryClient()
  const key = ["channel", handle, "posts", signedIn]
  const q = useQuery({ queryKey: key, queryFn: () => getJson<CommunityPost[]>(`/api/video/channels/${handle}/posts`) })

  function replace(p: CommunityPost) {
    qc.setQueryData<CommunityPost[]>(key, (old) => (old ?? []).map((x) => (x.id === p.id ? p : x)))
  }

  if (q.isLoading) return <div className="space-y-3">{Array.from({ length: 3 }, (_, i) => <Skel key={i} className="h-28 w-full rounded-2xl" />)}</div>
  const posts = q.data ?? []
  if (!posts.length) return <Empty icon={<Megaphone size={30} />} title="No posts yet" body="Updates, polls and pictures from this channel will show up here." />

  return (
    <ul className="mx-auto max-w-2xl space-y-4">
      {posts.map((p) => (
        <li key={p.id} className="rounded-2xl border border-line bg-panel p-4">
          <div className="flex items-center gap-2.5">
            <ChannelAvatar channel={channel} size={32} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{channel.name}</p>
              <p className="text-xs text-muted">{timeAgo(p.created_at)}{p.members_rank ? " · Members only" : ""}</p>
            </div>
          </div>
          {p.locked ? (
            <div className="mt-3 flex flex-col items-center gap-2 rounded-xl bg-panel-2 px-4 py-6 text-center">
              <Lock size={20} className="text-brand-soft" aria-hidden="true" />
              <p className="text-sm font-semibold">This post is for members</p>
              {signedIn ? (
                onJoin && <Btn tone="brand" size="sm" onClick={onJoin}>Join to see it</Btn>
              ) : (
                <Link to={loginPath()} className="inline-flex h-8 items-center rounded-full bg-snow px-3 text-xs font-semibold text-black hover:bg-snow/85">Sign in to join</Link>
              )}
            </div>
          ) : (
            <>
              {p.body && <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-ink/90">{p.body}</p>}
              {p.image && <img src={p.image} alt="" loading="lazy" className="mt-3 max-h-[420px] w-full rounded-xl object-cover" />}
              {p.kind === "poll" && <Poll post={p} onVoted={replace} />}
            </>
          )}
        </li>
      ))}
    </ul>
  )
}
