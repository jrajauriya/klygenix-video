import { useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { ImagePlus, Lock, Plus, Send, Trash2, X } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select, Spinner, Textarea, useConfirm } from "@klygenixvideo/ui"
import { useHasFeature, useHasPermission } from "@klygenixvideo/client"
import { MULTIPART, STUDIO, useChannel } from "../lib/hooks"
import { channelUrl, compact, detail, when } from "../lib/format"
import type { PostItem } from "../lib/types"
import { Segmented } from "../components/DailyChart"
import { useTiers } from "../components/earnings/shared"

type Kind = "text" | "poll" | "image"

const KINDS: { value: Kind; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "poll", label: "Poll" },
  { value: "image", label: "Image" },
]

export default function Community() {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const canEdit = useHasPermission("video.channels", "full")
  const moneyOn = useHasFeature("video.earnings")
  const moneyAllowed = useHasPermission("video.earnings")
  const { data: channel } = useChannel()
  const { data: tiers } = useTiers(moneyOn && moneyAllowed)
  const { data: posts, isLoading } = useQuery({
    queryKey: ["studio-posts"],
    queryFn: async () => (await api.get<PostItem[]>(`${STUDIO}/posts`)).data,
  })
  const [kind, setKind] = useState<Kind>("text")
  const [body, setBody] = useState("")
  const [options, setOptions] = useState<string[]>(["", ""])
  const [audience, setAudience] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const active = (tiers ?? []).filter((t) => t.is_active)
  const audienceOptions = [
    { value: "", label: "Everyone" },
    ...[1, 2, 3, 4, 5].map((r) => {
      const t = active.find((x) => x.rank === r)
      return { value: String(r), label: `Members, level ${r} and up`, hint: t ? t.name : undefined }
    }).filter((o) => !tiers || active.some((t) => t.rank <= Number(o.value))),
  ]
  const filled = options.map((o) => o.trim()).filter(Boolean)
  const ready = kind === "text" ? Boolean(body.trim()) : kind === "poll" ? filled.length >= 2 : Boolean(file)

  function reset() {
    setBody("")
    setOptions(["", ""])
    setFile(null)
    if (fileInput.current) fileInput.current.value = ""
  }

  async function post() {
    setBusy(true)
    try {
      const rank = audience ? Number(audience) : null
      if (kind === "image" && file) {
        const form = new FormData()
        form.append("file", file)
        form.append("body", body.trim())
        if (rank) form.append("members_rank", String(rank))
        await api.post(`${STUDIO}/posts/image`, form, MULTIPART)
      } else {
        await api.post(`${STUDIO}/posts`, { kind, body: body.trim(), options: kind === "poll" ? filled : [], members_rank: rank })
      }
      toast.success("Posted to your channel")
      reset()
      qc.invalidateQueries({ queryKey: ["studio-posts"] })
    } catch (err) {
      toast.error(detail(err, "Could not post it"))
    } finally {
      setBusy(false)
    }
  }

  async function remove(p: PostItem) {
    const ok = await confirm({ title: "Delete this post?", message: "It is removed from your channel for everyone, with its poll votes.", confirmLabel: "Delete", variant: "destructive" })
    if (!ok) return
    try {
      await api.delete(`${STUDIO}/posts/${p.id}`)
      toast.success("Post deleted")
      qc.invalidateQueries({ queryKey: ["studio-posts"] })
    } catch (err) {
      toast.error(detail(err, "Could not delete the post"))
    }
  }

  return (
    <div className="pb-8">
      <PageHeader
        title="Community"
        subtitle="Posts and polls on your channel's Community tab."
        actions={channel ? (
          <a href={channelUrl(channel.handle)} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-brand hover:underline">
            View on your channel
          </a>
        ) : undefined}
      />
      <div className="grid gap-5 lg:grid-cols-5 [&>*]:min-w-0">
        {canEdit && (
          <Card className="space-y-4 p-5 lg:order-2 lg:col-span-2 lg:self-start">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-navy">New post</h2>
              <Segmented label="Post type" value={kind} onChange={setKind} options={KINDS} />
            </div>
            <Field label={kind === "poll" ? "Question" : kind === "image" ? "Caption" : "Message"} required={kind === "text"}>
              <Textarea rows={kind === "text" ? 5 : 2} value={body} maxLength={3000} onChange={(e) => setBody(e.target.value)} />
            </Field>
            {kind === "poll" && (
              <fieldset className="space-y-2">
                <legend className="label">Choices <span className="font-normal normal-case text-slate-500">(2 to 6)</span></legend>
                {options.map((o, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <Input value={o} maxLength={80} aria-label={`Choice ${i + 1}`} onChange={(e) => setOptions(options.map((x, j) => (j === i ? e.target.value : x)))} />
                    {options.length > 2 && (
                      <Button size="icon" variant="ghost" aria-label={`Remove choice ${i + 1}`} onClick={() => setOptions(options.filter((_, j) => j !== i))}>
                        <X size={15} />
                      </Button>
                    )}
                  </div>
                ))}
                {options.length < 6 && (
                  <Button size="sm" variant="ghost" onClick={() => setOptions([...options, ""])}><Plus size={13} /> Add a choice</Button>
                )}
              </fieldset>
            )}
            {kind === "image" && (
              <Field label="Image" required hint="JPG, PNG or WebP. Large images are resized.">
                <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-brand"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </Field>
            )}
            <Field label="Who can see it">
              <Select value={audience} onChange={setAudience} options={audienceOptions} aria-label="Who can see it" />
            </Field>
            <p className="text-xs text-slate-500">Links in polls and image captions hold the post for review. Members-only posts show to others as locked.</p>
            <div className="flex justify-end">
              <Button onClick={post} disabled={busy || !ready}>
                {kind === "image" ? <ImagePlus size={14} /> : <Send size={14} />} {busy ? "Posting…" : "Post"}
              </Button>
            </div>
          </Card>
        )}

        <section className="space-y-3 lg:order-1 lg:col-span-3" aria-labelledby="posts-h">
          <h2 id="posts-h" className="text-xs font-semibold uppercase tracking-wide text-slate-500">Your posts</h2>
          {isLoading ? (
            <Spinner />
          ) : !posts?.length ? (
            <EmptyState title="No posts yet" hint="Share news, a behind-the-scenes photo, or ask your audience with a poll." />
          ) : (
            posts.map((p) => (
              <Card key={p.id} className="p-4">
                <div className="flex items-start gap-2">
                  <p className="flex flex-1 flex-wrap items-center gap-1.5 text-xs text-slate-500">
                    <span>{when(p.created_at, true)}</span>
                    <Badge color={p.kind === "poll" ? "blue" : p.kind === "image" ? "purple" : "slate"}>{p.kind === "poll" ? "Poll" : p.kind === "image" ? "Image" : "Text"}</Badge>
                    {p.members_rank ? <Badge color="amber"><Lock size={11} aria-hidden="true" />Members level {p.members_rank}+</Badge> : null}
                    {p.status === "hidden" && <Badge color="red">Held for review</Badge>}
                  </p>
                  {canEdit && (
                    <Button size="icon" variant="ghost" aria-label="Delete post" onClick={() => remove(p)}>
                      <Trash2 size={15} />
                    </Button>
                  )}
                </div>
                {p.body && <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-800">{p.body}</p>}
                {p.image && <img src={p.image} alt="" className="mt-2 max-h-80 rounded-lg object-contain" loading="lazy" />}
                {p.poll && (
                  <ul className="mt-3 space-y-2">
                    {p.poll.options.map((o) => {
                      const pct = p.poll!.total ? Math.round((o.votes / p.poll!.total) * 100) : 0
                      return (
                        <li key={o.id}>
                          <div className="flex items-center justify-between gap-2 text-sm">
                            <span className="text-slate-700">{o.label}</span>
                            <span className="font-num text-slate-600">{pct}% · {compact(o.votes)}</span>
                          </div>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
                            <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
                          </div>
                        </li>
                      )
                    })}
                    <li className="text-xs text-slate-500">{compact(p.poll.total)} {p.poll.total === 1 ? "vote" : "votes"}</li>
                  </ul>
                )}
              </Card>
            ))
          )}
        </section>
      </div>
    </div>
  )
}
