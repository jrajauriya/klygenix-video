import { api } from "./api"
import type { HistoryCard, Note, QuizAttempt, QuizResult, StudyRow, StudySet } from "./types"

export type StudyKind = "notes" | "flashcards" | "quiz"

export async function watchHistory(): Promise<HistoryCard[]> {
  return (await api.get<HistoryCard[]>("/api/video/me/history", { params: { limit: 50 } })).data
}

export async function myStudy(): Promise<StudyRow[]> {
  return (await api.get<StudyRow[]>("/api/video/me/study", { params: { limit: 50 } })).data
}

export async function studySet<T>(publicId: string, kind: StudyKind): Promise<StudySet<T>> {
  return (await api.get<StudySet<T>>(`/api/video/videos/${publicId}/study/${kind}`)).data
}

export async function myNotes(publicId: string): Promise<Note[]> {
  return (await api.get<Note[]>(`/api/video/videos/${publicId}/notes`)).data
}

export async function quizAttempts(publicId: string): Promise<QuizAttempt[]> {
  return (await api.get<QuizAttempt[]>(`/api/video/videos/${publicId}/quiz/attempts`)).data
}

export async function submitQuiz(publicId: string, answers: number[]): Promise<QuizResult> {
  return (await api.post<QuizResult>(`/api/video/videos/${publicId}/quiz/attempts`, { answers })).data
}
