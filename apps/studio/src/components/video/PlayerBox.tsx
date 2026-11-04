import { ExternalLink } from "lucide-react"
import type { Playback } from "../../lib/types"
import { VideoPreview, type Seek } from "../VideoPreview"
import { useT } from "../../i18n"

export function PlayerBox({
  playback,
  poster,
  seek,
  onTime,
  vertical,
}: {
  playback: Playback | null
  poster: string | null
  seek?: Seek | null
  onTime?: (ms: number) => void
  vertical?: boolean
}) {
  const t = useT()
  if (playback && playback.type !== "hls") {
    return (
      <div className="space-y-1.5">
        <div className="relative overflow-hidden rounded-lg bg-black" style={{ aspectRatio: "16 / 9" }}>
          <iframe
            src={playback.url}
            title={t("Linked video")}
            className="absolute inset-0 h-full w-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture"
            allowFullScreen
          />
        </div>
        <p className="flex items-center gap-1 text-xs text-slate-500">
          {playback.credit ?? t("Plays from {platform}", { platform: playback.type === "bilibili" ? "Bilibili" : "YouTube" })}
          {playback.source_url && (
            <a href={playback.source_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 font-semibold text-brand hover:underline">
              {t("Open original")} <ExternalLink size={11} />
            </a>
          )}
        </p>
      </div>
    )
  }
  return (
    <VideoPreview
      src={playback?.url}
      poster={poster}
      seek={seek}
      onTime={onTime}
      aspect={vertical ? "9 / 16" : "16 / 9"}
      className={vertical ? "mx-auto w-full max-w-[300px]" : undefined}
    />
  )
}
