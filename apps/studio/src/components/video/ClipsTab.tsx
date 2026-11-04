import { useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Clapperboard, Plus, Scissors, Sparkles } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { Badge, Button, Card, EmptyState, Spinner } from "@klygenixvideo/ui"
import { STUDIO } from "../../lib/hooks"
import { useHasPermission } from "../../lib/team"
import { ViewOnly } from "../team/ViewOnly"
import { clock, detail } from "../../lib/format"
import { createClip } from "../../lib/clips"
import type { Clip, StudioVideoDetail, Suggestion } from "../../lib/types"
import { ClipStatusPill } from "../StatusChips"
import { useT } from "../../i18n"

export function ClipsTab({ video }: { video: StudioVideoDetail }) {
  const t = useT()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [making, setMaking] = useState<number | "custom" | null>(null)
  const canEdit = useHasPermission("video.clips", "full")
  const canClip = video.source !== "embed" && ["published", "in_review"].includes(video.status)

  const { data: ideas, isLoading } = useQuery({
    queryKey: ["studio-suggestions", video.id],
    queryFn: async () => (await api.get<Suggestion[]>(`${STUDIO}/videos/${video.id}/suggestions`)).data,
  })
  const { data: clips } = useQuery({
    queryKey: ["studio-clips", { video_id: video.id }],
    queryFn: async () => (await api.get<Clip[]>(`${STUDIO}/clips?video_id=${video.id}`)).data,
  })

  async function make(s: Suggestion | null) {
    setMaking(s ? s.id : "custom")
    try {
      const clip = await createClip({
        source_video_id: video.id,
        suggestion_id: s?.id ?? null,
        title: s?.title || t("Clip from {title}", { title: video.title }),
        start_ms: s?.start_ms ?? 0,
        end_ms: s?.end_ms ?? Math.min(video.duration_ms, 30_000),
      })
      qc.invalidateQueries({ queryKey: ["studio-clips"] })
      navigate(`/clips/${clip.id}`)
    } catch (err) {
      toast.error(detail(err, t("Could not start the clip")))
      setMaking(null)
    }
  }

  if (!canClip) {
    return (
      <EmptyState
        title={video.source === "embed" ? t("Clips need your own upload") : t("Clips open once the video is processed")}
        hint={video.source === "embed"
          ? t("We never download videos from other platforms, so linked videos cannot be cut into clips. Upload the original file to make clips.")
          : t("Come back when the video is published.")}
      />
    )
  }

  return (
    <div className="space-y-6">
      {!canEdit && <ViewOnly what={t("Your role can see clip ideas and clips but not make new clips.")} />}
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="flex items-center gap-1.5 text-sm font-bold text-navy"><Sparkles size={15} className="text-brand" /> {t("Clip ideas")}</h3>
            <p className="text-sm text-slate-500">{t("Moments that should work on their own as a reel, best first.")}</p>
          </div>
          {canEdit && (
            <Button variant="outline" onClick={() => make(null)} disabled={making !== null}>
              <Plus size={14} /> {making === "custom" ? t("Starting…") : t("Pick my own moment")}
            </Button>
          )}
        </div>
        {isLoading ? (
          <Spinner />
        ) : !ideas?.length ? (
          <p className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">
            {video.ai_status === "ready" ? t("No strong moments were found in this video. You can still pick your own.") : t("Clip ideas appear once the AI step is ready.")}
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {ideas.map((s) => (
              <Card key={s.id} className="flex flex-col gap-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold leading-snug text-slate-800">{s.title}</p>
                  <Badge color={s.score >= 0.8 ? "green" : s.score >= 0.6 ? "blue" : "slate"}>{Math.round(s.score * 100)}</Badge>
                </div>
                <p className="font-num text-xs text-brand">
                  {clock(s.start_ms)} – {clock(s.end_ms)} · {t("{n} s", { n: Math.round(s.duration_ms / 1000) })}
                </p>
                {s.hook && <p className="rounded-md bg-slate-50 px-2 py-1.5 text-sm italic text-slate-700">“{s.hook}”</p>}
                <p className="flex-1 text-xs text-slate-500">{s.reason}</p>
                {canEdit && (
                  <Button size="sm" onClick={() => make(s)} disabled={making !== null}>
                    <Scissors size={13} /> {making === s.id ? t("Starting…") : t("Make clip")}
                  </Button>
                )}
              </Card>
            ))}
          </div>
        )}
      </section>

      <section>
        <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-navy"><Clapperboard size={15} /> {t("Clips from this video")}</h3>
        {!clips?.length ? (
          <p className="text-sm text-slate-500">{t("None yet.")}</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {clips.map((c) => (
              <li key={c.id}>
                <Link to={`/clips/${c.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">{c.title}</span>
                  <span className="font-num text-xs text-slate-500">{clock(c.start_ms)} – {clock(c.end_ms)}</span>
                  <Badge color="slate">{c.aspect}</Badge>
                  <ClipStatusPill status={c.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
