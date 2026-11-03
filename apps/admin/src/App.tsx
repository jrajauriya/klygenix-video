import { RouterProvider } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ConfirmDialogProvider, Toaster, useThemeKey, isDarkTheme } from "@klygenixvideo/ui"
import { router } from "./router"

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
})

export default function App() {
  const themed = isDarkTheme(useThemeKey("admin")) ? "dark" : "light"

  return (
    <QueryClientProvider client={queryClient}>
      {/* The provider must sit OUTSIDE RouterProvider, or useConfirm() throws on
          any route that calls it. */}
      <ConfirmDialogProvider>
        <RouterProvider router={router} />
        <Toaster position="top-right" richColors offset={8} theme={themed} />
      </ConfirmDialogProvider>
    </QueryClientProvider>
  )
}
