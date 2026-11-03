import Constants from "expo-constants"
import * as Notifications from "expo-notifications"
import { Platform } from "react-native"

import { api } from "./api"

let registered: string | null = null

function projectId(): string | null {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined
  return extra?.eas?.projectId ?? null
}

export async function registerForPush(): Promise<string | null> {
  const project = projectId()
  if (!project) return null
  const current = await Notifications.getPermissionsAsync()
  const granted = current.granted || (await Notifications.requestPermissionsAsync()).granted
  if (!granted) return null
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: project })
  const platform = Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "web"
  await api.post("/api/video/devices/push-token", { token, platform })
  registered = token
  return token
}

async function currentToken(): Promise<string | null> {
  const project = projectId()
  if (!project) return null
  try {
    if (!(await Notifications.getPermissionsAsync()).granted) return null
    return (await Notifications.getExpoPushTokenAsync({ projectId: project })).data
  } catch {
    return null
  }
}

export async function forgetPush(): Promise<void> {
  const token = registered ?? (await currentToken())
  registered = null
  if (!token) return
  try {
    await api.post("/api/video/devices/push-token/forget", { token })
  } catch {
    return
  }
}
