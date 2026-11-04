import { useMemo } from "react"
import { RouterProvider } from "react-router-dom"
import { QueryClientProvider } from "@tanstack/react-query"
import { ConfirmDialogProvider, Toaster, UiTextProvider } from "@klygenixvideo/ui"
import { router } from "./router"
import { queryClient } from "./lib/queryClient"
import { useLang, useT } from "./i18n"

export default function App() {
  const t = useT()
  const lang = useLang()
  const ui = useMemo(() => ({ cancel: t("Cancel"), confirm: t("Confirm"), close: t("Close"), working: t("Working…"), loading: t("Loading…") }), [t])
  return (
    <QueryClientProvider client={queryClient}>
      <UiTextProvider text={ui} locale={lang === "hi" ? "hi-IN" : "en-IN"}>
        <ConfirmDialogProvider>
          <RouterProvider router={router} />
          <Toaster position="bottom-center" richColors offset={72} theme="dark" />
        </ConfirmDialogProvider>
      </UiTextProvider>
    </QueryClientProvider>
  )
}
