import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Stack, router, useLocalSearchParams } from "expo-router"
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native"

import { api, detail, openWeb, statusOf } from "../../lib/api"
import { useAuth } from "../../lib/auth"
import { clock } from "../../lib/format"
import { useT } from "../../lib/i18n"
import { myNotes, quizAttempts, studySet, submitQuiz, type StudyKind } from "../../lib/study"
import { colour, s } from "../../lib/theme"
import type { Flashcard, QuizItem, QuizResult, StudyNote, VideoDetail } from "../../lib/types"

type Tab = StudyKind | "mine"

function watchAt(publicId: string, ms: number) {
  router.push({ pathname: "/watch/[id]", params: { id: publicId, t: String(Math.max(0, Math.round(ms))) } })
}

function Stamp({ publicId, ms, label }: { publicId: string; ms: number; label?: string }) {
  return (
    <Pressable onPress={() => watchAt(publicId, ms)} hitSlop={6} accessibilityRole="button" accessibilityLabel={label || clock(ms)}>
      <Text style={st.stamp}>{label || clock(ms)}</Text>
    </Pressable>
  )
}

function Locked({ message }: { message?: string }) {
  const { t } = useT()
  return (
    <View style={[s.card, st.locked]}>
      <Text style={st.lockedTitle}>🔒 {t("study.lockedTitle")}</Text>
      {message ? <Text style={[s.text, { marginTop: 6 }]}>{message}</Text> : null}
      <Text style={[st.muted, { marginTop: 6 }]}>{t("study.lockedHint")}</Text>
      <Pressable onPress={() => openWeb("/plans")} style={[s.button, { marginTop: 12 }]} accessibilityRole="link">
        <Text style={s.buttonText}>{t("study.seePlans")}</Text>
      </Pressable>
    </View>
  )
}

function Problem({ error }: { error: unknown }) {
  const { t } = useT()
  const status = statusOf(error)
  if (status === 401) {
    return (
      <View style={s.card}>
        <Text style={{ fontWeight: "700", color: colour.navy }}>{t("study.signInFor")}</Text>
        <Text style={[st.muted, { marginTop: 4 }]}>{t("study.signInHint")}</Text>
        <Pressable onPress={() => router.push("/profile")} style={s.button} accessibilityRole="button">
          <Text style={s.buttonText}>{t("common.signIn")}</Text>
        </Pressable>
      </View>
    )
  }
  if (status === 402) return <Locked message={detail(error, "")} />
  return <Text style={[s.note, { textAlign: "center", marginTop: 24 }]}>{detail(error, t("study.unavailable"))}</Text>
}

function Preparing() {
  const { t } = useT()
  return (
    <View style={{ marginTop: 24, alignItems: "center", gap: 8 }}>
      <ActivityIndicator color={colour.brand} />
      <Text style={st.muted}>{t("study.preparing")}</Text>
    </View>
  )
}

function useSet<T>(publicId: string, kind: StudyKind, enabled: boolean) {
  return useQuery({
    queryKey: ["study", publicId, kind],
    queryFn: () => studySet<T>(publicId, kind),
    enabled,
    retry: (n, err) => (statusOf(err) ?? 500) >= 500 && n < 1,
    staleTime: 5 * 60_000,
  })
}

function NotesView({ publicId }: { publicId: string }) {
  const { t } = useT()
  const q = useSet<StudyNote>(publicId, "notes", true)
  if (q.isLoading) return <Preparing />
  if (q.isError) return <Problem error={q.error} />
  const items = q.data?.items ?? []
  if (!items.length) return <Text style={s.note}>{t("study.noNotes")}</Text>
  return (
    <View>
      {items.map((n, i) => (
        <View key={`${n.t_ms}-${i}`} style={{ marginTop: 14 }}>
          {n.heading && (i === 0 || items[i - 1].heading !== n.heading) ? <Text style={st.heading}>{n.heading}</Text> : null}
          <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
            <Stamp publicId={publicId} ms={n.t_ms} label={n.label} />
            <Text style={[s.text, { flex: 1 }]}>{n.text}</Text>
          </View>
        </View>
      ))}
      <Text style={s.note}>{t("study.madeByAi")}</Text>
    </View>
  )
}

