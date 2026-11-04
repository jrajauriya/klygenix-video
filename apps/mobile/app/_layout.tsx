import { useEffect, useRef } from "react"
import { AppState } from "react-native"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Stack } from "expo-router"
import { StatusBar } from "expo-status-bar"
import { SafeAreaProvider } from "react-native-safe-area-context"

import { AuthProvider, useAuth } from "../lib/auth"
import { sweepDownloads } from "../lib/downloads"
import { LanguageProvider, useT } from "../lib/i18n"
import { usePushRouting } from "../lib/push"

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
  },
})

const SWEEP_EVERY = 5 * 60_000

function useDownloadSweep() {
  const { user, ready } = useAuth()
  const last = useRef(0)
  useEffect(() => {
    if (!ready) return
    const run = () => {
      if (Date.now() - last.current < SWEEP_EVERY) return
      last.current = Date.now()
      sweepDownloads(Boolean(user)).catch(() => null)
    }
    last.current = 0
    run()
    const sub = AppState.addEventListener("change", (state) => state === "active" && run())
    return () => sub.remove()
  }, [user, ready])
}

function Screens() {
  const { t } = useT()
  usePushRouting()
  useDownloadSweep()
  const pushed = { headerShown: true, title: "", headerBackTitle: t("common.back"), headerTintColor: "#A21CAF" }
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="watch/[id]" options={pushed} />
      <Stack.Screen name="channel/[handle]" options={pushed} />
      <Stack.Screen name="live/[id]" options={pushed} />
      <Stack.Screen name="study/[id]" options={pushed} />
      <Stack.Screen name="inbox" options={{ ...pushed, title: t("inbox.title") }} />
      <Stack.Screen name="downloads" options={{ ...pushed, title: t("download.title") }} />
      <Stack.Screen name="team/accept" options={{ ...pushed, title: t("invite.title") }} />
    </Stack>
  )
}

export default function Layout() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <LanguageProvider>
            <StatusBar style="auto" />
            <Screens />
          </LanguageProvider>
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  )
}
