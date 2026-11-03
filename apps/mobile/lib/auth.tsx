import { createContext, useContext, useEffect, useState, type ReactNode } from "react"

import { forgetPush, registerForPush } from "./push"
import { session, type SessionUser } from "./session"

interface AuthState {
  user: SessionUser | null
  ready: boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState>({ user: null, ready: false, signOut: async () => {} })

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let alive = true
    Promise.all([session.token(), session.user()]).then(([token, u]) => {
      if (!alive) return
      setUser(token ? u : null)
      setReady(true)
      if (token && u) registerForPush().catch(() => null)
    })
    const off = session.subscribe((u) => {
      setUser(u)
      if (u) registerForPush().catch(() => null)
    })
    return () => {
      alive = false
      off()
    }
  }, [])

  async function signOut() {
    await forgetPush()
    await session.clear()
  }

  return <AuthContext.Provider value={{ user, ready, signOut }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}
