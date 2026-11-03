import { useRef, useState } from "react"
import { Upload, X, FileSpreadsheet } from "lucide-react"
import { toast } from "sonner"
import { cn } from "../utils"
import { Button } from "./primitives"
import { useUiText } from "../text"

export interface FileDropzoneProps {
  accept: string
  maxSizeMB: number
  onFileSelect: (file: File) => void
  file: File | null
  onRemove: () => void
  rowCount?: number
  title?: string
  hint?: string
  multiple?: boolean
  onFilesSelect?: (files: File[]) => void
  files?: File[]
  onRemoveAt?: (index: number) => void
}

export function FileDropzone({
  accept,
  maxSizeMB,
  onFileSelect,
  file,
  onRemove,
  rowCount,
  title,
  hint,
  multiple = false,
  onFilesSelect,
  files,
  onRemoveAt,
}: FileDropzoneProps) {
  const ui = useUiText()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  function accepted(list: File[]): File[] {
    const good: File[] = []
    for (const f of list) {
      if (f.size > maxSizeMB * 1024 * 1024) {
        toast.error(ui.t("file.tooBig", { name: f.name, n: maxSizeMB }))
        continue
      }
      good.push(f)
    }
    return good
  }

  function take(list: File[]) {
    const good = accepted(list)
    if (!good.length) return
    if (multiple && onFilesSelect) onFilesSelect(good)
    else onFileSelect(good[0])
  }

  const chosen = multiple ? files ?? [] : file ? [file] : []

  if (chosen.length > 0) {
    return (
      <div className="space-y-2">
        {chosen.map((f, i) => (
          <div
            key={`${f.name}-${i}`}
            className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 p-3"
          >
            <div className="flex min-w-0 items-center gap-3">
              <FileSpreadsheet className="h-8 w-8 shrink-0 text-green-600" />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{f.name}</div>
                <div className="text-xs text-slate-500">
                  {rowCount != null && chosen.length === 1 ? ui.t("file.rows", { n: rowCount }) : ""}
                  {(f.size / 1024).toFixed(0)} KB
                </div>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label={ui.t("file.remove", { name: f.name })}
              onClick={() => (multiple && onRemoveAt ? onRemoveAt(i) : onRemove())}
            >
              <X className="h-4 w-4 text-red-600" />
            </Button>
          </div>
        ))}
        {multiple && (
          <button
            type="button"
            className="text-xs font-semibold text-brand underline"
            onClick={() => inputRef.current?.click()}
          >
            {ui.t("file.addPage")}
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          className="hidden"
          onChange={(e) => {
            const list = Array.from(e.target.files ?? [])
            if (list.length) take(list)
            e.target.value = ""
          }}
        />
      </div>
    )
  }

  return (
    <>
      <div
        className={cn(
          "cursor-pointer rounded-xl border-2 border-dashed p-10 text-center transition-colors",
          dragOver ? "border-brand bg-brand-50" : "border-slate-300 bg-slate-50"
        )}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          const list = Array.from(e.dataTransfer.files)
          if (list.length) take(list)
        }}
      >
        <Upload className="mx-auto mb-2 h-8 w-8 text-slate-500" />
        <p className="text-sm font-medium">{title ?? ui.t("file.drop")}</p>
        <p className="mt-1 text-xs text-slate-500">
          {ui.t("file.or")} <span className="text-brand underline">{ui.t("file.browse")}</span>
        </p>
        <p className="mt-2 text-xs text-slate-500">
          {hint ?? ui.t("file.hint", { n: maxSizeMB })}
        </p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          const list = Array.from(e.target.files ?? [])
          if (list.length) take(list)
          e.target.value = ""
        }}
      />
    </>
  )
}
