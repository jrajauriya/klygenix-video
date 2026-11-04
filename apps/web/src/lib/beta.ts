import { useQuery } from "@tanstack/react-query"
import { getJson } from "./api"
import type { SignupState } from "./types"

export function useSignupState() {
  return useQuery({
    queryKey: ["signup-open"],
    queryFn: () => getJson<SignupState>("/api/auth/signup/open"),
    staleTime: 60_000,
  })
}

export const APP_VERSION = String(import.meta.env.VITE_APP_VERSION || "0.0.1")
