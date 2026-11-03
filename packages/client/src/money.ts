/**
 * Money is an integer in the currency's minor unit, and it never travels without its
 * currency code. These are the only functions allowed to turn one into a string.
 *
 * See the master plan §08 rule 01 and §11: the exponent comes from the currency, not
 * from an assumption that everything has two decimals. JPY has none; KWD has three.
 *
 * The exponent belongs to the currency row. `registerCurrencies` hands it the table the
 * API serves; the map below is what formats money before that arrives, and offline.
 */

const EXPONENT: Record<string, number> = {
  BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3,
  BIF: 0, CLP: 0, DJF: 0, GNF: 0, ISK: 0, JPY: 0, KMF: 0,
  KRW: 0, PYG: 0, RWF: 0, UGX: 0, VND: 0, VUV: 0, XAF: 0, XOF: 0, XPF: 0,
}

const FROM_TABLE = new Map<string, number>()

/** What kv_core_tmp.currencies says, once a screen has read it. */
export function registerCurrencies(rows: { code: string; exponent: number }[]): void {
  for (const row of rows ?? []) {
    if (!row?.code || !Number.isInteger(row.exponent)) continue
    if (row.exponent < 0 || row.exponent > 4) continue
    FROM_TABLE.set(row.code.toUpperCase(), row.exponent)
  }
}

export function exponentFor(currency: string): number {
  const code = currency.toUpperCase()
  return FROM_TABLE.get(code) ?? EXPONENT[code] ?? 2
}

/** 1180000 + "INR" -> "₹11,800.00" */
export function formatMoney(minor: number | null | undefined, currency = "INR"): string {
  if (minor === null || minor === undefined) return "—"
  const exp = exponentFor(currency)
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: exp,
    maximumFractionDigits: exp,
  }).format(minor / 10 ** exp)
}

/** The same number with no symbol, for table cells that carry the currency in the header. */
export function formatAmount(minor: number | null | undefined, currency = "INR"): string {
  if (minor === null || minor === undefined) return "—"
  const exp = exponentFor(currency)
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: exp,
    maximumFractionDigits: exp,
  }).format(minor / 10 ** exp)
}

/** "11800.00" -> 1180000. Parses what a human typed into what the API expects. */
export function toMinor(input: string | number, currency = "INR"): number {
  const exp = exponentFor(currency)
  const n = typeof input === "number" ? input : parseFloat(String(input).replace(/[^0-9.-]/g, ""))
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 10 ** exp)
}

/** Minor units to a major-unit string, for a form input. Inverse of toMinor. */
export function fromMinor(minor: number | null | undefined, currency = "INR"): string {
  if (minor === null || minor === undefined) return ""
  const exp = exponentFor(currency)
  return (minor / 10 ** exp).toFixed(exp)
}
