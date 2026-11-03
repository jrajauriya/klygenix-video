export type Lang = "en" | "hi"

let current: Lang = "en"

export function toLang(code: unknown): Lang {
  return code === "hi" ? "hi" : "en"
}

export const language = {
  get: (): Lang => current,
  set: (next: Lang): void => {
    current = next
  },
}
