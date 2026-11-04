import { Fragment, createContext, useContext, useMemo, type ReactNode } from "react"

export const UI_TEXT = {
  search: "Search…",
  searchOptions: "Search options",
  select: "Select…",
  clearSelection: "Clear selection",
  noMatches: "No matches",
  noMatch: "No match",
  showOptions: "Show options",
  useValue: "Use \"{value}\"",
  back: "Back",
  close: "Close",
  cancel: "Cancel",
  confirm: "Confirm",
  working: "Working…",
  removing: "Removing…",
  saving: "Saving…",
  loading: "Loading…",
  nothingToShow: "Nothing to show.",
  rows: "rows",
  tableOf: "Table of {unit}",
  pageOf: "Page {page} of {pages} ({total} {unit})",
  perPage: "{n} / page",
  rowsPerPage: "Rows per page",
  pages: "Pages",
  prev: "Prev",
  next: "Next",
  pageN: "Page {n}",
  showPassword: "Show password",
  hidePassword: "Hide password",
  shrinkBack: "Shrink back",
  fullScreen: "Use the full screen",
  openMenu: "Open menu",
  closeMenu: "Close menu",
  collapseSidebar: "Collapse sidebar",
  expandSidebar: "Expand sidebar",
  mainNav: "Main",
  accountMenu: "account menu",
  theme: "Theme",
  signOut: "Sign out",
  "password.title": "Change password",
  "password.current": "Current password",
  "password.new": "New password",
  "password.confirm": "Confirm new password",
  "password.minHint": "At least {n} characters",
  "password.enterCurrent": "Enter the password you use now",
  "password.tooShort": "Password must be at least {n} characters",
  "password.mismatch": "The two passwords do not match",
  "password.failed": "Could not change the password",
  "file.drop": "Drop your Excel file here",
  "file.or": "or",
  "file.browse": "click to browse",
  "file.hint": ".xlsx or .csv — Max {n}MB",
  "file.tooBig": "{name} is larger than {n} MB",
  "file.rows": "{n} rows · ",
  "file.addPage": "Add another page",
  "file.remove": "Remove {name}",
  "line.add": "Add line",
  "line.empty": "No lines yet.",
  "line.remove": "Remove line {n}",
  "roles.screen": "Screen",
  "roles.owner": "Owner",
  "roles.alwaysFull": "always full",
  "roles.ownerKeeps": "An owner always keeps every screen",
  "roles.none": "Hidden",
  "roles.view": "View",
  "roles.full": "Full",
  "roles.saved": "Screen access saved",
  "roles.failed": "Could not save",
  "roles.role": "Role",
  "roles.cell": "{role} — {screen}: {level}",
  "theme.subtitle": "How {app} looks for you — other people are not affected",
  "theme.full": "Whole application",
  "theme.fullNote": "Changes every surface, including the page",
  "theme.chrome": "Sidebar, header and buttons",
  "theme.chromeNote": "The page stays light and easy to read",
  "theme.saved": "Saved to your account, so it follows you to any device. Each app is set separately.",
}

export type UiTextKey = keyof typeof UI_TEXT
export type UiText = Record<UiTextKey, string>
type Vars = Record<string, string | number>

interface Ctx {
  text: Partial<UiText>
  locale: string
}

const UiTextContext = createContext<Ctx>({ text: {}, locale: "en-IN" })

export function UiTextProvider({ text, locale = "en-IN", children }: { text?: Partial<UiText>; locale?: string; children: ReactNode }) {
  const value = useMemo(() => ({ text: text ?? {}, locale }), [text, locale])
  return <UiTextContext.Provider value={value}>{children}</UiTextContext.Provider>
}

export function useUiText() {
  const { text, locale } = useContext(UiTextContext)
  return useMemo(() => {
    const num = (n: number) => new Intl.NumberFormat(locale).format(n)
    const raw = (key: UiTextKey) => text[key] ?? UI_TEXT[key]
    const t = (key: UiTextKey, vars?: Vars) =>
      vars ? raw(key).replace(/\{(\w+)\}/g, (all, name: string) => {
        const v = vars[name]
        if (v === undefined) return all
        return typeof v === "number" ? num(v) : v
      }) : raw(key)
    const rich = (key: UiTextKey, vars: Record<string, ReactNode>) =>
      raw(key).split(/(\{\w+\})/g).map((part, i) => {
        const m = part.match(/^\{(\w+)\}$/)
        if (!m || !(m[1] in vars)) return part ? <Fragment key={i}>{part}</Fragment> : null
        const v = vars[m[1]]
        return <Fragment key={i}>{typeof v === "number" ? num(v) : v}</Fragment>
      })
    return { t, rich, num, locale }
  }, [text, locale])
}
