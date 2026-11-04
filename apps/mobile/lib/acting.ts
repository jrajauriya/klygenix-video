import { useEffect, useSyncExternalStore } from "react"
import * as SecureStore from "expo-secure-store"

import { api, client, errorCode } from "./api"
import { useAuth } from "./auth"
import type { TeamChannel, TeamMe } from "./types"

export const ACTING_HEADER = "X-Kv-Tenant"
const NOT_MEMBER = "team_not_member"

interface State {
  userId: number | null
  tenantId: number | null
  ready: boolean
  removed: boolean
  stamp: number
}

let state: State = { userId: null, tenantId: null, ready: false, removed: false, stamp: 0 }
let loadingFor: number | null | undefined
let checking: Promise<void> | null = null
const listeners = new Set<() => void>()

function put(patch: Partial<State>) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

const storeKey = (userId: number) => `kv-acting-${userId}`

async function persist(userId: number, tenantId: number | null): Promise<void> {
  try {
    if (tenantId === null) await SecureStore.deleteItemAsync(storeKey(userId))
    else await SecureStore.setItemAsync(storeKey(userId), String(tenantId))
  } catch {
    return
  }
}

async function stored(userId: number): Promise<number | null> {
  try {
    const raw = await SecureStore.getItemAsync(storeKey(userId))
    return raw && /^\d+$/.test(raw) ? Number(raw) : null
  } catch {
    return null
  }
}

export const acting = {
  tenant(): number | null {
    return state.ready ? state.tenantId : null
  },

  async load(userId: number | null): Promise<void> {
    if (loadingFor === userId) return
    loadingFor = userId
    put({ userId, tenantId: null, ready: userId === null, removed: false })
    if (userId === null) return
    const tenantId = await stored(userId)
    if (state.userId === userId) put({ tenantId, ready: true })
  },

  choose(tenantId: number | null): void {
    put({ tenantId, removed: false })
    if (state.userId !== null) void persist(state.userId, tenantId)
  },

  drop(): void {
    put({ tenantId: null, removed: true })
    if (state.userId !== null) void persist(state.userId, null)
  },

  dismiss(): void {
    put({ removed: false })
  },

  forbidden(tenantId: number, url: string | undefined, code?: string): Promise<void> {
    if (tenantId !== state.tenantId) return Promise.resolve()
    if (code === NOT_MEMBER) {
      acting.drop()
      return Promise.resolve()
    }
    if (code) {
      if (!url?.includes("/studio/team/me")) put({ stamp: state.stamp + 1 })
      return Promise.resolve()
    }
    if (checking) return checking
    checking = (async () => {
      try {
        const { data } = await api.get<TeamChannel[]>("/api/video/me/channels")
        if (tenantId !== state.tenantId) return
        if (!data.some((c) => c.tenant_id === tenantId && c.role !== "owner")) acting.drop()
        else if (!url?.includes("/studio/team/me")) put({ stamp: state.stamp + 1 })
      } catch {
        return
      } finally {
        checking = null
      }
    })()
    return checking
  },
}

export const studio = client()

studio.interceptors.request.use((config) => {
  const tenantId = acting.tenant()
  if (tenantId !== null) config.headers[ACTING_HEADER] = String(tenantId)
  return config
})

studio.interceptors.response.use(
  (response) => response,
  (error) => {
    const headers = error?.config?.headers
    const sent = typeof headers?.get === "function" ? headers.get(ACTING_HEADER) : headers?.[ACTING_HEADER]
    if (error?.response?.status === 403 && sent) void acting.forbidden(Number(sent), error.config?.url, errorCode(error))
    return Promise.reject(error)
  },
)

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useActing(): State {
  const { user } = useAuth()
  const userId = user?.id ?? null
  useEffect(() => {
    void acting.load(userId)
  }, [userId])
  const snap = useSyncExternalStore(subscribe, () => state)
  return snap.userId === userId ? snap : { ...snap, ready: false }
}

export function can(team: TeamMe | undefined, own: boolean, key: string): boolean {
  if (own) return true
  if (!team) return false
  return !team.permissions || team.permissions[key] === "full"
}
