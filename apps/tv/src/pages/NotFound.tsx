import { Link } from "react-router-dom"

export default function NotFound() {
  return (
    <div className="safe-x py-10">
      <h1 className="text-5xl font-bold">This page isn't here</h1>
      <p className="mt-4 text-2xl text-muted">The link may be old, or the video was removed.</p>
      <Link to="/" data-autofocus className="mt-8 inline-block rounded-full bg-brand px-10 py-4 text-2xl font-semibold text-white">
        Go home
      </Link>
    </div>
  )
}
