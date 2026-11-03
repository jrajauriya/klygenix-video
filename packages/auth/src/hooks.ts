import { useEffect, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { api } from "./api"
import { useAuthStore } from "./store"
import type { UserInfo } from "@klygenixvideo/types"

interface LoginResponse {
  access_token: string
  user: UserInfo
}

export function useSignupOpen(): boolean | null {
  const [open, setOpen] = useState<boolean | null>(null)
  useEffect(() => {
    let live = true
    api.get<{ open: boolean }>("/api/auth/signup/open").then((r) => live && setOpen(r.data.open)).catch(() => live && setOpen(false))
    return () => { live = false }
  }, [])
  return open
}

export function useLogin() {
  const setAuth = useAuthStore((s) => s.setAuth)

  return useMutation({
    mutationFn: async (creds: { email: string; password: string; code?: string }) => {
      const { data } = await api.post<LoginResponse>("/api/auth/login", creds)
      return data
    },
    onSuccess: (data) => {
      setAuth(data.access_token, data.user)
    },
  })
}

export function useGoogleLogin() {
  const setAuth = useAuthStore((s) => s.setAuth)

  return useMutation({
    mutationFn: async (googleToken: string) => {
      const { data } = await api.post<LoginResponse>("/api/auth/google", {
        token: googleToken,
      })
      return data
    },
    onSuccess: (data) => {
      setAuth(data.access_token, data.user)
    },
  })
}

export function useLogout() {
  const clearAuth = useAuthStore((s) => s.clearAuth)
  return () => {
    clearAuth()
    window.location.href = "/login"
  }
}

/**
 * Ask the server whether this session is still good.
 *
 * The user is taken from the login response and kept in the store, so nothing ever
 * revalidated it: a tenant suspended or a user deactivated carried on working until the
 * token expired, eight hours later. `GET /api/auth/me` is the endpoint that checks both,
 * and it had no caller at all.
 */
export function useSession() {
  const { token, user, setAuth, clearAuth } = useAuthStore()

  useEffect(() => {
    if (!token) return
    let stale = false
    api
      .get<UserInfo>("/api/auth/me")
      .then(({ data }) => {
        if (!stale) setAuth(token, data)
      })
      .catch((err: { response?: { status?: number } }) => {
        const status = err?.response?.status
        // 401 and 403 are the server saying this session is no longer good. Anything
        // else is the network, and signing a merchant out because their wifi dropped
        // would be its own bug.
        if (!stale && (status === 401 || status === 403)) clearAuth()
      })
    return () => {
      stale = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  return user
}
