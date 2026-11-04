import { useEffect, useRef } from "react"

const LETTERS = ["1234567890", "qwertyuiop", "asdfghjkl'", "zxcvbnm,.?"]

export function Keyboard({ value, onChange, onSubmit, submitLabel, max = 200, label, auto }: {
  value: string
  onChange: (next: string) => void
  onSubmit?: () => void
  submitLabel?: string
  max?: number
  label: string
  auto?: boolean
}) {
  const latest = useRef({ value, onChange, onSubmit })
  latest.current = { value, onChange, onSubmit }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const { value: v, onChange: set } = latest.current
      if (e.key === "Backspace" && v) {
        e.preventDefault()
        set(v.slice(0, -1))
      } else if (e.key.length === 1 && /[\p{L}\p{N}\p{P} ]/u.test(e.key)) {
        e.preventDefault()
        if (v.length < max) set(v + e.key)
      }
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [max])

  const type = (ch: string) => {
    if (value.length < max) onChange(value + ch)
  }
  const key = "h-[4.25rem] rounded-xl bg-panel-3 text-3xl font-semibold text-ink hover:bg-line"
  return (
    <div role="group" aria-label={label} data-focus-group className="flex flex-col gap-3">
      {LETTERS.map((row, r) => (
        <div key={row} className="grid grid-cols-10 gap-3">
          {[...row].map((ch, i) => (
            <button
              key={ch}
              type="button"
              className={key}
              onClick={() => type(ch)}
              data-autofocus={auto && r === 1 && i === 0 ? true : undefined}
              aria-label={ch === "'" ? "apostrophe" : ch === "," ? "comma" : ch === "." ? "full stop" : ch === "?" ? "question mark" : ch}
            >
              {ch}
            </button>
          ))}
        </div>
      ))}
      <div className="grid grid-cols-10 gap-3">
        <button type="button" className={`${key} col-span-4`} onClick={() => type(" ")}>Space</button>
        <button type="button" className={`${key} col-span-2`} onClick={() => onChange(value.slice(0, -1))}>Delete</button>
        <button type="button" className={`${key} col-span-2`} onClick={() => onChange("")}>Clear</button>
        {onSubmit && (
          <button type="button" className={`${key} col-span-2 bg-brand text-white hover:bg-brand-hover`} onClick={onSubmit}>
            {submitLabel ?? "Done"}
          </button>
        )}
      </div>
    </div>
  )
}

export function TypedText({ id, label, value, placeholder }: { id: string; label: string; value: string; placeholder: string }) {
  return (
    <div className="rounded-2xl border-2 border-line bg-panel px-6 py-4">
      <p id={`${id}-label`} className="text-lg font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p aria-live="polite" className="mt-1 min-h-[3rem] whitespace-pre-wrap break-words text-4xl font-semibold">
        {value || <span className="text-muted">{placeholder}</span>}
      </p>
    </div>
  )
}
