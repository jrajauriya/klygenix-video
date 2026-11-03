import { PageHeader, EmptyState } from "@klygenixvideo/ui"

export default function ComingSoon({ title }: { title: string }) {
  return (
    <>
      <PageHeader title={title} />
      <EmptyState
        title={`${title} is routed, not built`}
        hint="The route and its permission gate exist; the screen lands with phase 1."
      />
    </>
  )
}
