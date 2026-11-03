import { useQuery } from "@tanstack/react-query"
import { api } from "@klygenixvideo/auth"
import { registerCurrencies } from "./money"

/**
 * kv_core_tmp.currencies, and the one place the exponent enters the browser. Reading it
 * registers the exponents with the formatters, so a JPY figure stops being divided by
 * a hundred the moment any screen has asked for the list.
 */

export interface Currency {
  code: string
  name: string
  symbol: string | null
  exponent: number
}

export function useCurrencies() {
  return useQuery<Currency[]>({
    queryKey: ["pay-currencies"],
    queryFn: async () => {
      const rows: Currency[] = (await api.get("/api/pay/currencies")).data
      registerCurrencies(rows)
      return rows
    },
    staleTime: 60 * 60_000,
  })
}

/** The codes a document may be raised in, the entity's own first. */
export function currencyOptions(rows: Currency[], functional?: string) {
  const sorted = [...rows].sort((a, b) =>
    a.code === functional ? -1 : b.code === functional ? 1 : a.code.localeCompare(b.code),
  )
  return sorted.map((c) => ({ value: c.code, label: `${c.code} — ${c.name}` }))
}
