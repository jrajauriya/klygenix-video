import { Link } from "react-router-dom"
import { EmptyState, PageHeader } from "@klygenixvideo/ui"
import { useT } from "../i18n"

export default function NotFound() {
  const t = useT()
  return (
    <>
      <PageHeader title={t("Page not found")} />
      <EmptyState
        title={t("Nothing lives at this address")}
        hint={t("The link may be old, or the page may have moved.")}
        action={<Link to="/" className="text-sm font-semibold text-brand underline">{t("Go to the dashboard")}</Link>}
      />
    </>
  )
}
