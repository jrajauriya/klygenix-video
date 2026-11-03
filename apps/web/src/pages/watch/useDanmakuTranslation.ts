import { useEffect, useMemo, useRef, useState } from "react"
import { api } from "@klygenixvideo/auth"
import type { DanmakuItem } from "@klygenixvideo/player"
import type { Translation } from "../../lib/types"

const BEHIND = 3000
const AHEAD = 20000

export function useDanmakuTranslation(items: DanmakuItem[], currentMs: number, on: boolean, lang: string, synced = true) {
  const [texts, setTexts] = useState<Record<string, string>>({})
  const [off, setOff] = useState(false)
  const asked = useRef(new Set<string>())
  const bucket = Math.floor(currentMs / 5000)

  useEffect(() => {
    asked.current = new Set()
    setTexts({})
    setOff(false)
  }, [lang])

  useEffect(() => {
    if (!on || off) return
    const ids = items
      .filter((d) => typeof d.id === "number" || /^\d+$/.test(String(d.id)))
      .filter((d) => !synced || (d.t_ms >= currentMs - BEHIND && d.t_ms <= currentMs + AHEAD))
      .map((d) => String(d.id))
      .filter((id) => !asked.current.has(id))
      .slice(0, 100)
    if (!ids.length) return
    ids.forEach((id) => asked.current.add(id))
    api
      .post<Translation>("/api/video/translate", { kind: "danmaku", ids: ids.map(Number), lang })
      .then(({ data }) => {
        if (!data.machine_translation) {
          setOff(true)
          return
        }
        setTexts((t) => {
          const next = { ...t }
          for (const x of data.items) next[String(x.id)] = x.text
          return next
        })
      })
      .catch(() => ids.forEach((id) => asked.current.delete(id)))
  }, [on, off, lang, bucket, items.length, synced])

  const shown = useMemo(
    () => (on && !off ? items.map((d) => (texts[String(d.id)] ? { ...d, text: texts[String(d.id)] } : d)) : items),
    [items, texts, on, off],
  )
  return { items: shown, off: on && off }
}
