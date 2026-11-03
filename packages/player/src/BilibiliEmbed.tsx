import { cx } from "./format"

export interface BilibiliEmbedProps {
  bvid?: string
  src?: string
  title?: string
  className?: string
}

export const BILIBILI_TIME_SYNC = false

export function BilibiliEmbed({ bvid, src, title = "Bilibili video player", className }: BilibiliEmbedProps) {
  const url = src ?? `https://player.bilibili.com/player.html?bvid=${encodeURIComponent(bvid ?? "")}&autoplay=0`
  return (
    <div className={cx("relative overflow-hidden bg-black", className)}>
      <iframe
        src={url}
        title={title}
        className="absolute inset-0 h-full w-full border-0"
        allow="fullscreen; picture-in-picture; encrypted-media"
        allowFullScreen
        referrerPolicy="no-referrer"
        loading="lazy"
      />
    </div>
  )
}
