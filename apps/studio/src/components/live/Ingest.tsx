import { useState } from "react"
import { toast } from "sonner"
import { Copy, Eye, EyeOff, RotateCcw } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { Button, Card, useConfirm } from "@klygenixvideo/ui"
import { detail } from "../../lib/format"
import { LIVE_STUDIO, copyText, type LiveStream } from "../../lib/live"

function CopyRow({ label, value, secret, shown }: { label: string; value: string; secret?: boolean; shown?: boolean }) {
  const masked = secret && !shown
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-slate-500">{label}</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs text-slate-800">
          {masked ? "•".repeat(24) : value}
        </code>
        <Button size="sm" variant="outline" disabled={masked} aria-label={`Copy ${label.toLowerCase()}`}
          onClick={async () => {
            if (await copyText(value)) toast.success(`${label} copied`)
            else toast.error("Could not copy")
          }}>
          <Copy size={13} /> Copy
        </Button>
      </div>
    </div>
  )
}

export function IngestDetails({ stream }: { stream: LiveStream }) {
  const confirm = useConfirm()
  const [key, setKey] = useState<{ server: string; stream_key: string } | null>(null)
  const [shown, setShown] = useState(false)
  const [busy, setBusy] = useState<"reveal" | "rotate" | null>(null)
  const closed = stream.status === "ended" || stream.status === "failed"

  async function reveal() {
    if (key) {
      setShown((v) => !v)
      return
    }
    setBusy("reveal")
    try {
      const { data } = await api.get<{ server: string; stream_key: string }>(`${LIVE_STUDIO}/${stream.id}/key`)
      setKey(data)
      setShown(true)
    } catch (err) {
      toast.error(detail(err, "Could not load the stream key"))
    } finally {
      setBusy(null)
    }
  }

  async function rotate() {
    const ok = await confirm({
      title: "Make a new stream key?",
      message: "The old key stops working at once. Paste the new key into OBS or any other encoder before you go live.",
      confirmLabel: "Make a new key",
      variant: "destructive",
    })
    if (!ok) return
    setBusy("rotate")
    try {
      const { data } = await api.post<{ stream_key: string }>(`${LIVE_STUDIO}/${stream.id}/rotate-key`)
      setKey({ server: key?.server ?? stream.ingest.server, stream_key: data.stream_key })
      setShown(true)
      toast.success("New stream key made")
    } catch (err) {
      toast.error(detail(err, "Could not make a new key"))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-navy">Stream from OBS or an encoder</h2>
          <p className="mt-0.5 text-sm text-slate-500">Keep the stream key secret. Anyone with it can stream to your channel.</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={reveal} disabled={busy !== null || closed}>
            {shown ? <EyeOff size={13} /> : <Eye size={13} />} {busy === "reveal" ? "Loading…" : shown ? "Hide" : "Reveal"}
          </Button>
          <Button size="sm" variant="ghost" onClick={rotate} disabled={busy !== null || closed || stream.status === "live"}
            title={stream.status === "live" ? "End the stream before making a new key" : undefined}>
            <RotateCcw size={13} /> {busy === "rotate" ? "Making…" : "New key"}
          </Button>
        </div>
      </div>
      <CopyRow label="Server URL" value={key?.server ?? stream.ingest.server} />
      <CopyRow label="Stream key" value={key?.stream_key ?? ""} secret shown={shown && Boolean(key)} />
      <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-600">
        <li>In OBS, open <b>Settings → Stream</b> and choose <b>Custom…</b> as the service.</li>
        <li>Paste the server URL into <b>Server</b> and the stream key into <b>Stream Key</b>.</li>
        <li>Under <b>Output</b>, use a keyframe interval of 2 seconds and 2,500–4,500 Kbps for 720p.</li>
        <li>Press <b>Start Streaming</b>. The status here turns to Live within a few seconds.</li>
      </ol>
    </Card>
  )
}