function CardsView({ publicId }: { publicId: string }) {
  const { t } = useT()
  const q = useSet<Flashcard>(publicId, "flashcards", true)
  const [at, setAt] = useState(0)
  const [flipped, setFlipped] = useState(false)
  if (q.isLoading) return <Preparing />
  if (q.isError) return <Problem error={q.error} />
  const items = q.data?.items ?? []
  if (!items.length) return <Text style={s.note}>{t("study.noCards")}</Text>
  const card = items[Math.min(at, items.length - 1)]
  const go = (n: number) => {
    setAt((n + items.length) % items.length)
    setFlipped(false)
  }
  return (
    <View>
      <Pressable
        onPress={() => setFlipped(!flipped)}
        style={[st.flash, flipped && st.flashBack]}
        accessibilityRole="button"
        accessibilityHint={flipped ? t("study.tapQuestion") : t("study.tapAnswer")}
      >
        <Text style={st.flashLabel}>{flipped ? t("study.answer") : t("study.question")}</Text>
        <Text style={st.flashText}>{flipped ? card.back : card.front}</Text>
        <Text style={st.muted}>{flipped ? t("study.tapQuestion") : t("study.tapAnswer")}</Text>
      </Pressable>
      <View style={[s.row, { marginTop: 12 }]}>
        <Pressable onPress={() => go(at - 1)} hitSlop={8} accessibilityRole="button">
          <Text style={s.link}>{t("study.prev")}</Text>
        </Pressable>
        <Text style={st.muted}>
          {at + 1} / {items.length}
        </Text>
        <Pressable onPress={() => go(at + 1)} hitSlop={8} accessibilityRole="button">
          <Text style={s.link}>{t("study.next")}</Text>
        </Pressable>
      </View>
      <Pressable onPress={() => watchAt(publicId, card.t_ms)} style={s.outline} accessibilityRole="button">
        <Text style={s.outlineText}>{t("study.watchMoment", { time: card.label || clock(card.t_ms) })}</Text>
      </Pressable>
    </View>
  )
}

