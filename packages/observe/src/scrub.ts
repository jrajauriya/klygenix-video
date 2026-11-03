export const FILTERED = "[Filtered]"

type Json = Record<string, unknown>

const SECRET_KEYS =
  /(^|[_\-.])(password|passwd|secret|token|authorization|auth|cookie|session|api[_\-]?key|apikey|signature|sig|otp|pin|code|link|key|pan|gstin|ifsc|account[_\-]?number|acct|card|cvv|upi|vpa|email|phone|mobile|whatsapp)$/i

const SAFE_KEYS = /(^|[_\-.])(status_code|error_code|http_code)$/i

const DROP_HEADERS = new Set(["authorization", "proxy-authorization", "cookie", "set-cookie", "x-api-key", "referer"])

const RULES: Array<[RegExp, string]> = [
  [/enc:[A-Za-z0-9_\-=+/.:]+/g, "enc:[sealed]"],
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, "[jwt]"],
  [/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [Filtered]"],
  [/\b(kv_live|rzp_live|rzp_test|sk_live|sk_test)_[A-Za-z0-9]+/g, "$1_[Filtered]"],
  [/([?&;#](?:[\w-]*[_-])?(?:token|link|code|signature|sig|key|otp|email|phone)=)[^&#\s"'<>]*/gi, "$1[Filtered]"],
  [/((?:%3F|%26|%23)(?:[\w-]*[_-])?(?:token|link|code|signature|sig|key|otp|email|phone)%3D)(?:(?!%26|%23)[^&#\s"'<>])*/gi, "$1[Filtered]"],
  [/[A-Za-z0-9._%+-]+(?:@|%40)[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gi, "[email]"],
  [/(^|[^0-9A-Za-z])\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z](?![0-9A-Za-z])/gi, "$1[gstin]"],
  [/(^|[^0-9A-Za-z])[A-Z]{5}\d{4}[A-Z](?![0-9A-Za-z])/gi, "$1[pan]"],
  [/(^|[^0-9A-Za-z])[A-Z]{4}0[A-Z0-9]{6}(?![0-9A-Za-z])/g, "$1[ifsc]"],
  [/(^|[^\w.])(?:\+?91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}(?!\w)/g, "$1[phone]"],
  [/(^|[^\w.])\d{4}(?:[ -]\d{4}){2,3}(?:[ -]\d{1,3})?(?!\w)/g, "$1[number]"],
  [/(^|[^\w.])\d{9,18}(?!\w)/g, "$1[number]"],
]

export function scrubText(value: string): string {
  let out = value
  for (const [pattern, repl] of RULES) out = out.replace(pattern, repl)
  return out
}

export function scrubUrl(value: string): string {
  return scrubText(value.split("#")[0])
}

export function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > 12) return FILTERED
  if (typeof value === "string") return scrubText(value)
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, depth + 1))
  if (value && typeof value === "object") {
    const out: Json = {}
    for (const [k, v] of Object.entries(value as Json)) {
      const leaf = typeof v === "string" || typeof v === "number"
      out[k] = leaf && SECRET_KEYS.test(k) && !SAFE_KEYS.test(k) ? FILTERED : scrubValue(v, depth + 1)
    }
    return out
  }
  return value
}

export function scrubBreadcrumb<T extends object>(crumb: T): T | null {
  const c = crumb as unknown as Json
  if (c.category === "ui.input") return null
  const data = c.data as Json | undefined
  if (data && typeof data === "object") {
    for (const field of ["url", "from", "to"]) {
      if (typeof data[field] === "string") data[field] = scrubUrl(data[field] as string)
    }
    delete data["http.query"]
    delete data["http.fragment"]
  }
  return scrubValue(crumb) as T
}

export function scrubEvent<T extends object>(event: T): T | null {
  const e = event as unknown as Json
  delete e.user
  const request = e.request as Json | undefined
  if (request && typeof request === "object") {
    if (typeof request.url === "string") request.url = scrubUrl(request.url)
    if (request.query_string !== undefined) request.query_string = scrubValue(request.query_string)
    delete request.cookies
    delete request.data
    const headers = request.headers as Record<string, string> | undefined
    if (headers && typeof headers === "object") {
      const kept: Record<string, string> = {}
      for (const [k, v] of Object.entries(headers)) {
        if (!DROP_HEADERS.has(k.toLowerCase())) kept[k] = scrubText(String(v))
      }
      request.headers = kept
    }
  }
  const crumbs = e.breadcrumbs
  if (Array.isArray(crumbs)) {
    e.breadcrumbs = crumbs.map((c) => scrubBreadcrumb(c as Json)).filter(Boolean)
  }
  if (typeof e.transaction === "string") e.transaction = scrubUrl(e.transaction)
  for (const field of ["message", "logentry", "exception", "extra", "contexts", "tags", "spans"]) {
    if (e[field] !== undefined) e[field] = scrubValue(e[field])
  }
  return event
}
