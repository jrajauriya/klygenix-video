import { useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Check, Film, ImageUp, Sparkles } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { Badge, Button, Card, cn } from "@klygenixvideo/ui"
import { MULTIPART, STUDIO } from "../../lib/hooks"
import { clock, detail } from "../../lib/format"
import type { StudioVideoDetail, ThumbnailIdea } from "../../lib/types"

const BUSY = ["uploading", "processing", "scanning"]

export function ThumbnailCard({ video }: { video: StudioVideoDetail }) {
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const ideas = video.thumbnail_ideas ?? []
  const custom = Boolean(video.thumbnail_custom)
  const picked = ideas.find((i) => i.chosen)

  async function run(tag: string, action: () => Promise<unknown>, ok: string, fallback: string) {
    setBusy(tag)
    try {
      await action()
      toast.success(ok)
      await qc.invalidateQueries({ queryKey: ["studio-video", String(video.id)] })
      qc.invalidateQueries({ queryKey: ["studio-videos"] })
    } catch (err) {
      toast.error(detail(err, fallback))
    } finally {
      setBusy(null)
    }
  }

  function upload(file: File) {
    const body = new FormData()
    body.append("file", file)
    run("upload", () => api.post(`${STUDIO}/videos/${video.id}/thumbnail`, body, MULTIPART), "Thumbnail updated", "That image could not be used")
  }

  const pick = (idea: ThumbnailIdea) =>
    run(idea.key, () => api.post(`${STUDIO}/videos/${video.id}/thumbnail/pick`, { key: idea.key }), "Thumbnail updated", "Could not use that frame")

  const reset = () =>
    run("reset", () => api.delete(`${STUDIO}/videos/${video.id}/thumbnail`), "Back to the default frame", "Could not reset the thumbnail")

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-navy">Thumbnail</h3>
        <Badge color={custom ? "brand" : "slate"}>{picked ? "AI idea" : custom ? "Your upload" : "Default frame"}</Badge>
      </div>
      <div className="flex gap-3">
        <div className="aspect-video w-36 shrink-0 overflow-hidden rounded-md bg-slate-200 sm:w-44">
          {video.thumbnail && <img src={video.thumbnail} alt="Current thumbnail" className="h-full w-full object-cover" />}
        </div>
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-2">
          <p className="text-xs text-slate-500">JPG or PNG, 1280 × 720 works best.</p>
          <input ref={fileRef} type="file" accept="image/*" className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) upload(f)
              e.target.value = ""
            }} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => fileRef.current?.click()}>
              <ImageUp size={14} /> {busy === "upload" ? "Uploading…" : "Upload your own"}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy !== null || !custom} onClick={reset}>
              <Film size={14} /> {busy === "reset" ? "Resetting…" : "Use the default frame"}
            </Button>
          </div>
        </div>
      </div>
      <div>
        <p className="mb-1.5 flex items-center gap-1 text-xs font-semibold text-slate-500"><Sparkles size={13} className="text-brand" /> AI ideas · click one to use it</p>
        {ideas.length === 0 ? (
          <p className="text-sm text-slate-500">
            {BUSY.includes(video.status)
              ? "Ideas appear here once processing finishes."
              : "No thumbnail ideas for this video. Videos processed from now on get up to four frames to choose from."}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {ideas.map((idea) => (
              <button
                key={idea.key}
                type="button"
                title={idea.reason || undefined}
                aria-label={`Use the frame at ${clock(idea.at_ms)}${idea.reason ? `: ${idea.reason}` : ""}`}
                aria-pressed={idea.chosen}
                disabled={busy !== null || idea.chosen}
                onClick={() => pick(idea)}
                className={cn(
                  "group relative aspect-video overflow-hidden rounded-md border-2 bg-slate-100 disabled:cursor-default",
                  idea.chosen ? "border-brand" : "border-transparent hover:border-brand-100",
                )}
              >
                <img src={idea.url} alt="" className="h-full w-full object-cover" loading="lazy" />
                <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1 font-num text-[10px] text-white">{clock(idea.at_ms)}</span>
                {idea.chosen && (
                  <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-brand text-white"><Check size={13} /></span>
                )}
                {busy === idea.key && <span className="absolute inset-0 flex items-center justify-center bg-white/70 text-xs font-semibold text-navy">Saving…</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </Card>
  )
}
