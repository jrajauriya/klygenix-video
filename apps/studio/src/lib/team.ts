import { useSyncExternalStore } from "react"
import { useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { api, useAuthStore } from "@klygenixvideo/auth"
import { useHasPermission as useOwnPermission, type Level } from "@klygenixvideo/client"
import { queryClient } from "./queryClient"
import { useMe } from "./hooks"
import { tr } from "../i18n"
import type { Plan, Usage } from "./types"

export const ACTING_HEADER = "X-Kv-Tenant"
export const OWNER_ONLY = ["video.billing", "video.earnings"]
export const TEAM_ROLES = ["manager", "editor", "moderator", "analyst"] as const
export type TeamRole = (typeof TEAM_ROLES)[number]

export const ROLE_INFO: Record<string, { label: string; what: string }> = {
  owner: { label: "Owner", what: "Owns the channel. Every screen, including money." },
  manager: { label: "Team manager", what: "Runs the channel with you and invites the team. Never sees money." },
  editor: { label: "Editor", what: "Uploads, edits and makes clips." },
  moderator: { label: "Moderator", what: "Looks after comments, danmaku and live chat." },
  analyst: { label: "Analyst", what: "Reads analytics only. Changes nothing." },
}

export interface MyChannel {
  tenant_id: number
  role: string
  name: string
  handle: string
}

export interface TeamMe {
  tenant_id: number
  role: string
  member: boolean
  channel: { name: string; handle: string } | null
  permissions: Record<string, Level> | null
  plan?: Plan | null
  usage?: Usage[]
}

const STORE = "kv-studio-channel"
const RANK: Record<Level, number> = { none: 0, view: 1, full: 2 }
const NOT_MEMBER = "team_not_member"

export function errorCode(err: unknown): string | null {
  const res = (err as { response?: { data?: { code?: unknown }; headers?: Record<string, unknown> & { get?: (k: string) => unknown } } })?.response
  if (!res) return null
  const code = res.data?.code ?? res.headers?.get?.("x-error-code") ?? res.headers?.["x-error-code"]
  return typeof code === "string" && code ? code : null
}

function readStored(): { user: number; tenant: number } | null {
  try {
    const raw = localStorage.getItem(STORE)
    if (!raw) return null
    const v = JSON.parse(raw)
    return typeof v?.user === "number" && typeof v?.tenant === "number" ? v : null
  } catch {
    return null
  }
}

function writeStored(value: { user: number; tenant: number } | null) {
  try {
    if (value) localStorage.setItem(STORE, JSON.stringify(value))
    else localStorage.removeItem(STORE)
  } catch {
    return
  }
}

let stored = readStored()
const listeners = new Set<() => void>()
let go: ((path: string) => void) | null = null

export function actingTenant(): number | null {
  const user = useAuthStore.getState().user
  if (!user || !stored || stored.user !== user.id || stored.tenant === user.tenant_id) return null
  return stored.tenant
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  const unsub = useAuthStore.subscribe(cb)
  return () => {
    listeners.delete(cb)
    unsub()
  }
}

export function useActing(): number | null {
  return useSyncExternalStore(subscribe, actingTenant)
}

export function registerNavigate(fn: (path: string) => void) {
  go = fn
}

export function switchChannel(tenantId: number | null, path = "/") {
  const user = useAuthStore.getState().user
  stored = user && tenantId !== null && tenantId !== user.tenant_id ? { user: user.id, tenant: tenantId } : null
  writeStored(stored)
  queryClient.cancelQueries()
  queryClient.clear()
  listeners.forEach((l) => l())
  go?.(path)
}

type Ids = { req: number; res: number }
const slot = globalThis as unknown as { __kvTeamInterceptors?: Ids }
if (slot.__kvTeamInterceptors) {
  api.interceptors.request.eject(slot.__kvTeamInterceptors.req)
  api.interceptors.response.eject(slot.__kvTeamInterceptors.res)
}
slot.__kvTeamInterceptors = {
  req: api.interceptors.request.use((config) => {
    const t = actingTenant()
    if (t !== null) config.headers.set(ACTING_HEADER, String(t))
    return config
  }),
  res: api.interceptors.response.use(
    (res) => res,
    (err) => {
      const sent = err?.config?.headers?.get?.(ACTING_HEADER)
      if (err?.response?.status === 403 && sent && String(sent) === String(actingTenant()) && errorCode(err) === NOT_MEMBER) {
        switchChannel(null)
        toast.error(tr("You are no longer on that channel's team. Back to your own channel."))
      }
      return Promise.reject(err)
    },
  ),
}

export function useMyChannels() {
  const token = useAuthStore((s) => s.token)
  return useQuery<MyChannel[]>({
    queryKey: ["studio-my-channels"],
    queryFn: async () => (await api.get("/api/video/me/channels")).data,
    enabled: Boolean(token),
    staleTime: 60_000,
  })
}

export function useTeamMe() {
  const acting = useActing()
  return useQuery<TeamMe>({
    queryKey: ["studio-team-me", acting],
    queryFn: async () => (await api.get("/api/video/studio/team/me")).data,
    enabled: acting !== null,
    staleTime: 60_000,
  })
}

export function teamLevel(me: TeamMe | undefined, key: string): Level {
  if (!me || OWNER_ONLY.includes(key)) return "none"
  return me.permissions?.[key] ?? "none"
}

export function useHasPermission(key?: string, level: Level = "view"): boolean {
  const acting = useActing()
  const own = useOwnPermission(key, level)
  const { data: me } = useTeamMe()
  if (acting === null) return own
  if (!key) return true
  return RANK[teamLevel(me, key)] >= RANK[level]
}

export function roleLabel(role: string): string {
  return ROLE_INFO[role]?.label ?? role.replace(/_/g, " ")
}

export function useStudioPlan() {
  const acting = useActing()
  const me = useMe()
  const team = useTeamMe()
  if (acting === null) return { plan: me.data?.plans.creator, usage: me.data?.usage, theirs: false, isLoading: me.isLoading }
  return { plan: team.data?.plan ?? undefined, usage: team.data?.usage, theirs: true, isLoading: team.isLoading }
}
