import { createContext, useContext, useMemo, type ReactNode } from "react"

export const AUTH_TEXT = {
  "login.title": "Sign in to {product}",
  "login.subtitle": "Access your dashboard",
  "login.or": "or",
  "login.email": "Email",
  "login.emailPlaceholder": "you@company.com",
  "login.password": "Password",
  "login.passwordPlaceholder": "Enter your password",
  "login.showPassword": "Show password",
  "login.hidePassword": "Hide password",
  "login.code": "Code from your authenticator app",
  "login.codePlaceholder": "123456, or a recovery code",
  "login.submit": "Sign in",
  "login.submitting": "Signing in...",
  "login.forgot": "Forgot your password?",
  "login.create": "Create an account",
  "login.noAccess": "You do not have access to {product}. Contact your administrator.",
  "login.googleFailed": "Google sign-in failed. Please try again.",
  "login.badCode": "That code is not right",
  "login.denied": "Access denied. Please contact contact@klygenix.com",
  "login.invalid": "Invalid email or password",
  "shell.back": "Back to sign in",
  "signup.title": "Create your Klygenix Play account",
  "signup.subtitle": "Watch, ask and clip. Free to start.",
  "signup.closedTitle": "Sign-ups are closed for now",
  "signup.closedBody": "Klygenix Play isn't taking new accounts right now. You can still watch without one, or write to contact@klygenix.com.",
  "signup.name": "Your name",
  "signup.email": "Email",
  "signup.password": "Password (8 or more characters)",
  "signup.company": "Company",
  "signup.country": "Country",
  "signup.gstin": "GSTIN (optional now, needed before your first tax invoice)",
  "signup.failed": "That account could not be created.",
  "signup.creating": "Creating…",
  "signup.submit": "Create account",
  "verify.title": "Confirming your email address",
  "verify.noToken": "This link is missing its token.",
  "verify.failed": "That link could not be used.",
  "verify.wait": "One moment…",
  "verify.dashboard": "Go to the dashboard",
  "verify.signIn": "Sign in",
  "forgot.title": "Reset your password",
  "forgot.subtitle": "We will email a link that works for thirty minutes.",
  "forgot.email": "Email",
  "forgot.failed": "That could not be sent. Try again shortly.",
  "forgot.sending": "Sending…",
  "forgot.submit": "Email me a link",
  "password.mismatch": "The two passwords do not match.",
  "password.name": "Your name (as your colleagues should see it)",
  "password.new": "New password (8 or more characters)",
  "password.again": "The same again",
  "password.saving": "Saving…",
  "reset.title": "Choose a new password",
  "reset.submit": "Change my password",
  "invite.title": "Accept your invitation",
  "invite.subtitle": "Choose a password and you are in.",
  "invite.submit": "Accept and sign in",
  "country.IN": "India",
  "country.US": "United States",
  "country.GB": "United Kingdom",
  "country.AE": "United Arab Emirates",
  "country.SG": "Singapore",
  "country.DE": "Germany",
  "country.FR": "France",
  "country.NL": "Netherlands",
  "country.IE": "Ireland",
  "country.AU": "Australia",
  "country.CA": "Canada",
}

export const SIGNUP_TEXT = {
  "signup.birthDate": "Date of birth",
  "signup.language": "Language",
  "signup.ageRule": "18+ in India (16+ in Germany), 13+ elsewhere. You can still watch without an account.",
  "signup.tooYoung": "You need to be at least {age} to open an account in this country. You can still watch without one.",
  "signup.creator": "Open a creator channel",
  "signup.creatorHint": "Upload videos and reels under your own handle. You can also do this later.",
  "signup.handle": "Channel handle",
  "signup.handleHint": "3 to 40 letters, numbers or hyphens",
  "signup.channelName": "Channel name",
  "signup.haveAccount": "Already have an account? Sign in",
  "country.other": "Somewhere else",
  "language.en": "English",
  "language.hi": "हिन्दी (Hindi)",
  "language.mr": "मराठी (Marathi)",
  "language.bn": "বাংলা (Bengali)",
  "language.ta": "தமிழ் (Tamil)",
  "language.te": "తెలుగు (Telugu)",
}

export type AuthTextKey = keyof typeof AUTH_TEXT
export type AuthText = Record<AuthTextKey, string>
export type SignupTextKey = keyof typeof SIGNUP_TEXT
export type SignupText = Record<SignupTextKey, string>

interface Ctx {
  text: Partial<AuthText> & Partial<SignupText>
  aside?: ReactNode
}

const AuthTextContext = createContext<Ctx>({ text: {} })

export function AuthTextProvider({ text, aside, children }: { text?: Partial<AuthText> & Partial<SignupText>; aside?: ReactNode; children: ReactNode }) {
  const value = useMemo(() => ({ text: text ?? {}, aside }), [text, aside])
  return <AuthTextContext.Provider value={value}>{children}</AuthTextContext.Provider>
}

export function useAuthText() {
  const { text, aside } = useContext(AuthTextContext)
  return useMemo(() => {
    const t = (key: AuthTextKey | SignupTextKey, vars?: Record<string, string>) => {
      const s = text[key] ?? (key in AUTH_TEXT ? AUTH_TEXT[key as AuthTextKey] : SIGNUP_TEXT[key as SignupTextKey])
      return vars ? s.replace(/\{(\w+)\}/g, (all, name: string) => vars[name] ?? all) : s
    }
    return { t, aside }
  }, [text, aside])
}
