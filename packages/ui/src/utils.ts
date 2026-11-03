import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

// Money and date helpers live in @klygenixvideo/client — they need a currency and a timezone.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Quantity, to at most three decimals, trailing zeros trimmed. Currency-neutral. */
export function formatQty(qty: number | string | null | undefined): string {
  const n = typeof qty === "string" ? parseFloat(qty) : (qty ?? 0)
  if (Number.isNaN(n)) return "0"
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")
}

/** "2026-09-13" -> "13/09/2026". A hint under a date input, not a formatter. */
export function dmyHint(iso: string): string {
  if (!iso) return ""
  const [y, m, d] = iso.split("-")
  return d && m && y ? `${d}/${m}/${y}` : ""
}
