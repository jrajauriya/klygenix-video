import * as SecureStore from "expo-secure-store"

const TOKEN = "kv-token"
const USER = "kv-user"

export interface SessionUser {
  id: number
  name: string
  email: string
  role: string
}

type Listener = (user: SessionUser | null) => void

const listeners = new Set<Listener>()
let cachedToken: string | null | undefined

async function read(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key)
  } catch {
    return null
  }
}

async function write(key: string, value: string | null): Promise<void> {
  try {
    if (value === null) await SecureStore.deleteItemAsync(key)
    else await SecureStore.setItemAsync(key, value)
  } catch {
    return
  }
}

function emit(user: SessionUser | null) {
  listeners.forEach((l) => l(user))
}

export const session = {
  async token(): Promise<string | null> {
    if (cachedToken === undefined) cachedToken = await read(TOKEN)
    return cachedToken
  },

  async user(): Promise<SessionUser | null> {
    const raw = await read(USER)
    if (!raw) return null
    try {
      return JSON.parse(raw) as SessionUser
    } catch {
      return null
    }
  },

  async start(token: string, user: SessionUser): Promise<void> {
    cachedToken = token
    await write(TOKEN, token)
    await write(USER, JSON.stringify(user))
    emit(user)
  },

  async clear(): Promise<void> {
    const had = Boolean(await session.token())
    cachedToken = null
    await write(TOKEN, null)
    await write(USER, null)
    if (had) emit(null)
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
}
