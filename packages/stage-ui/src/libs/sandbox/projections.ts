import type {
  SandboxVfsCognitionProjection,
  SandboxVfsLive2dProjection,
  SandboxVfsMessageItem,
  SandboxVfsSessionProjection,
  SandboxVfsTelemetryProjection,
} from './types'

import { deriveMood } from '@proj-airi/nan0-runtime'
import { useLive2d } from '@proj-airi/stage-ui-live2d/stores'

import { useChatSessionStore } from '../../stores/chat/session-store'
import { useAiriCardStore } from '../../stores/modules/airi-card'
import { useConsciousnessStore } from '../../stores/modules/consciousness'
import { useNan0Store } from '../../stores/modules/nan0'
import { useProactivityStore } from '../../stores/proactivity'

export function buildSessionProjection(): SandboxVfsSessionProjection {
  try {
    const sessionStore = useChatSessionStore()
    const cardStore = useAiriCardStore()
    const activeSessionId = sessionStore.activeSessionId || ''
    const meta = activeSessionId ? sessionStore.getSessionMeta(activeSessionId) : null
    const messages = activeSessionId ? sessionStore.getSessionMessages(activeSessionId) : []

    let lastMessageAt: string | null = null
    let hoursSinceLastMessage: number | null = null

    if (messages && messages.length > 0) {
      const lastMsg = messages[messages.length - 1] as any
      if (lastMsg?.createdAt) {
        lastMessageAt = new Date(lastMsg.createdAt).toISOString()
        const diffMs = Date.now() - new Date(lastMsg.createdAt).getTime()
        hoursSinceLastMessage = Math.max(0, Number((diffMs / 3600000).toFixed(2)))
      }
    }

    return {
      activeSessionId,
      characterName: cardStore.activeCard?.name || 'Airi',
      messageCount: messages ? messages.length : 0,
      lastMessageAt,
      hoursSinceLastMessage,
      createdAt: meta?.createdAt ? new Date(meta.createdAt).toISOString() : null,
    }
  }
  catch (err) {
    console.warn('[Sandbox] Error building session projection:', err)
    return {
      activeSessionId: '',
      characterName: 'Airi',
      messageCount: 0,
      lastMessageAt: null,
      hoursSinceLastMessage: null,
      createdAt: null,
    }
  }
}

export function buildCognitionProjection(): SandboxVfsCognitionProjection {
  try {
    const cardStore = useAiriCardStore()
    const consciousnessStore = useConsciousnessStore()
    const nan0Store = useNan0Store()

    const airiExt = cardStore.activeCard?.extensions?.airi as any
    const cognitionModule = airiExt?.modules?.cognition ?? airiExt?.cognition
    const processor = cognitionModule?.processor ?? cognitionModule?.firstHopProcessor ?? airiExt?.firstHopProcessor
    const isNan0Enabled = cognitionModule?.enabled ?? (processor === 'local_nan0' || processor === 'nan0')

    const base: SandboxVfsCognitionProjection = {
      character: {
        name: cardStore.activeCard?.name || 'Airi',
        description: cardStore.activeCard?.description || '',
      },
      consciousness: {
        activeProvider: consciousnessStore.activeProvider || '',
        activeModel: consciousnessStore.activeModel || '',
      },
    }

    if (isNan0Enabled) {
      const mood = deriveMood(nan0Store.emotions)
      return {
        ...base,
        emotion: mood.primary,
        valence: Number(mood.valence.toFixed(2)),
        energy: Number(mood.arousal.toFixed(2)),
        somaticState: nan0Store.demandsSilence ? 'silence-demanded' : 'engaged',
        nan0: {
          enabled: true,
          emotions: { ...nan0Store.emotions },
          lastReflex: nan0Store.lastReflex ? { ...nan0Store.lastReflex } : null,
          decision: nan0Store.decision,
          decisionReason: nan0Store.decisionReason,
          demandsSilence: nan0Store.demandsSilence,
          isPouting: nan0Store.isPouting,
          innerMonologue: nan0Store.innerMonologue,
          moodProfile: {
            primary: mood.primary,
            secondary: mood.secondary,
            valence: Number(mood.valence.toFixed(2)),
            arousal: Number(mood.arousal.toFixed(2)),
          },
        },
      }
    }

    return base
  }
  catch (err) {
    console.warn('[Sandbox] Error building cognition projection:', err)
    return {
      character: { name: 'Airi' },
      consciousness: { activeProvider: '', activeModel: '' },
    }
  }
}

