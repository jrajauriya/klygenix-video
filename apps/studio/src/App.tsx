import { RouterProvider } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ConfirmDialogProvider, Toaster, UiTextProvider, isDarkTheme, useThemeKey } from "@klygenixvideo/ui"
import { router } from "./router"
import { useLang } from "./i18n"
import { UI_HI } from "./locales/ui-hi"

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
})

export default function App() {
  const themed = isDarkTheme(useThemeKey("studio")) ? "dark" : "light"
  const hindi = useLang() === "hi"

  return (
    <QueryClientProvider client={queryClient}>
      <UiTextProvider text={hindi ? UI_HI : undefined} locale={hindi ? "hi-IN" : "en-IN"}>
        <ConfirmDialogProvider>
          <RouterProvider router={router} />
          <Toaster position="top-right" richColors offset={8} theme={themed} />
        </ConfirmDialogProvider>
      </UiTextProvider>
    </QueryClientProvider>
  )
}
