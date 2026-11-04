import { api } from "@klygenixvideo/auth"

export async function download(url: string, fallbackName: string): Promise<void> {
  const res = await api.get<Blob>(url, { responseType: "blob" })
  const header = String(res.headers?.["content-disposition"] ?? "")
  const name = /filename="?([^";]+)"?/i.exec(header)?.[1] ?? fallbackName
  const href = URL.createObjectURL(res.data)
  const a = document.createElement("a")
  a.href = href
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(href), 1000)
}
