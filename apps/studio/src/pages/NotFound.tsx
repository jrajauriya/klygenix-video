import { Link } from "react-router-dom"
import { EmptyState, PageHeader } from "@klygenixvideo/ui"
import { useT } from "../i18n"

export default function NotFound() {
  const t = useT()
  return (
    <>
      <PageHeader title={t("Page not found")} />
      <EmptyState
        title="Nothing lives at this address"
        hint="The link may be old, or the page may have moved."
        action={<Link to="/" className="text-sm font-semibold text-brand underline">Go to the dashboard</Link>}
      />
    </>
  )
}
