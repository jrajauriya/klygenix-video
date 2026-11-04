import { useMemo } from "react"
import { toQR } from "toqr"

export function Qr({ text, label }: { text: string; label: string }) {
  const { size, path } = useMemo(() => {
    const cells = toQR(text)
    const n = Math.round(Math.sqrt(cells.length))
    let d = ""
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (cells[y * n + x]) d += `M${x + 4} ${y + 4}h1v1h-1z`
    return { size: n + 8, path: d }
  }, [text])
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${size} ${size}`} className="h-[18rem] w-[18rem] rounded-2xl bg-white" shapeRendering="crispEdges">
      <path d={path} fill="#000" />
    </svg>
  )
}
