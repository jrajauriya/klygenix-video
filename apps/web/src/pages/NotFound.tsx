import { Link } from "react-router-dom"
import { Compass } from "lucide-react"
import { useTitle } from "../lib/title"
import { useT } from "../i18n"

export default function NotFound({ what = "page" }: { what?: string }) {
  const t = useT()
  useTitle("Not found")
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-6 py-24 text-center">
      <span className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand/20 text-brand-soft"><Compass size={30} /></span>
      <h1 className="text-2xl font-bold">{t(`This ${what} isn't here`)}</h1>
      <p className="mt-2 text-sm text-muted">{t("It may have been removed, made private, or the link is wrong.")}</p>
      <div className="mt-6 flex gap-2">
        <Link to="/" className="rounded-full bg-brand px-5 py-2 text-sm font-semibold text-white hover:bg-brand-hover">{t("Go home")}</Link>
        <Link to="/search" className="rounded-full bg-white/10 px-5 py-2 text-sm font-semibold hover:bg-white/15">{t("Search")}</Link>
      </div>
    </div>
  )
}
