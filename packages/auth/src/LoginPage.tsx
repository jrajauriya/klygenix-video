import { useState, useEffect, useRef, useCallback } from "react"
import companyLockup from "./brand/klygenix-lockup-company-light.svg"
import { useNavigate, useSearchParams } from "react-router-dom"
import { useLogin, useGoogleLogin, useSignupOpen } from "./hooks"
import { useAuthStore } from "./store"
import { useAuthText } from "./text"

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: any) => void
          renderButton: (element: HTMLElement, config: any) => void
        }
      }
    }
  }
}

interface LoginPageProps {
  productName: string
  productKey: string
  signupPath?: string
  forgotPath?: string
}

export function LoginPage({ productName, productKey, signupPath, forgotPath }: LoginPageProps) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { t, aside } = useAuthText()
  const login = useLogin()
  const googleLogin = useGoogleLogin()
  const signupOpen = useSignupOpen()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState("")
  const [code, setCode] = useState("")
  const [needsCode, setNeedsCode] = useState(false)
  const googleBtnRef = useRef<HTMLDivElement>(null)
  const googleInitRef = useRef(false)

  const returnUrl = searchParams.get("returnUrl") || "/"
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID

  const validateAndNavigate = useCallback((user: any) => {
    if (user.role !== "global_admin" && !user.products.includes(productKey)) {
      useAuthStore.getState().clearAuth()
      setError(t("login.noAccess", { product: productName }))
      return
    }
    navigate(returnUrl, { replace: true })
  }, [productKey, productName, returnUrl, navigate, t])

  // Initialize Google Sign-In (once only)
  useEffect(() => {
    if (!googleClientId || googleInitRef.current) return

    const initGoogle = () => {
      if (!window.google?.accounts || !googleBtnRef.current || googleInitRef.current) return
      googleInitRef.current = true

      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: async (response: any) => {
          setError("")
          try {
            const result = await googleLogin.mutateAsync(response.credential)
            validateAndNavigate(result.user)
          } catch (err: any) {
            setError(err?.response?.data?.detail || t("login.googleFailed"))
          }
        },
      })

      window.google.accounts.id.renderButton(googleBtnRef.current, {
        type: "standard",
        theme: "outline",
        size: "large",
        text: "signin_with",
        shape: "rectangular",
        width: googleBtnRef.current.offsetWidth || 360,
      })
    }

    // If GIS already loaded
    if (window.google?.accounts) {
      initGoogle()
    } else {
      // Wait for script to load (added in index.html)
      const interval = setInterval(() => {
        if (window.google?.accounts) {
          clearInterval(interval)
          initGoogle()
        }
      }, 100)
      return () => clearInterval(interval)
    }
  }, [googleClientId])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    try {
      const result = await login.mutateAsync({ email, password, code: needsCode ? code : undefined })
      validateAndNavigate(result.user)
    } catch (err: any) {
      if (err?.response?.headers?.["x-totp-required"]) {
        setNeedsCode(true)
        setError(needsCode ? err.response.data?.detail || t("login.badCode") : "")
      } else if (err?.response?.status === 403) {
        setError(err.response.data?.detail || t("login.denied"))
      } else {
        setError(t("login.invalid"))
      }
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-[#F4F6FB] p-4 relative overflow-hidden">
      {/* Background gradient accents */}
      <div aria-hidden="true" className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] rounded-full bg-[#632B4F]/[0.05] blur-[120px]" />
      <div aria-hidden="true" className="absolute bottom-[-20%] right-[-10%] w-[400px] h-[400px] rounded-full bg-[#1E1B4B]/[0.04] blur-[120px]" />

      <div className="w-full max-w-[400px] relative z-10">
        {aside && <div className="mb-4 flex justify-end">{aside}</div>}
        {/* Branding */}
        <div className="flex items-center justify-center mb-8">
          <img src={companyLockup} alt="Klygenix Technologies" style={{ height: 56, width: "auto" }} />
        </div>

        {/* Card */}
        <div className="bg-white border border-gray-200 rounded-2xl p-8 shadow-sm">
          <div className="text-center mb-6">
            <h1 className="text-lg font-semibold text-gray-900">{t("login.title", { product: productName })}</h1>
            <p className="text-sm text-gray-500 mt-1">{t("login.subtitle")}</p>
          </div>

          {/* Google Sign-In */}
          {googleClientId ? (
            <>
              <div ref={googleBtnRef} className="w-full flex justify-center mb-5 [&>div]:!w-full" />
              <div className="relative mb-5">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-gray-200" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-white px-3 text-gray-500">{t("login.or")}</span>
                </div>
              </div>
            </>
          ) : null}

          {/* Email/Password Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="email" className="block text-sm text-gray-600">{t("login.email")}</label>
              <input
                id="email"
                className="w-full h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 placeholder:text-gray-400 outline-none transition-colors focus:border-[#632B4F] focus:ring-1 focus:ring-[#632B4F]"
                type="email"
                autoComplete="email"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "login-error" : undefined}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t("login.emailPlaceholder")}
                required
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="password" className="block text-sm text-gray-600">{t("login.password")}</label>
              <div className="relative">
                <input
                  id="password"
                  className="w-full h-10 rounded-lg border border-gray-200 bg-white pl-3 pr-10 text-sm text-gray-900 placeholder:text-gray-400 outline-none transition-colors focus:border-[#632B4F] focus:ring-1 focus:ring-[#632B4F]"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? "login-error" : undefined}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t("login.passwordPlaceholder")}
                  required
                />
                <button
                  type="button"
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? t("login.hidePassword") : t("login.showPassword")}
                  title={showPassword ? t("login.hidePassword") : t("login.showPassword")}
                  className="absolute right-0 top-0 flex h-10 w-10 items-center justify-center text-gray-400 hover:text-gray-600"
                >
                  {showPassword ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
                  )}
                </button>
              </div>
            </div>

            {needsCode && (
              <div className="space-y-1.5">
                <label htmlFor="code" className="block text-sm text-gray-600">{t("login.code")}</label>
                <input
                  id="code"
                  className="w-full h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm tracking-widest text-gray-900 outline-none focus:border-[#632B4F] focus:ring-1 focus:ring-[#632B4F]"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder={t("login.codePlaceholder")}
                />
              </div>
            )}

            {error && (
              <div id="login-error" role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            <button
              type="submit"
              className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-gradient-to-r from-[#632B4F] to-[#B44A32] text-sm font-semibold text-white transition-colors hover:from-[#552444] hover:to-[#9E3F2B] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={login.isPending}
            >
              {login.isPending ? t("login.submitting") : t("login.submit")}
            </button>
          </form>
          {(signupPath || forgotPath) && (
            <div className="mt-5 flex items-center justify-between text-sm">
              {forgotPath ? (
                <a href={forgotPath} className="text-[#632B4F] hover:underline">{t("login.forgot")}</a>
              ) : <span />}
              {signupPath && signupOpen && (
                <a href={returnUrl !== "/" ? `${signupPath}?returnUrl=${encodeURIComponent(returnUrl)}` : signupPath} className="text-[#632B4F] hover:underline">{t("login.create")}</a>
              )}
            </div>
          )}
        </div>

        <p className="text-center text-xs text-gray-600 mt-6">
          &copy; {new Date().getFullYear()} Klygenix Technologies Private Limited
        </p>
      </div>
    </main>
  )
}
