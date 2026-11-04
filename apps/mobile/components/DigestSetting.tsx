import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Pressable, Text, View } from "react-native"

import { detail } from "../lib/api"
import { useAuth } from "../lib/auth"
import { useT } from "../lib/i18n"
import { DIGESTS, digest, saveDigest } from "../lib/inbox"
import { colour, s } from "../lib/theme"
import type { DigestFrequency } from "../lib/types"

export function DigestSetting() {
  const { user } = useAuth()
  const { t } = useT()
  const qc = useQueryClient()
  const key = ["digest", user?.id]
  const current = useQuery({ queryKey: key, queryFn: digest, enabled: Boolean(user) })
  const save = useMutation({
    mutationFn: saveDigest,
    onMutate: (next: DigestFrequency) => {
      const before = qc.getQueryData<DigestFrequency>(key)
      qc.setQueryData(key, next)
      return { before }
    },
    onSuccess: (next) => qc.setQueryData(key, next),
    onError: (_err, _next, ctx) => {
      if (ctx?.before) qc.setQueryData(key, ctx.before)
    },
  })

  return (
    <View>
      <Text style={[s.label, { marginTop: 24 }]}>{t("digest.title")}</Text>
      <Text style={[s.note, { marginTop: 4 }]}>{t("digest.hint")}</Text>
      {current.data && (
        <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }} accessibilityRole="radiogroup" accessibilityLabel={t("digest.title")}>
          {DIGESTS.map((f) => {
            const on = current.data === f
            return (
              <Pressable
                key={f}
                onPress={() => !on && save.mutate(f)}
                style={[s.chip, { paddingHorizontal: 14, paddingVertical: 6 }, on && { backgroundColor: colour.brand }]}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
              >
                <Text style={[s.chipText, on && { color: colour.white }]}>{t(`digest.${f}`)}</Text>
              </Pressable>
            )
          })}
        </View>
      )}
      {(current.isError || save.isError) && <Text style={s.error}>{detail(save.error ?? current.error, t("digest.failed"))}</Text>}
    </View>
  )
}
