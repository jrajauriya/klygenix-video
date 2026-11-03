import { useEffect, useState } from "react"

export const THEMES = [
  {
    key: "light",
    label: "Light",
    hint: "The default — white throughout",
    group: "full",
    swatch: { side: "#ffffff", hdr: "#ffffff", ink: "#0b2a4a", accent: "", rule: "#e2e8f0" },
  },
  {
    key: "dark",
    label: "Dark",
    hint: "Near-black surfaces, light text",
    group: "full",
    swatch: { side: "#111721", hdr: "#111721", ink: "#e8eef7", accent: "", rule: "#2c3646" },
  },
  {
    key: "midnight",
    label: "Midnight",
    hint: "Deep navy surfaces throughout",
    group: "full",
    swatch: { side: "#0e1626", hdr: "#0e1626", ink: "#e6eefc", accent: "", rule: "#243350" },
  },
  {
    key: "ocean",
    label: "Ocean",
    hint: "Deep blue sidebar",
    group: "chrome",
    swatch: { side: "#102741", hdr: "#ffffff", ink: "#b6c6d8", accent: "#174e8c", rule: "#1b406a" },
  },
  {
    key: "forest",
    label: "Forest",
    hint: "Deep green sidebar",
    group: "chrome",
    swatch: { side: "#163b2c", hdr: "#ffffff", ink: "#becfc8", accent: "#126e47", rule: "#246047" },
  },
  {
    key: "plum",
    label: "Plum",
    hint: "Deep purple sidebar",
    group: "chrome",
    swatch: { side: "#2d183a", hdr: "#ffffff", ink: "#c9c0ce", accent: "#61178c", rule: "#4a265e" },
  },
  {
    key: "charcoal",
    label: "Charcoal",
    hint: "Near-black sidebar",
    group: "chrome",
    swatch: { side: "#25272d", hdr: "#ffffff", ink: "#c0c5ce", accent: "#173e8c", rule: "#3c4049" },
  },
  {
    key: "crimson",
    label: "Crimson",
    hint: "Deep red sidebar",
    group: "chrome",
    swatch: { side: "#3c151a", hdr: "#ffffff", ink: "#d1bdbf", accent: "#8c1727", rule: "#62222b" },
  },
  {
    key: "teal",
    label: "Teal",
    hint: "Deep teal sidebar",
    group: "chrome",
    swatch: { side: "#123c3f", hdr: "#ffffff", ink: "#b9d3d5", accent: "#12686e", rule: "#1e6267" },
  },
  {
    key: "indigo",
    label: "Indigo",
    hint: "Deep indigo sidebar",
    group: "chrome",
    swatch: { side: "#18163c", hdr: "#ffffff", ink: "#bebdd0", accent: "#1d178c", rule: "#262361" },
  },
  {
    key: "bronze",
    label: "Bronze",
    hint: "Warm brown sidebar",
    group: "chrome",
    swatch: { side: "#3a2718", hdr: "#ffffff", ink: "#cec6c0", accent: "#8c4a17", rule: "#5e3f26" },
  },
  {
    key: "pine",
    label: "Pine",
    hint: "Dark evergreen sidebar",
    group: "chrome",
    swatch: { side: "#193832", hdr: "#ffffff", ink: "#c0cecb", accent: "#126e5b", rule: "#295b51" },
  },
  {
    key: "wine",
    label: "Wine",
    hint: "Dark burgundy sidebar",
    group: "chrome",
    swatch: { side: "#381929", hdr: "#ffffff", ink: "#cec0c7", accent: "#8c1752", rule: "#5b2942" },
  },
  {
    key: "sand",
    label: "Sand",
    hint: "Warm sand sidebar",
    group: "chrome",
    swatch: { side: "#f7f1e9", hdr: "#fbf8f4", ink: "#4c3410", accent: "#8c5617", rule: "#e9dac4" },
  },
  {
    key: "mint",
    label: "Mint",
    hint: "Soft mint sidebar",
    group: "chrome",
    swatch: { side: "#eaf6f1", hdr: "#f4faf8", ink: "#124935", accent: "#126e4c", rule: "#c6e7db" },
  },
  {
    key: "sky",
    label: "Sky",
    hint: "Soft blue sidebar",
    group: "chrome",
    swatch: { side: "#e7f1f9", hdr: "#f3f8fc", ink: "#0b3450", accent: "#175b8c", rule: "#bedaef" },
  },
  {
    key: "rose",
    label: "Rose",
    hint: "Soft pink sidebar",
    group: "chrome",
    swatch: { side: "#f8e7eb", hdr: "#fcf3f5", ink: "#500b1c", accent: "#8c1732", rule: "#edc0ca" },
  },
  {
    key: "lilac",
    label: "Lilac",
    hint: "Soft lavender sidebar",
    group: "chrome",
    swatch: { side: "#efe9f7", hdr: "#f7f4fb", ink: "#29104c", accent: "#48178c", rule: "#d3c4e9" },
  },
  {
    key: "stone",
    label: "Stone",
    hint: "Soft warm grey sidebar",
    group: "chrome",
    swatch: { side: "#f2f0ee", hdr: "#f8f7f6", ink: "#3d2e1f", accent: "#8c4817", rule: "#dbd6d1" },
  },
] as const

export type ThemeKey = (typeof THEMES)[number]["key"]
export type ThemeGroup = "full" | "chrome"

export const DEFAULT_THEME: ThemeKey = "light"

const DARK_THEMES: ThemeKey[] = ["dark", "midnight"]

export function isDarkTheme(theme: ThemeKey): boolean {
  return DARK_THEMES.includes(theme)
}

const AUTH_KEY = "klygenix-video-auth"

export function isThemeKey(v: unknown): v is ThemeKey {
  return typeof v === "string" && THEMES.some((t) => t.key === v)
}

export function readStoredTheme(app: string): ThemeKey {
  try {
    const raw = localStorage.getItem(AUTH_KEY)
    if (!raw) return DEFAULT_THEME
    const themes = JSON.parse(raw)?.state?.user?.settings?.theme
    const picked = themes?.[app]
    return isThemeKey(picked) ? picked : DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

export function applyTheme(theme: ThemeKey) {
  const root = document.documentElement
  if (theme === DEFAULT_THEME) root.removeAttribute("data-theme")
  else root.setAttribute("data-theme", theme)
  root.style.colorScheme = isDarkTheme(theme) ? "dark" : "light"
  window.dispatchEvent(new CustomEvent("ixaitech-theme", { detail: theme }))
}

export function useThemeKey(app: string): ThemeKey {
  const [theme, setTheme] = useState<ThemeKey>(() => readStoredTheme(app))
  useEffect(() => {
    const onChange = (e: Event) => {
      const next = (e as CustomEvent).detail
      if (isThemeKey(next)) setTheme(next)
    }
    window.addEventListener("ixaitech-theme", onChange)
    return () => window.removeEventListener("ixaitech-theme", onChange)
  }, [])
  return theme
}

export function bootTheme(app: string): ThemeKey {
  const theme = readStoredTheme(app)
  applyTheme(theme)
  return theme
}
