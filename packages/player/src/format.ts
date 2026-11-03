export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(2, "0")
  const ss = String(s).padStart(2, "0")
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

export function activeChapter<T extends { start_ms: number }>(chapters: T[] | undefined, ms: number): T | undefined {
  if (!chapters?.length) return undefined
  let found: T | undefined
  for (const c of chapters) {
    if (c.start_ms <= ms) found = c
    else break
  }
  return found
}

export function hashUnit(value: string | number): number {
  const s = String(value)
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 10000) / 10000
}

export function isBlocked(text: string, blocked: string[] | undefined): boolean {
  if (!blocked?.length) return false
  const lower = text.toLowerCase()
  return blocked.some((w) => {
    const word = w.trim().toLowerCase()
    return word.length > 0 && lower.includes(word)
  })
}

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ")
}
