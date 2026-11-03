export function ChannelAvatar({ channel, size = 40 }: { channel: { name: string; avatar: string | null }; size?: number }) {
  const style = { width: size, height: size }
  if (channel.avatar) {
    return <img src={channel.avatar} alt="" style={style} className="shrink-0 rounded-full object-cover" />
  }
  return (
    <div
      style={{ ...style, fontSize: size * 0.4 }}
      className="flex shrink-0 items-center justify-center rounded-full bg-brand font-bold text-white"
      aria-hidden
    >
      {(channel.name || "?").charAt(0).toUpperCase()}
    </div>
  )
}
