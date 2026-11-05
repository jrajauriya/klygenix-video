import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import path from "path"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "./src") } },
  server: { port: 5301, proxy: { "/api": { target: "http://localhost:9300", changeOrigin: true } } },
  // `preview` does not inherit `server.proxy`; the browser suite drives the built bundle.
  preview: { port: 5311, proxy: { "/api": { target: "http://localhost:9300", changeOrigin: true } } },
})
