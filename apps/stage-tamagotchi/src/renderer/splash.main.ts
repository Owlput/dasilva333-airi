import type { StartupMilestoneId, StartupSnapshot } from '../shared/eventa'

import { defineInvoke } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/renderer'
import { version } from '~build/package'

import pastelTilesUrl from './assets/splash/pastel-tiles.png'

import {
  electronSplashDismiss,
  electronSplashGetSnapshot,
  electronSplashReportMilestone,
  electronSplashStateChanged,
  electronStageRelease,
} from '../shared/eventa'

// NOTICE: Milestone labels and hints tailored for the warm companion experience.
// Kept self-contained so the splash paints instantly (<10ms) without waiting
// on i18n initialization or the monolithic main.ts application graph.
interface MilestoneInfo {
  label: string
  subHint: string
  icon: string
}

const MILESTONE_INFO: Record<StartupMilestoneId, MilestoneInfo> = {
  'core-services': {
    label: 'Starting core systems',
    subHint: 'Initializing runtime environment',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>`,
  },
  'sync-engine': {
    label: 'Syncing your companion',
    subHint: 'Restoring local state and memories',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
    </svg>`,
  },
  'character-card': {
    label: 'Loading your character',
    subHint: 'Preparing the stage',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path>
      <circle cx="12" cy="7" r="4"></circle>
    </svg>`,
  },
  'stage-actor': {
    label: 'Preparing the stage',
    subHint: 'Loading avatar shaders & lights',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
    </svg>`,
  },
}

const ICON_READY = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
  <polyline points="20 6 9 17 4 12"></polyline>
</svg>`

const ICON_FAILED = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="10"></circle>
  <line x1="12" y1="8" x2="12" y2="12"></line>
  <line x1="12" y1="16" x2="12.01" y2="16"></line>
</svg>`

// DOM Elements
const splashCard = document.getElementById('splash-card')
const logoImg = document.getElementById('logo-img') as HTMLImageElement | null
const btnCloseWindow = document.getElementById('btn-close-window')
const iconBadge = document.getElementById('icon-badge')
const milestoneLabel = document.getElementById('milestone-label')
const progressBar = document.getElementById('progress-bar')
const progressPercent = document.getElementById('progress-percent')
const subHint = document.getElementById('sub-hint')
const errorZone = document.getElementById('error-zone')
const errorMsg = document.getElementById('error-msg')
const errorDetails = document.getElementById('error-details')
const btnRetry = document.getElementById('btn-retry')
const btnSkipAvatar = document.getElementById('btn-skip-avatar')
const versionFooter = document.getElementById('version-footer')

// Populate logo image source safely
if (logoImg && pastelTilesUrl) {
  logoImg.src = pastelTilesUrl
}

// Populate version footer in the exact "v0.9.38 · stable" format
if (versionFooter && version) {
  const cleanVersion = version.split('-')[0] || '0.9.38'
  const channel = version.includes('stable') ? 'stable' : 'dev'
  versionFooter.textContent = `v${cleanVersion} · ${channel}`
}

// Close button quits / closes the splash window
btnCloseWindow?.addEventListener('click', () => {
  window.close()
})

// IPC & Eventa context
const ipcRenderer = (window as unknown as { electron?: { ipcRenderer?: unknown } })?.electron?.ipcRenderer
const eventaAdapter = ipcRenderer ? createContext(ipcRenderer as any) : undefined
const context = eventaAdapter?.context

const getSnapshot = context ? defineInvoke(context, electronSplashGetSnapshot) : undefined
const dismissSplash = context ? defineInvoke(context, electronSplashDismiss) : undefined
const reportMilestone = context ? defineInvoke(context, electronSplashReportMilestone) : undefined
const releaseStage = context ? defineInvoke(context, electronStageRelease) : undefined

const retryChannel = typeof BroadcastChannel !== 'undefined'
  ? new BroadcastChannel('airi:startup-retry')
  : undefined

let currentSnapshot: StartupSnapshot | null = null
let dismissRequested = false
let watchdogTimer: ReturnType<typeof setTimeout> | undefined

function resetWatchdog() {
  if (watchdogTimer) {
    clearTimeout(watchdogTimer)
  }
  // If no milestone updates arrive for 15s, show timeout warning
  watchdogTimer = setTimeout(() => {
    if (!currentSnapshot?.ready && !currentSnapshot?.failed) {
      if (subHint) {
        subHint.textContent = 'Startup is taking longer than expected...'
      }
    }
  }, 15000)
}