function QuizView({ publicId }: { publicId: string }) {
  const { t } = useT()
  const { user } = useAuth()
  const qc = useQueryClient()
  const q = useSet<QuizItem>(publicId, "quiz", true)
  const past = useQuery({ queryKey: ["quiz-attempts", publicId], queryFn: () => quizAttempts(publicId), enabled: Boolean(user) })
  const [answers, setAnswers] = useState<Record<number, number>>({})
  const [result, setResult] = useState<QuizResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (q.isLoading) return <Preparing />
  if (q.isError) return <Problem error={q.error} />
  const items = q.data?.items ?? []
  if (!items.length) return <Text style={s.note}>{t("study.noQuiz")}</Text>
  const graded = new Map((result?.results ?? []).map((r) => [r.index, r]))
  const complete = Object.keys(answers).length === items.length
  const best = (past.data ?? []).reduce<{ score: number; total: number } | null>(
    (b, a) => (!b || a.score > b.score ? { score: a.score, total: a.total } : b),
    null,
  )

  async function check() {
    setBusy(true)
    setError(null)
    try {
      setResult(await submitQuiz(publicId, items.map((_, i) => answers[i] ?? -1)))
      qc.invalidateQueries({ queryKey: ["quiz-attempts", publicId] })
      qc.invalidateQueries({ queryKey: ["my-study"] })
    } catch (err) {
      setError(statusOf(err) === 401 ? t("study.signInFor") : detail(err, t("study.checkFailed")))
    } finally {
      setBusy(false)
    }
  }

  return (
    <View>
      {best && !result ? <Text style={[st.muted, { marginTop: 8 }]}>{t("study.best", best)}</Text> : null}
      {result && (
        <View style={[s.card, { backgroundColor: colour.brandLight, borderColor: colour.brand }]} accessibilityLiveRegion="polite">
          <Text style={{ fontWeight: "700", color: colour.navy }}>{t("study.score", { score: result.score, total: result.total })}</Text>
          <Pressable
            onPress={() => {
              setResult(null)
              setAnswers({})
            }}
            style={{ marginTop: 6 }}
            accessibilityRole="button"
          >
            <Text style={s.link}>{t("common.tryAgain")}</Text>
          </Pressable>
        </View>
      )}
      {items.map((item, i) => {
        const g = graded.get(i)
        return (
          <View key={i} style={s.card}>
            <View style={[s.row, { alignItems: "flex-start", gap: 8 }]}>
              <Text style={[s.text, { flex: 1, fontWeight: "600" }]}>
                {i + 1}. {item.question}
              </Text>
              {g ? (
                <Text style={{ fontSize: 12, fontWeight: "700", color: g.right ? colour.green700 : colour.red600 }}>
                  {g.right ? `✓ ${t("study.right")}` : `✗ ${t("study.wrong")}`}
                </Text>
              ) : null}
            </View>
            {item.options.map((opt, j) => {
              const picked = answers[i] === j
              const correct = g && g.correct === j
              const wrongPick = g && !g.right && g.given === j
              return (
                <Pressable
                  key={j}
                  disabled={Boolean(result)}
                  onPress={() => setAnswers((a) => ({ ...a, [i]: j }))}
                  style={[st.option, picked && st.optionPicked, correct && st.optionRight, wrongPick && st.optionWrong]}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: picked, disabled: Boolean(result) }}
                >
                  <Text style={s.text}>{opt}</Text>
                </Pressable>
              )
            })}
            <Pressable onPress={() => watchAt(publicId, item.t_ms)} style={{ marginTop: 10 }} accessibilityRole="button">
              <Text style={s.link}>{t("study.watchMoment", { time: item.label || clock(item.t_ms) })}</Text>
            </Pressable>
          </View>
        )
      })}
      {error && <Text style={s.error}>{error}</Text>}
      {!result && (
        <>
          <Pressable onPress={check} disabled={!complete || busy} style={[s.button, (!complete || busy) && s.disabled]} accessibilityRole="button">
            {busy ? <ActivityIndicator color={colour.white} /> : <Text style={s.buttonText}>{t("study.check")}</Text>}
          </Pressable>
          {!complete && <Text style={s.note}>{t("study.answerAll")}</Text>}
        </>
      )}
    </View>
  )
}

function MineView({ publicId }: { publicId: string }) {
  const { t } = useT()
  const { user } = useAuth()
  const q = useQuery({ queryKey: ["notes", publicId], queryFn: () => myNotes(publicId), enabled: Boolean(user) })
  if (!user) return <Problem error={{ response: { status: 401 } }} />
  if (q.isLoading) return <ActivityIndicator style={{ marginTop: 24 }} color={colour.brand} />
  if (q.isError) return <Problem error={q.error} />
  const notes = q.data ?? []
  if (!notes.length) return <Text style={s.note}>{t("study.noMine")}</Text>
  return (
    <View>
      {notes.map((n) => (
        <Pressable
          key={n.id}
          onPress={() => watchAt(publicId, n.t_ms)}
          style={[s.row, { marginTop: 14, alignItems: "flex-start", gap: 10 }]}
          accessibilityRole="button"
          accessibilityLabel={`${n.label || clock(n.t_ms)}: ${n.body}`}
        >
          <Text style={st.stamp}>{n.label || clock(n.t_ms)}</Text>
          <Text style={[s.text, { flex: 1 }]}>{n.body}</Text>
        </Pressable>
      ))}
    </View>
  )
}

