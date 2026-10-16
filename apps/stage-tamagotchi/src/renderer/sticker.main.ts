import localforage from 'localforage'

import { chatStickers } from '@proj-airi/stage-ui/assets/stickers'

// NOTICE: Zero-framework, lightweight MPA sticker entry point.
// Bypasses the ~80MB Vue/Pinia/Router SPA runtime to mount ephemeral post-it decals
// in <20ms with interactive "tap to peel" physics and weight-scaled lifespans.

function computeTtlMs(weight: number): number {
  const clamped = Math.max(0.1, Math.min(1.0, weight))
  // Weight scalar: 0.1 -> 60s, 0.5 -> 167s, 1.0 -> 300s
  const seconds = Math.round(60 + (clamped - 0.1) * (240 / 0.9))
  return seconds * 1000
}

async function resolveStickerImage(stickerId: string, directSrc?: string): Promise<string | undefined> {
  if (directSrc && directSrc.trim()) {
    return directSrc.trim()
  }

  // 1. Check built-in catalog
  const builtin = chatStickers.find((s: { id: string, src?: string }) => s.id === stickerId)
  if (builtin) {
    return builtin.src
  }

  // 2. Check localforage for custom uploaded sticker blob
  try {
    const blob = await localforage.getItem<Blob>(`sticker-data-${stickerId}`)
    if (blob) {
      return URL.createObjectURL(blob)
    }
  }
  catch (err) {
    console.warn('[StickerMPA] Failed to retrieve custom sticker from storage:', err)
  }

  // 3. Fallback to first built-in sticker if unknown
  return chatStickers[0]?.src
}

function initSticker() {
  const params = new URLSearchParams(window.location.search)
  const stickerId = params.get('stickerId') || 'airi-happy'
  const directSrc = params.get('src') || undefined
  const weight = Number.parseFloat(params.get('weight') || '0.5')
  const rawTtl = Number.parseInt(params.get('ttlMs') || '0', 10)
  const ttlMs = rawTtl > 0 ? rawTtl : computeTtlMs(weight)

  // Random crooked tilt between -5.5deg and +5.5deg if not provided
  let tilt = Number.parseFloat(params.get('tilt') || '')
  if (Number.isNaN(tilt)) {
    const sign = Math.random() > 0.5 ? 1 : -1
    tilt = Number((sign * (2.5 + Math.random() * 4.5)).toFixed(1))
  }

  const wrapper = document.getElementById('sticker-wrapper')
  const img = document.getElementById('sticker-img') as HTMLImageElement
  const spinner = document.getElementById('loading-spinner')

  if (!wrapper || !img)
    return

  wrapper.style.setProperty('--tilt', `${tilt}deg`)

  let isClosing = false
  function peelAndClose() {
    if (isClosing)
      return
    isClosing = true

    wrapper?.classList.add('peeling')
    setTimeout(() => {
      window.close()
    }, 280)
  }

  // Click to peel off
  wrapper.addEventListener('click', peelAndClose)

  // Auto-peel timer based on weight-derived TTL
  const autoCloseTimer = setTimeout(peelAndClose, ttlMs)

  window.addEventListener('beforeunload', () => {
    clearTimeout(autoCloseTimer)
  })

  // Load and display sticker image
  void resolveStickerImage(stickerId, directSrc).then((src) => {
    if (!src) {
      peelAndClose()
      return
    }

    img.onload = () => {
      spinner?.remove()
      img.classList.add('loaded')
    }

    img.onerror = () => {
      console.error('[StickerMPA] Failed to load image asset:', src)
      spinner?.remove()
      setTimeout(peelAndClose, 1500)
    }

    img.src = src
  })
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initSticker)
}
else {
  initSticker()
}