function render(snap: StartupSnapshot) {
  currentSnapshot = snap

  const progress = Math.min(100, Math.max(0, snap.progress ?? 0))
  const isReady = Boolean(snap.ready)
  const failed = snap.failed

  if (progressBar) {
    progressBar.style.width = `${progress}%`
  }
  if (progressPercent) {
    progressPercent.textContent = `${progress}%`
  }

  if (failed) {
    if (iconBadge) {
      iconBadge.innerHTML = ICON_FAILED
      iconBadge.style.background = '#fee2e2'
      iconBadge.style.color = '#dc2626'
    }
    if (milestoneLabel) {
      milestoneLabel.textContent = 'Startup issue detected'
    }
    if (subHint) {
      subHint.textContent = failed.error || 'A problem occurred while loading'
    }
    if (errorZone) {
      errorZone.classList.add('visible')
    }
    if (errorMsg) {
      errorMsg.textContent = failed.error || 'Startup failed'
    }
    if (errorDetails) {
      errorDetails.textContent = failed.error || 'Unknown error occurred during startup'
    }
    if (btnSkipAvatar) {
      btnSkipAvatar.style.display = failed.id === 'stage-actor' ? 'inline-block' : 'none'
    }
    return
  }

  if (errorZone) {
    errorZone.classList.remove('visible')
  }

  if (isReady) {
    if (iconBadge) {
      iconBadge.innerHTML = ICON_READY
      iconBadge.style.background = '#dcfce7'
      iconBadge.style.color = '#16a34a'
    }
    if (milestoneLabel) {
      milestoneLabel.textContent = 'Ready!'
    }
    if (subHint) {
      subHint.textContent = 'Welcome back'
    }

    // NOTICE: Zero-click auto-close. Hold "Ready!" so the user perceives
    // completion, fade out, then let Main atomically reveal the windows and destroy the splash.
    if (!dismissRequested) {
      dismissRequested = true
      if (watchdogTimer) {
        clearTimeout(watchdogTimer)
        watchdogTimer = undefined
      }
      setTimeout(() => {
        if (splashCard) {
          splashCard.classList.add('exiting')
        }
        setTimeout(() => {
          void dismissSplash?.().catch(() => {})
        }, 300)
      }, 350)
    }
    return
  }

  // Active or queued milestone resolution
  const stageSkipped = snap.resources.find(r => r.id === 'stage-actor')?.status === 'skipped'
  const active = snap.resources.find(r => r.status === 'loading')
    ?? snap.resources.find(r => r.status === 'queued')

  const milestoneId = active?.id || 'character-card'
  const info = MILESTONE_INFO[milestoneId]

  if (iconBadge && info) {
    iconBadge.innerHTML = info.icon
    iconBadge.style.background = '#e0f2fe'
    iconBadge.style.color = '#0284c7'
  }

  if (milestoneLabel) {
    if (stageSkipped && (!active || active.id === 'stage-actor')) {
      milestoneLabel.textContent = 'Text-only companion mode'
    }
    else {
      milestoneLabel.textContent = info ? info.label : 'Loading your companion...'
    }
  }

  if (subHint) {
    if (stageSkipped && (!active || active.id === 'stage-actor')) {
      subHint.textContent = 'Stage actor bypassed'
    }
    else {
      subHint.textContent = info ? info.subHint : 'Preparing the stage'
    }
  }
}

// User Action Handlers
btnRetry?.addEventListener('click', async () => {
  const failedMilestone = currentSnapshot?.failed
  if (!failedMilestone)
    return
  await reportMilestone?.({ id: failedMilestone.id, status: 'loading' }).catch(() => {})
  retryChannel?.postMessage({ id: failedMilestone.id })
})

btnSkipAvatar?.addEventListener('click', async () => {
  await reportMilestone?.({ id: 'stage-actor', status: 'skipped' }).catch(() => {})
  await releaseStage?.().catch(() => {})
})

// Attach Eventa Listeners
if (context) {
  context.on(electronSplashStateChanged, (event) => {
    if (event?.body) {
      resetWatchdog()
      render(event.body)
    }
  })

  // Initial snapshot query
  void getSnapshot?.().then((snap) => {
    if (snap) {
      render(snap)
    }
  }).catch(() => {})
}

resetWatchdog()
