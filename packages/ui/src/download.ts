import { api } from "@klygenixvideo/auth"
import { toast } from "sonner"

export type ExportFormat = "csv" | "xlsx" | "pdf"

export function exportFileName(label: string, params?: URLSearchParams): string {
  const stem = label.replace(/[^a-z0-9]+/gi, "_").toLowerCase().replace(/^_|_$/g, "")
  const from = params?.get("date_from")
  const to = params?.get("date_to")
  if (!from && !to) return stem
  const stamp = [from, to].filter(Boolean).join("_to_").replace(/-/g, "")
  return `${stem}_${stamp}`
}

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export async function downloadReport(
  path: string,
  params: URLSearchParams,
  fmt: ExportFormat,
  filename: string
): Promise<void> {
  const qs = new URLSearchParams(params)
  qs.set("format", fmt)
  try {
    const res = await api.get(`${path}?${qs}`, { responseType: "blob" })
    saveBlob(res.data as Blob, `${exportFileName(filename, params)}.${fmt}`)
  } catch {
    toast.error(`Could not export ${fmt.toUpperCase()}`)
  }
}

export async function downloadFile(path: string, filename: string): Promise<void> {
  try {
    const res = await api.get(path, { responseType: "blob" })
    saveBlob(res.data as Blob, filename)
  } catch {
    toast.error("Could not download the file")
  }
}

export async function printHtml(path: string, label: string): Promise<void> {
  try {
    const res = await api.get(path, { responseType: "text" })
    const iframe = document.createElement("iframe")
    iframe.style.position = "fixed"
    iframe.style.right = "-9999px"
    iframe.style.bottom = "-9999px"
    iframe.style.width = "210mm"
    iframe.style.height = "297mm"
    document.body.appendChild(iframe)
    const cleanup = () => {
      try {
        document.body.removeChild(iframe)
      } catch {
        /* already gone */
      }
    }
    iframe.onload = () => {
      const win = iframe.contentWindow
      if (!win) return cleanup()
      win.focus()
      win.print()
      setTimeout(cleanup, 60_000)
    }
    iframe.srcdoc = res.data as string
  } catch {
    toast.error(`Could not open ${label}`)
  }
}
