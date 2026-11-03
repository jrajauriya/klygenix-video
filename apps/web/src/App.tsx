import { RouterProvider } from "react-router-dom"
import { QueryClientProvider } from "@tanstack/react-query"
import { ConfirmDialogProvider, Toaster } from "@klygenixvideo/ui"
import { router } from "./router"
import { queryClient } from "./lib/queryClient"

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ConfirmDialogProvider>
        <RouterProvider router={router} />
        <Toaster position="bottom-center" richColors offset={72} theme="dark" />
      </ConfirmDialogProvider>
    </QueryClientProvider>
  )
}
