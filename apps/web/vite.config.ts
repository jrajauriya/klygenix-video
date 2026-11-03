import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import path from "path"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  server: {
    port: 5300,
    // The console's client calls the API absolutely (packages/auth/src/api.ts falls back to
    // :9300), so this proxy is not what makes development work — CORS is. It is here for
    // any caller that does use a relative path, and pay-link's client does.
    proxy: {
      "/api": { target: "http://localhost:9300", changeOrigin: true },
    },
  },
  // `preview` does NOT inherit `server.proxy`. Without this, serving dist/ has no API at
  // all — and the browser suite drives dist/, because the bundle that ships is the one
  // worth testing.
  preview: {
    port: 5310,
    proxy: {
      "/api": { target: "http://localhost:9300", changeOrigin: true },
    },
  },
})
