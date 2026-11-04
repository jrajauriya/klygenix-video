import * as tus from "tus-js-client"
import type { UploadTicket } from "./types"
import { tr } from "../i18n"

export interface Transfer {
  done: Promise<void>
  abort: () => void
}

export function sendFile(file: File, ticket: UploadTicket, onProgress: (fraction: number) => void): Transfer {
  return ticket.protocol === "tus" ? viaTus(file, ticket, onProgress) : viaPut(file, ticket, onProgress)
}

function viaPut(file: File, ticket: UploadTicket, onProgress: (fraction: number) => void): Transfer {
  const xhr = new XMLHttpRequest()
  const done = new Promise<void>((resolve, reject) => {
    xhr.open(ticket.method || "PUT", ticket.url)
    for (const [k, v] of Object.entries(ticket.headers ?? {})) xhr.setRequestHeader(k, v)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(1)
        resolve()
      } else {
        reject(new Error(uploadError(xhr)))
      }
    }
    xhr.onerror = () => reject(new Error(tr("The upload stopped. Check your connection and try again.")))
    xhr.onabort = () => reject(new Error(tr("Upload cancelled")))
    xhr.send(file)
  })
  return { done, abort: () => xhr.abort() }
}

function uploadError(xhr: XMLHttpRequest): string {
  try {
    const body = JSON.parse(xhr.responseText)
    if (typeof body?.detail === "string") return body.detail
  } catch {
    return tr("The upload was refused ({status}).", { status: xhr.status })
  }
  return tr("The upload was refused ({status}).", { status: xhr.status })
}

function viaTus(file: File, ticket: UploadTicket, onProgress: (fraction: number) => void): Transfer {
  let upload: tus.Upload | null = null
  const done = new Promise<void>((resolve, reject) => {
    upload = new tus.Upload(file, {
      endpoint: ticket.url,
      headers: ticket.headers ?? {},
      metadata: { filetype: file.type || "video/mp4", title: file.name },
      retryDelays: [0, 3000, 5000, 10000, 20000],
      chunkSize: 50 * 1024 * 1024,
      onProgress: (sent, total) => onProgress(total ? sent / total : 0),
      onSuccess: () => {
        onProgress(1)
        resolve()
      },
      onError: (e) => reject(e instanceof Error ? e : new Error(String(e))),
    })
    upload.start()
  })
  return {
    done,
    abort: () => {
      upload?.abort(true).catch(() => undefined)
    },
  }
}
