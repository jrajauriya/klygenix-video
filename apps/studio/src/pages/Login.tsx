import { LoginPage } from "@klygenixvideo/auth"
import { useT } from "../i18n"

export default function Login() {
  const t = useT()
  return <LoginPage productName={t("Klygenix Play Studio")} productKey="video" signupPath="/signup" forgotPath="/forgot" />
}
