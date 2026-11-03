import axios from "axios"
import { useAuthStore } from "./store"

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:9300"

export const api = axios.create({
  baseURL: API_BASE,
  headers: { "Content-Type": "application/json", "Accept-Language": "en" },
})

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      if (!window.location.pathname.endsWith("/login")) {
        useAuthStore.getState().clearAuth()
        window.location.href = "/login"
      }
    }
    return Promise.reject(err)
  }
)