export function buildTelemetryProjection(): SandboxVfsTelemetryProjection {
  try {
    const proactivity = useProactivityStore()
    const payload = proactivity.sensorPayload as any

    return {
      idleTimeSec: payload?.idleTimeSec ?? proactivity.idleTimeSec ?? 0,
      activeProgram: payload?.activeProgram ?? (proactivity.activeWinStr ? proactivity.activeWinStr.split(' - ')[0] : 'Unknown'),
      activeWindowTitle: payload?.activeWindowTitle ?? proactivity.activeWinStr ?? '',
      windowHistory: Array.isArray(proactivity.winHistory)
        ? proactivity.winHistory.slice(-6).map((item: any) => ({
            processName: item.window?.processName || 'Unknown',
            title: item.window?.title || '',
            durationMs: item.durationMs || 0,
          }))
        : [],
      cpuLoad: payload?.cpuLoad ?? proactivity.sysLoad?.cpu ?? [0, 0, 0],
      gpuAvg: payload?.gpuAvg ?? proactivity.sysLoad?.gpuAvg ?? 0,
      volumeLevel: payload?.volumeLevel ?? proactivity.volLevel ?? 100,
      localTime: payload?.localTime ?? proactivity.locTime ?? new Date().toLocaleTimeString(),
      usageMetrics: {
        ttsHourly: payload?.usageMetrics?.ttsHourly ?? 0,
        sttHourly: payload?.usageMetrics?.sttHourly ?? 0,
        chatHourly: payload?.usageMetrics?.chatHourly ?? 0,
        journalHourly: payload?.usageMetrics?.journalHourly ?? 0,
        turnCount: payload?.usageMetrics?.turnCount ?? 0,
      },
    }
  }
  catch (err) {
    console.warn('[Sandbox] Error building telemetry projection:', err)
    return {
      idleTimeSec: 0,
      activeProgram: 'Unknown',
      activeWindowTitle: '',
      windowHistory: [],
      cpuLoad: [0, 0, 0],
      gpuAvg: 0,
      volumeLevel: 100,
      localTime: new Date().toLocaleTimeString(),
      usageMetrics: {
        ttsHourly: 0,
        sttHourly: 0,
        chatHourly: 0,
        journalHourly: 0,
        turnCount: 0,
      },
    }
  }
}

export function buildLive2dProjection(): SandboxVfsLive2dProjection {
  try {
    const live2d = useLive2d()
    const cardStore = useAiriCardStore()
    const dslVM = live2d.dslVM as any
    const raw = live2d.rawSettings as any
    const manifestHitAreas = raw?.HitAreas ?? raw?.hitAreas
    const names: string[] = Array.isArray(manifestHitAreas)
      ? manifestHitAreas.map((h: any) => h?.Name ?? h?.name).filter((n: any) => typeof n === 'string' && n)
      : []
    const groups = (live2d.dslGroups ?? []) as any[]
    let reactionsCount = 0
    for (const group of groups) {
      for (const entry of group?.entries ?? []) {
        if (entry?.Sound)
          reactionsCount += 1
      }
    }

    return {
      modelId: (cardStore.activeCard as any)?.extensions?.airi?.modules?.displayModelId ?? '',
      hasModel: !!live2d.model,
      activeMotion: live2d.currentMotion ? { ...live2d.currentMotion } : null,
      lastText: live2d.activeMotionText?.text ?? null,
      enabledHitAreas: names.filter(name => dslVM?.isHitAreaEnabled?.(name) ?? true),
      hitAreasCount: names.length,
      reactionsCount,
      hasDsl: groups.length > 0 || names.length > 0,
      varFloats: dslVM?.vars?.snapshot?.() ?? {},
      updatedAt: Date.now(),
    }
  }
  catch (err) {
    console.warn('[Sandbox] Error building Live2D projection:', err)
    return {
      modelId: '',
      hasModel: false,
      activeMotion: null,
      lastText: null,
      enabledHitAreas: [],
      hitAreasCount: 0,
      reactionsCount: 0,
      hasDsl: false,
      varFloats: {},
      updatedAt: Date.now(),
    }
  }
}

export function buildMessagesProjection(): SandboxVfsMessageItem[] {
  try {
    const sessionStore = useChatSessionStore()
    const activeSessionId = sessionStore.activeSessionId
    if (!activeSessionId)
      return []

    const messages = sessionStore.getSessionMessages(activeSessionId) || []
    return messages.slice(-20).map((m: any) => ({
      id: m.id || '',
      role: m.role || 'user',
      createdAt: m.createdAt ? new Date(m.createdAt).toISOString() : undefined,
      content: (typeof m.rawContent === 'string' && m.rawContent)
        ? m.rawContent
        : (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)),
    }))
  }
  catch (err) {
    console.warn('[Sandbox] Error building messages projection:', err)
    return []
  }
}
