export const PLAY_COUNTRIES = ["IN", "US", "GB", "AE", "SG", "CA", "AU", "DE", "other"] as const
export const PLAY_LANGUAGES = ["en", "hi", "mr", "bn", "ta", "te"] as const

const SIXTEEN = new Set(["DE", "NL", "IE", "LU", "SK", "HU", "RO", "HR", "PL"])

export function countryCode(choice: string): string {
  return choice === "other" ? "ZZ" : choice
}

export function minimumAge(country: string): number {
  const c = countryCode(country).toUpperCase()
  if (c === "IN") return 18
  if (SIXTEEN.has(c)) return 16
  return 13
}

export function ageOn(birth: string, today = new Date()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birth)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  const ty = today.getFullYear()
  const tm = today.getMonth() + 1
  const td = today.getDate()
  return ty - y - (tm < mo || (tm === mo && td < d) ? 1 : 0)
}

export function suggestHandle(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40)
}

export const HANDLE_PATTERN = "[a-zA-Z0-9][a-zA-Z0-9\\-]{2,39}"
