import { RouterProvider } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ConfirmDialogProvider, Toaster } from "@klygenixvideo/ui"
import { router } from "./router"

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } },
})

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
