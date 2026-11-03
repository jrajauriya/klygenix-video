import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Stack } from "expo-router"
import { StatusBar } from "expo-status-bar"
import { SafeAreaProvider } from "react-native-safe-area-context"

import { AuthProvider } from "../lib/auth"
import { LanguageProvider, useT } from "../lib/i18n"
import { usePushRouting } from "../lib/push"

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
  },
})

function Screens() {
  const { t } = useT()
  usePushRouting()
  const pushed = { headerShown: true, title: "", headerBackTitle: t("common.back"), headerTintColor: "#A21CAF" }
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="watch/[id]" options={pushed} />
      <Stack.Screen name="channel/[handle]" options={pushed} />
      <Stack.Screen name="live/[id]" options={pushed} />
      <Stack.Screen name="study/[id]" options={pushed} />
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
