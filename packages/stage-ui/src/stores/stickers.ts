import localforage from 'localforage'

import { useIntervalFn, useLocalStorage } from '@vueuse/core'
import { nanoid } from 'nanoid'
import { computed, ref } from 'vue'

import * as Pinia from 'pinia'

import { chatStickers } from '../assets/stickers'
import { useAiriCardStore } from './modules/airi-card'

export interface StickerMetadata {
  id: string
  label: string
  addedAt: number
  originalName: string
  mimeType: string
  characterId?: string
}

export interface StickerPlacement {
  instanceId: string
  stickerId: string
  x: number
  y: number
  rotation: number
  scale: number
  createdAt: number
  expiresAt?: number
}

const KNOWN_STICKER_PREFIXES = new Set(['airi', 'lupin'])

function tokenizeStickerId(id: string): string[] {
  return id.toLowerCase().split(/[_-]+/).filter(Boolean)
}

function stripKnownStickerPrefix(tokens: string[]): string[] {
  if (tokens.length > 1 && KNOWN_STICKER_PREFIXES.has(tokens[0]))
    return tokens.slice(1)
  return tokens
}

function normalizeStickerKey(id: string): string {
  return tokenizeStickerId(id).join('-')
}

export const useStickersStore = Pinia.defineStore('stickers', () => {
  // Persisted metadata list
  const libraryMetadata = useLocalStorage<StickerMetadata[]>('stickers/library-v2', [])

  /**
   * The library subset belonging to the currently active character
   */
  const currentLibrary = computed(() => {
    const airiCardStore = useAiriCardStore()
    return libraryMetadata.value.filter(s => s.characterId === airiCardStore.activeCardId)
  })

  // Reactive state for active instances on screen
  const activePlacements = ref<StickerPlacement[]>([])

  // UI toggle for spawning standalone widgets (for Desktop support)
  const standaloneMode = useLocalStorage<boolean>('stickers/standalone-mode', false)

  // Cache for object URLs to avoid recreating them constantly
  const objectUrlCache = new Map<string, string>()

  // Pruning interval for expired stickers
  if (typeof window !== 'undefined') {
    setInterval(() => {
      const now = Date.now()
      activePlacements.value = activePlacements.value.filter(p => !p.expiresAt || p.expiresAt > now)
    }, 1000)
  }

  /**
   * Resolve a model-emitted sticker id to a catalog id.
   * Order: exact match, normalized exact (_/-/case-insensitive),
   * then token-overlap fuzzy on prefix-stripped tokens so e.g.
   * `arona_warm_smile` ([arona,warm,smile]) matches `lupin-warm-smile`
   * ([warm,smile] after stripping the `lupin` prefix) with 2 shared tokens.
   * Custom/character stickers win over builtin fuzzy matches via the
   * normalized-exact step.
   */
  function resolveStickerId(rawId: string): string | undefined {
    const raw = rawId?.trim()
    if (!raw)
      return undefined

    if (chatStickers.some(s => s.id === raw))
      return raw

    let customIds: string[] = []
    try {
      const airiCardStore = useAiriCardStore()
      customIds = Object.keys(airiCardStore.activeCard?.extensions?.airi?.stickers || {})
      if (customIds.includes(raw))
        return raw
    }
    catch {}

    const candidates = [
      ...chatStickers.map(s => s.id),
      ...customIds,
      ...currentLibrary.value.map(m => m.id),
    ]

    const normalizedRaw = normalizeStickerKey(raw)
    const normalizedMatch = candidates.find(c => normalizeStickerKey(c) === normalizedRaw)
    if (normalizedMatch)
      return normalizedMatch

    const inputTokens = stripKnownStickerPrefix(tokenizeStickerId(raw))
    if (inputTokens.length === 0)
      return undefined
    const inputSet = new Set(inputTokens)

    let best: string | undefined
    let bestShared = 0
    let bestLen = Number.POSITIVE_INFINITY
    for (const candidate of candidates) {
      const candidateTokens = stripKnownStickerPrefix(tokenizeStickerId(candidate))
      const shared = candidateTokens.filter(t => inputSet.has(t)).length
      if (shared === 0)
        continue
      if (shared > bestShared || (shared === bestShared && candidateTokens.length < bestLen)) {
        best = candidate
        bestShared = shared
        bestLen = candidateTokens.length
      }
    }
    return best
  }

  /**
   * Get target sticker image as as Object URL
   */
  async function getStickerUrl(id: string): Promise<string | undefined> {
    const builtin = chatStickers.find(s => s.id === id)
    if (builtin) {
      return builtin.src
    }

    if (objectUrlCache.has(id)) {
      return objectUrlCache.get(id)
    }

    const resolved = resolveStickerId(id) ?? id
    const resolvedBuiltin = resolved === id
      ? undefined
      : chatStickers.find(s => s.id === resolved)
    if (resolvedBuiltin) {
      return resolvedBuiltin.src
    }
    if (resolved !== id && objectUrlCache.has(resolved)) {
      const cached = objectUrlCache.get(resolved)!
      objectUrlCache.set(id, cached)
      return cached
    }

    // NOTICE: persisted cards strip embedded dataUrls, but a freshly imported
    // card (or a failed blob unpack) may still carry one — use it before giving up.
    try {
      const airiCardStore = useAiriCardStore()
      const dataUrl = airiCardStore.activeCard?.extensions?.airi?.stickers?.[resolved]?.dataUrl
      if (dataUrl)
        return dataUrl
    }
    catch {}

    try {
      const blob = await localforage.getItem<Blob>(`sticker-data-${resolved}`)
      if (blob) {
        const url = URL.createObjectURL(blob)
        objectUrlCache.set(resolved, url)
        if (resolved !== id)
          objectUrlCache.set(id, url)
        return url
      }
    }
    catch (err) {
      console.error(`[StickersStore] Failed to fetch sticker ${id} (resolved: ${resolved}):`, err)
    }
    return undefined
  }

  /**
   * Upload and register a new sticker
   */
  async function addSticker(file: File | Blob, label?: string, characterId?: string, customId?: string) {
    const airiCardStore = useAiriCardStore()
    const id = customId || nanoid()
    const originalName = (file as File).name || `${id}.png`
    const mimeType = file.type || 'image/png'
    const metadata: StickerMetadata = {
      id,
      label: label || originalName.replace(/\.[^/.]+$/, ''), // remove extension
      addedAt: Date.now(),
      originalName,
      mimeType,
      characterId: characterId || airiCardStore.activeCardId,
    }

    try {
      // Store blob in IndexedDB
      await localforage.setItem(`sticker-data-${id}`, file)

      // Update metadata list
      const existingIdx = libraryMetadata.value.findIndex(m => m.id === id)
      if (existingIdx >= 0) {
        libraryMetadata.value[existingIdx] = metadata
      }
      else {
        libraryMetadata.value.push(metadata)
      }

      return id
    }
    catch (err) {
      console.error('[StickersStore] Failed to save sticker:', err)
      throw err
    }
  }

  /**
   * Remote a sticker from the library
   */
  async function deleteSticker(id: string) {
    try {
      await localforage.removeItem(`sticker-data-${id}`)

      // Revoke and clear cache
      if (objectUrlCache.has(id)) {
        URL.revokeObjectURL(objectUrlCache.get(id)!)
        objectUrlCache.delete(id)
      }

      // Update metadata
      libraryMetadata.value = libraryMetadata.value.filter(m => m.id !== id)

      // Clean up active placements
      activePlacements.value = activePlacements.value.filter(p => p.stickerId !== id)
    }
    catch (err) {
      console.error(`[StickersStore] Failed to delete sticker ${id}:`, err)
    }
  }

  /**
   * Spawn a sticker instance at coordinates (or center)
   */
  function spawnSticker(idOrLabel: string, options: { x?: number, y?: number, duration?: number } = {}) {
    const builtin = chatStickers.find(s => s.id === idOrLabel || s.description.toLowerCase() === idOrLabel.toLowerCase())
    const resolvedId = builtin ? builtin.id : (resolveStickerId(idOrLabel) ?? idOrLabel)
    const resolvedBuiltin = chatStickers.find(s => s.id === resolvedId)
    const sticker = resolvedBuiltin
      ? { id: resolvedBuiltin.id, label: resolvedBuiltin.description }
      : currentLibrary.value.find(m => m.id === resolvedId || m.label === idOrLabel)
    if (!sticker) {
      const availableBuiltin = chatStickers.map(s => s.id).join(', ')
      const availableCustom = currentLibrary.value.map(s => s.label).join(', ')
      const allAvailable = [availableBuiltin, availableCustom].filter(Boolean).join(', ')
      const errorMsg = `Sticker "${idOrLabel}" not found. Available stickers: ${allAvailable}`
      console.warn(`[StickersStore] ${errorMsg}`)
      return errorMsg
    }

    // "randomly creeked by like 3 to 8 degrees"
    const direction = Math.random() > 0.5 ? 1 : -1
    const rotation = (3 + Math.random() * 5) * direction

    // Wild positioning: use window dimensions or default to safe center if size unknown.
    // We target 10% to 90% of the viewport to ensure they are at least partially visible.
    const width = typeof window !== 'undefined' ? window.innerWidth : 1000
    const height = typeof window !== 'undefined' ? window.innerHeight : 1000

    const finalX = options.x !== undefined ? options.x : (width * (0.1 + Math.random() * 0.8))
    const finalY = options.y !== undefined ? options.y : (height * (0.1 + Math.random() * 0.8))

    const createdAt = Date.now()
    const placement: StickerPlacement = {
      instanceId: nanoid(),
      stickerId: sticker.id,
      x: finalX,
      y: finalY,
      rotation,
      scale: 1,
      createdAt,
      expiresAt: options.duration ? createdAt + (options.duration * 1000) : undefined,
    }

    activePlacements.value.push(placement)
    return placement
  }

  /**
   * Remove a specific placement instance
   */
  function removePlacement(instanceId: string) {
    activePlacements.value = activePlacements.value.filter(p => p.instanceId !== instanceId)
  }

  /**
   * Update placement position
   */
  function updatePlacement(instanceId: string, updates: Partial<StickerPlacement>) {
    const p = activePlacements.value.find(i => i.instanceId === instanceId)
    if (p) {
      Object.assign(p, updates)
    }
  }

  /**
   * Clear all active stickers from the screen
   */
  function clearPlacements() {
    activePlacements.value = []
  }

  /**
   * Delete every sticker in the current character's library
   */
  async function clearLibrary() {
    const toRemove = [...currentLibrary.value].map(s => s.id)
    for (const id of toRemove) {
      await deleteSticker(id)
    }
  }

  // --- Internals ---

  // Automatic cleanup of expired stickers
  useIntervalFn(() => {
    const now = Date.now()
    const initialCount = activePlacements.value.length
    activePlacements.value = activePlacements.value.filter(p => !p.expiresAt || p.expiresAt > now)

    if (import.meta.env.DEV && activePlacements.value.length !== initialCount) {
      console.log(`[StickersStore] Purged ${initialCount - activePlacements.value.length} expired stickers.`)
    }
  }, 2000)

  return {
    libraryMetadata,
    currentLibrary,
    standaloneMode,
    activePlacements,
    resolveStickerId,
    getStickerUrl,
    addSticker,
    deleteSticker,
    spawnSticker,
    removePlacement,
    updatePlacement,
    clearPlacements,
    clearLibrary,
    chatStickers,
  }
})
