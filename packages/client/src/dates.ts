/** Dates, with the timezone supplied rather than assumed. */

/** Format an instant in a given zone. Naive strings are assumed UTC, as the API sends. */
export function formatDate(
  value: string | null | undefined,
  timezone: string,
  withTime = false,
): string {
  if (!value) return "—"
  const iso = /[Zz]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleString("en-GB", {
    timeZone: timezone,
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
  })
}

/** A business date, rendered as written. */
export function formatBusinessDate(iso: string | null | undefined): string {
  if (!iso) return "—"
  const [y, m, d] = iso.split("-")
  if (!y || !m || !d) return "—"
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  return `${d} ${MONTHS[Number(m) - 1] ?? m} ${y}`
}

/** Today, in a given zone, as YYYY-MM-DD. The default business date for a new document. */
export function todayIn(timezone: string): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: timezone })
}

/** `days` before a date, as YYYY-MM-DD. */
export function daysBefore(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number)
  const utc = Date.UTC(y, m - 1, d) - days * 86_400_000
  return new Date(utc).toISOString().slice(0, 10)
}
