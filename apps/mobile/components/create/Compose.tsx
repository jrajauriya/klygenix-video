import { useState } from "react"
import * as ImagePicker from "expo-image-picker"
import { ActivityIndicator, Pressable, Switch, Text, TextInput, View } from "react-native"

import { detail } from "../../lib/api"
import { useT } from "../../lib/i18n"
import { colour, s } from "../../lib/theme"
import type { StudioVideo } from "../../lib/types"
import { TusNotSupported, createAndUpload, fileSize } from "../../lib/upload"

interface Picked {
  uri: string
  filename: string
  size?: number
  seconds?: number
}

export function Compose({ recorded, onRecord, onUploaded }: { recorded: string | null; onRecord: () => void; onUploaded: (v: StudioVideo) => void }) {
  const { t } = useT()
  const [picked, setPicked] = useState<Picked | null>(null)
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [rights, setRights] = useState(false)
  const [ai, setAi] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const source: Picked | null = picked ?? (recorded ? { uri: recorded, filename: "recording.mp4" } : null)

  async function pick() {
    setError(null)
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["videos"], quality: 1, allowsEditing: false })
    if (res.canceled || !res.assets?.[0]) return
    const a = res.assets[0]
    setPicked({
      uri: a.uri,
      filename: a.fileName ?? a.uri.split("/").pop() ?? "video.mp4",
      size: a.fileSize,
      seconds: a.duration ? a.duration / 1000 : undefined,
    })
  }

  async function upload() {
    if (!source) return
    setBusy(true)
    setError(null)
    try {
      const size = source.size ?? (await fileSize(source.uri))
      const video = await createAndUpload({ uri: source.uri, filename: source.filename, size, title, description, rights, ai })
      onUploaded(video)
    } catch (err) {
      setError(
        err instanceof TusNotSupported
          ? t("compose.tus")
          : err instanceof Error && !("response" in err)
            ? err.message
            : detail(err, t("compose.failed")),
      )
    } finally {
      setBusy(false)
    }
  }

  const blocked = busy || !source || !title.trim() || !rights

  return (
    <View>
      <Text style={s.title}>{t("compose.title")}</Text>
      <Text style={s.subtitle}>{t("compose.subtitle")}</Text>

      <View style={{ flexDirection: "row", gap: 12, marginTop: 16 }}>
        <Pressable onPress={onRecord} style={[s.button, { flex: 1, marginTop: 0 }]}>
          <Text style={s.buttonText}>{t("compose.record")}</Text>
        </Pressable>
        <Pressable onPress={pick} style={[s.outline, { flex: 1, marginTop: 0, justifyContent: "center" }]}>
          <Text style={s.outlineText}>{t("compose.pick")}</Text>
        </Pressable>
      </View>

      {source && (
        <View style={s.card}>
          <Text style={s.cardLabel}>{t("compose.selected")}</Text>
          <Text style={[s.text, { marginTop: 4 }]} numberOfLines={1}>
            {source.filename}
          </Text>
          {source.seconds ? <Text style={s.cardHint}>{t("compose.seconds", { n: Math.round(source.seconds) })}</Text> : null}
        </View>
      )}

      <Text style={s.label}>{t("compose.titleLabel")}</Text>
      <TextInput style={s.field} placeholder={t("compose.titlePlaceholder")} value={title} onChangeText={setTitle} maxLength={200} />
      <Text style={s.label}>{t("compose.description")}</Text>
      <TextInput style={[s.field, { minHeight: 70 }]} value={description} onChangeText={setDescription} multiline />

      <View style={[s.row, { marginTop: 20 }]}>
        <Text style={[s.text, { flex: 1, paddingRight: 12 }]}>{t("compose.rights")}</Text>
        <Switch value={rights} onValueChange={setRights} trackColor={{ true: colour.brand }} />
      </View>
      <View style={[s.row, { marginTop: 14 }]}>
        <Text style={[s.text, { flex: 1, paddingRight: 12 }]}>{t("compose.ai")}</Text>
        <Switch value={ai} onValueChange={setAi} trackColor={{ true: colour.brand }} />
      </View>

      {error && <Text style={s.error}>{error}</Text>}
      <Pressable onPress={upload} disabled={blocked} style={[s.button, blocked && s.disabled]}>
        {busy ? <ActivityIndicator color={colour.white} /> : <Text style={s.buttonText}>{t("compose.upload")}</Text>}
      </Pressable>
      {!rights && <Text style={s.note}>{t("compose.rightsRequired")}</Text>}
    </View>
  )
}