export default function StudyVideo() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { user } = useAuth()
  const { t } = useT()
  const [tab, setTab] = useState<Tab>("notes")
  const video = useQuery<VideoDetail>({
    queryKey: ["video", id, Boolean(user)],
    queryFn: async () => (await api.get(`/api/video/videos/${id}`)).data,
    enabled: Boolean(id),
  })

  if (video.isLoading) {
    return (
      <View style={s.centred}>
        <ActivityIndicator color={colour.brand} />
      </View>
    )
  }
  if (video.isError || !video.data) {
    return (
      <View style={s.centred}>
        <Text style={s.error}>{detail(video.error, t("watch.notFound"))}</Text>
      </View>
    )
  }

  const v = video.data
  const tabs: { key: Tab; label: string }[] = [
    { key: "notes", label: t("study.notes") },
    { key: "flashcards", label: t("study.flashcards") },
    { key: "quiz", label: t("study.quiz") },
    { key: "mine", label: t("study.mine") },
  ]

  return (
    <ScrollView style={s.sheet} contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: t("study.title") }} />
      <Text style={s.title} numberOfLines={3}>
        {v.title}
      </Text>
      <Pressable onPress={() => router.push(`/watch/${v.id}`)} accessibilityRole="button" style={{ marginTop: 6 }}>
        <Text style={s.link}>
          {v.channel.name} · {t("study.openVideo")} ›
        </Text>
      </Pressable>

      {v.locked ? (
        <Locked />
      ) : (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.tabs} accessibilityRole="tablist">
            {tabs.map((x) => (
              <Pressable
                key={x.key}
                onPress={() => setTab(x.key)}
                style={[s.chip, st.tab, tab === x.key && { backgroundColor: colour.brand }]}
                accessibilityRole="tab"
                accessibilityState={{ selected: tab === x.key }}
              >
                <Text style={[s.chipText, tab === x.key && { color: colour.white }]}>{x.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
          {tab === "notes" && <NotesView publicId={v.id} />}
          {tab === "flashcards" && <CardsView publicId={v.id} />}
          {tab === "quiz" && <QuizView publicId={v.id} />}
          {tab === "mine" && <MineView publicId={v.id} />}
        </>
      )}
    </ScrollView>
  )
}

const st = StyleSheet.create({
  tabs: { gap: 8, marginTop: 16, marginBottom: 4 },
  tab: { paddingHorizontal: 14, paddingVertical: 8 },
  muted: { fontSize: 13, color: colour.slate500 },
  heading: { marginBottom: 6, fontSize: 15, fontWeight: "700", color: colour.navy },
  stamp: {
    overflow: "hidden",
    borderRadius: 6,
    backgroundColor: colour.brandLight,
    paddingHorizontal: 6,
    paddingVertical: 2,
    fontSize: 12,
    fontWeight: "700",
    color: colour.brand,
  },
  locked: { borderColor: "#fde68a", backgroundColor: "#fffbeb", marginTop: 20 },
  lockedTitle: { fontSize: 17, fontWeight: "700", color: colour.navy },
  flash: {
    marginTop: 16,
    minHeight: 180,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colour.slate200,
    backgroundColor: colour.white,
    padding: 20,
  },
  flashBack: { borderColor: colour.brand, backgroundColor: colour.brandLight },
  flashLabel: { fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6, color: colour.slate500 },
  flashText: { fontSize: 17, fontWeight: "600", color: colour.navy, textAlign: "center", lineHeight: 24 },
  option: { marginTop: 8, borderRadius: 10, borderWidth: 1, borderColor: colour.slate200, paddingHorizontal: 12, paddingVertical: 10 },
  optionPicked: { borderColor: colour.brand, backgroundColor: colour.brandLight },
  optionRight: { borderColor: colour.green700, backgroundColor: "#f0fdf4" },
  optionWrong: { borderColor: colour.red600, backgroundColor: "#fef2f2" },
})
