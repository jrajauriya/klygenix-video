import { useCallback, useRef, useState } from "react"
import { ChevronDown, Check } from "lucide-react"
import { cn } from "../utils"
import { Popover, useOutsidePopover } from "./Popover"
import { useUiText } from "../text"

export interface ComboOption {
  value: string
  label: string
}

export function ComboBox({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  allowCustom = true,
  className,
}: {
  value: string
  onChange: (value: string) => void
  options: ComboOption[]
  placeholder?: string
  disabled?: boolean
  allowCustom?: boolean
  className?: string
}) {
  const ui = useUiText()
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState<string | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const close = useCallback(() => {
    setOpen(false)
    setTyped(null)
  }, [])
  useOutsidePopover(box, close, open)

  const shown = typed ?? value
  const filtered = typed
    ? options.filter(
        (o) =>
          o.label.toLowerCase().includes(typed.toLowerCase()) ||
          o.value.toLowerCase().includes(typed.toLowerCase()),
      )
    : options

  const candidate = (typed ?? "").trim()
  const canCreate =
    allowCustom &&
    candidate.length > 0 &&
    !options.some((o) => o.value.toLowerCase() === candidate.toLowerCase())

  function pick(v: string) {
    onChange(v)
    setTyped(null)
    setOpen(false)
  }

  return (
    <div ref={box} className={cn("relative", className)}>
      <input
        className="input pr-8"
        value={shown}
        placeholder={placeholder}
        disabled={disabled}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setTyped(e.target.value)
          setOpen(true)
          if (allowCustom) onChange(e.target.value)
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            if (filtered.length === 1) pick(filtered[0].value)
            else if (canCreate) pick(candidate)
            else {
              setTyped(null)
              setOpen(false)
            }
          }
          if (e.key === "Escape") {
            if (open) e.preventDefault()
            setTyped(null)
            setOpen(false)
          }
        }}
      />
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="absolute right-0 top-0 flex h-full w-8 items-center justify-center text-slate-400 hover:text-slate-600"
        aria-label={ui.t("showOptions")}
      >
        <ChevronDown size={15} />
      </button>

      <Popover anchorRef={box} open={open} maxHeight={224} className="py-1">
        <>
          {filtered.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => pick(o.value)}
              className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50"
            >
              <span>{o.label}</span>
              {o.value === value && <Check size={14} className="text-brand" />}
            </button>
          ))}
          {filtered.length === 0 && !canCreate && (
            <div className="px-3 py-2 text-sm text-slate-400">{ui.t("noMatch")}</div>
          )}
          {canCreate && (
            <button
              type="button"
              onClick={() => pick(candidate)}
              className={cn(
                "w-full px-3 py-2 text-left text-sm font-medium text-brand hover:bg-brand-50",
                filtered.length > 0 && "mt-1 border-t border-slate-100",
              )}
            >
              {ui.t("useValue", { value: candidate })}
            </button>
          )}
        </>
      </Popover>
    </div>
  )
}
