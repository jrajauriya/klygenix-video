import { readFileSync } from "fs"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import path from "path"

const version = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "package.json"), "utf8")).version as string
const api = { "/api": { target: "http://localhost:9300", changeOrigin: true, ws: true } }

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { __TV_VERSION__: JSON.stringify(version) },
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
  server: { port: 5303, proxy: api },
  preview: { port: 5313, proxy: api },
})
