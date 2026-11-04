import { RouterProvider } from "react-router-dom"
import { QueryClientProvider } from "@tanstack/react-query"
import { ConfirmDialogProvider, Toaster, UiTextProvider, isDarkTheme, useThemeKey } from "@klygenixvideo/ui"
import { router } from "./router"
import { useLang } from "./i18n"
import { UI_HI } from "./locales/ui-hi"
import { queryClient } from "./lib/queryClient"
import { registerNavigate, useActing } from "./lib/team"

registerNavigate((path) => {
  router.navigate(path)
})

export default function App() {
  const themed = isDarkTheme(useThemeKey("studio")) ? "dark" : "light"
  const hindi = useLang() === "hi"
  const acting = useActing()

  return (
    <QueryClientProvider client={queryClient}>
      <UiTextProvider text={hindi ? UI_HI : undefined} locale={hindi ? "hi-IN" : "en-IN"}>
        <ConfirmDialogProvider>
          <RouterProvider key={acting ?? "own"} router={router} />
          <Toaster position="top-right" richColors offset={8} theme={themed} />
        </ConfirmDialogProvider>
      </UiTextProvider>
    </QueryClientProvider>
  )
}
