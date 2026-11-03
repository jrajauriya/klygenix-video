import { useNavigate } from "react-router-dom"
import { Tabs } from "@klygenixvideo/ui"

const TABS = [
  { key: "/moderation", label: "Queue" },
  { key: "/moderation/actions", label: "Actions log" },
  { key: "/moderation/appeals", label: "Appeals" },
]

export function ModerationTabs({ active }: { active: string }) {
  const navigate = useNavigate()
  return (
    <div className="mb-4">
      <Tabs tabs={TABS} active={active} onChange={(k) => navigate(k)} />
    </div>
  )
}
