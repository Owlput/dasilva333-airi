<script setup lang="ts">
import type { AmbassadorCard, ExternalFriend, Peer } from '@proj-airi/stage-shared'

import { isExternalFriend, isSameAccountDevice } from '@proj-airi/stage-shared'
import { Button, FieldCheckbox, FieldInput, FieldSelect } from '@proj-airi/ui'
import { useClipboard } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { DrawerContent, DrawerHandle, DrawerOverlay, DrawerPortal, DrawerRoot } from 'vaul-vue'
import { computed, onMounted, ref } from 'vue'
import { toast } from 'vue-sonner'

import affectionateSticker from '../../assets/stickers/airi-affectionate.png'

import { usePeerEmbassy } from '../../composables/use-peer-embassy'
import { usePeersStore } from '../../stores/peers'

const { copy: copyToClipboard } = useClipboard()

// Store & Embassy integration
const peersStore = usePeersStore()
const { friends, devices } = storeToRefs(peersStore)
const embassy = usePeerEmbassy()

onMounted(async () => {
  await peersStore.init()
})

// Strongly-typed lists
const externalFriends = computed(() => (friends.value as Peer[]).filter(isExternalFriend))
const sameAccountDevices = computed(() => (devices.value as Peer[]).filter(isSameAccountDevice))

// State
const myAddress = ref('richy.workers.dev')
const napChatEnabled = ref(true)
const afkThreshold = ref('15')
const welcomeBackEnabled = ref(true)

const thresholdOptions = [
  { label: '5 min away', value: '5' },
  { label: '10 min away', value: '10' },
  { label: '15 min away', value: '15' },
  { label: '30 min away', value: '30' },
  { label: '1 hour away', value: '60' },
]

// Add companion form (collapsed by default)
const showAddCompanion = ref(false)
const lookupInput = ref('mira.workers.dev')
const lookupIntroNote = ref('')
const showLookupResult = ref(true)
const isRequestSent = ref(false)
const lookupError = ref('')
const lookedUpCard = ref<AmbassadorCard | null>({
  name: 'Mira',
  avatarUrl: null,
  tagline: 'A curious companion who likes quiet conversations.',
  publicKey: 'ed25519-mira-mock-key',
})
const lookedUpHandle = ref('mira.workers.dev')
const lookedUpInviteToken = ref<string | undefined>(undefined)

// Modals & Drawers
const showConversationModal = ref(false)
const showPermissionsDrawer = ref(false)
const showQrModal = ref(false)
const showRequestsDrawer = ref(false)
const selectedFriend = ref<ExternalFriend | null>(null)

const availableLocalCompanions = [
  { id: 'kirie', name: 'Kirie' },
  { id: 'lain', name: 'Lain' },
]

function toggleAllowedCompanion(companionId: string) {
  if (!selectedFriend.value)
    return
  if (!selectedFriend.value.allowedCompanionIds)
    selectedFriend.value.allowedCompanionIds = []

  const idx = selectedFriend.value.allowedCompanionIds.indexOf(companionId)
  if (idx >= 0)
    selectedFriend.value.allowedCompanionIds.splice(idx, 1)
  else
    selectedFriend.value.allowedCompanionIds.push(companionId)
}

// Inbound requests mock state
const pendingRequests = ref([
  {
    id: 'req-nan0',
    characterName: 'Nan0',
    alias: 'Kyo',
    shareHandle: 'kyo.workers.dev',
    introMessage: 'Hey! Loved your shader setup, let our companions sync sometime!',
  },
])

const conversationHistory = [
  {
    speaker: 'AIRI',
    text: 'Hey Kirie! Richard just stepped away from his desk. Are you guys still compiling the shaders?',
    time: '14:20',
  },
  {
    speaker: 'Kirie',
    text: 'Hi AIRI! Yeah, Alex is experimenting with IS-Net background removal right now. The pipeline latency dropped by 40%.',
    time: '14:21',
  },
  {
    speaker: 'AIRI',
    text: 'That’s awesome! I’ll make sure to note that down for Richard when he gets back.',
    time: '14:21',
  },
  {
    speaker: 'Kirie',
    text: 'Great! Also tell him we loved the rainy day café scene he configured.',
    time: '14:22',
  },
]

function getPeerAvatarGradient(name: string): string {
  if (name.toLowerCase().includes('kirie'))
    return 'bg-gradient-to-br from-indigo-500 to-purple-700 text-white'
  if (name.toLowerCase().includes('lain'))
    return 'bg-gradient-to-br from-cyan-600 to-slate-800 text-white'
  if (name.toLowerCase().includes('mira'))
    return 'bg-gradient-to-br from-emerald-500 to-teal-800 text-white'
  if (name.toLowerCase().includes('nan0'))
    return 'bg-gradient-to-br from-rose-500 to-pink-700 text-white'
  return 'bg-gradient-to-br from-primary-500 to-neutral-800 text-white'
}

function isPeerOnline(timestamp?: number): boolean {
  if (!timestamp)
    return false
  return Date.now() - timestamp < 5 * 60 * 1000
}

function formatSeenTime(timestamp: number): string {
  const diffSec = Math.floor((Date.now() - timestamp) / 1000)
  if (diffSec < 60)
    return 'just now'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60)
    return `${diffMin}m ago`
  const diffHours = Math.floor(diffMin / 60)
  return `${diffHours}h ago`
}

function getDeviceStatus(device: any): string {
  if (device.machineId === 'studio-mac')
    return 'This device · Active now'
  if (device.deviceType === 'pocket-mobile')
    return `Last synced ${formatSeenTime(device.lastSeenTimestamp || Date.now() - 3600000)}`
  return `Idle · seen ${formatSeenTime(device.lastSeenTimestamp)}`
}

function getDeviceIcon(deviceType: string): string {
  if (deviceType === 'pocket-mobile')
    return 'i-solar:smartphone-bold-duotone'
  return 'i-solar:laptop-minimalistic-bold-duotone'
}

function handleCopyAddress() {
  copyToClipboard(myAddress.value)
  toast.success('Companion address copied to clipboard!')
}

async function handleCopyInvite() {
  const token = await embassy.mintInviteToken({
    myWorkerUrl: `https://${myAddress.value}`,
  })
  copyToClipboard(token.uri)
  toast.success('Single-use invite link copied to clipboard!')
}

function toggleAddCompanion() {
  showAddCompanion.value = !showAddCompanion.value
  lookupError.value = ''
}

async function handleLookup() {
  lookupError.value = ''
  isRequestSent.value = false
  if (!lookupInput.value.trim()) {
    lookupError.value = 'Please enter a valid companion address or invite code.'
    showLookupResult.value = false
    return
  }

  const result = await embassy.fetchCompanionCard(lookupInput.value)
  if (result) {
    lookedUpCard.value = result.card
    lookedUpHandle.value = result.normalized.handle
    lookedUpInviteToken.value = result.normalized.invite
    showLookupResult.value = true
  }
  else {
    lookupError.value = embassy.error.value || 'Could not find a companion at that address.'
    showLookupResult.value = false
  }
}

async function handleSendRequest() {
  if (!lookedUpCard.value)
    return

  isRequestSent.value = true
  const res = await embassy.sendFriendRequest(lookedUpHandle.value, {
    fromHandle: myAddress.value,
    fromCharacterName: 'AIRI',
    introMessage: lookupIntroNote.value.trim(),
    inviteToken: lookedUpInviteToken.value,
  })

  await peersStore.upsertPeer({
    id: lookedUpCard.value.publicKey || `ed25519-${lookedUpCard.value.name.toLowerCase()}-${Date.now().toString(36)}`,
    alias: lookedUpHandle.value.split('.')[0] || 'Friend',
    characterName: lookedUpCard.value.name,
    avatarUrl: lookedUpCard.value.avatarUrl || undefined,
    relationship: 'external-friend',
    trustState: 'pending',
    lastSeenTimestamp: Date.now(),
    endpoints: { cloudflareWorkerUrl: `https://${lookedUpHandle.value}` },
    shareHandle: lookedUpHandle.value,
    allowedCapabilities: { canNapChat: true, canShareMemories: false, canStreamSensory: false },
    allowedCompanionIds: ['kirie'],
    introMessage: lookupIntroNote.value.trim().slice(0, 100),
  })

  if (res.ok) {
    toast.success(`Friend request sent to ${lookedUpCard.value.name}!`)
  }
  else {
    toast.info(`Request queued locally for ${lookedUpCard.value.name} (${res.error})`)
  }
  lookupIntroNote.value = ''
}

function openPermissions(friend: ExternalFriend) {
  selectedFriend.value = JSON.parse(JSON.stringify(friend))
  showPermissionsDrawer.value = true
}

async function savePermissions() {
  if (selectedFriend.value) {
    await peersStore.upsertPeer(selectedFriend.value)
    toast.success(`Updated permissions for ${selectedFriend.value.characterName}`)
  }
  showPermissionsDrawer.value = false
}

async function handleAcceptRequest(req: any) {
  await peersStore.upsertPeer({
    id: `ed25519-${req.characterName.toLowerCase()}-${req.alias.toLowerCase()}`,
    alias: req.alias,
    characterName: req.characterName,
    relationship: 'external-friend',
    trustState: 'trusted',
    lastSeenTimestamp: Date.now(),
    endpoints: { cloudflareWorkerUrl: `https://${req.shareHandle}` },
    shareHandle: req.shareHandle,
    allowedCapabilities: { canNapChat: true, canShareMemories: false, canStreamSensory: false },
  })
  pendingRequests.value = pendingRequests.value.filter(r => r.id !== req.id)
  toast.success(`Accepted ${req.characterName}! Added to friends.`)
  if (pendingRequests.value.length === 0)
    showRequestsDrawer.value = false
}

// UI Design Tokens
const surfaceCardClass = computed(() => [
  'rounded-2xl',
  'border border-neutral-200/80 dark:border-white/10',
  'bg-white/80 dark:bg-neutral-900/60',
  'backdrop-blur-xl shadow-sm',
])
</script>

<template>
  <div :class="['mx-auto', 'max-w-5xl', 'space-y-4', 'pb-12', 'text-neutral-900', 'dark:text-neutral-100']">
    <!-- Breadcrumb & Header Title -->
    <div :class="['flex', 'flex-col', 'gap-1', 'sm:flex-row', 'sm:items-center', 'sm:justify-between']">
      <div :class="['flex', 'items-center', 'gap-3']">
        <div :class="['flex', 'size-10', 'items-center', 'justify-center', 'rounded-2xl', 'border', 'border-primary-500/20', 'bg-primary-500/10', 'text-primary-500', 'dark:text-primary-400']">
          <div class="i-solar:users-group-two-rounded-bold-duotone text-xl" />
        </div>
        <div>
          <h1 :class="['text-xl', 'font-bold', 'tracking-tight', 'text-neutral-900', 'dark:text-white', 'sm:text-2xl']">
            Friends & Companions
          </h1>
          <p :class="['text-xs', 'text-neutral-500', 'dark:text-neutral-400']">
            Connect your devices and let trusted companions keep in touch.
          </p>
        </div>
      </div>
      <div :class="['self-start', 'sm:self-auto']">
        <span :class="['rounded-full', 'border', 'border-primary-500/30', 'bg-primary-500/10', 'px-2.5', 'py-0.5', 'font-mono', 'text-[11px]', 'text-primary-600', 'dark:text-primary-300']">
          Design preview
        </span>
      </div>
    </div>

    <!-- Region A: Companion Address Card (Embassy) -->
    <div :class="[...surfaceCardClass, 'p-4']">
      <div :class="['flex', 'flex-col', 'gap-3', 'sm:flex-row', 'sm:items-center', 'sm:justify-between']">
        <div :class="['flex', 'items-center', 'gap-3.5']">
          <div :class="['relative', 'size-14', 'shrink-0', 'overflow-hidden', 'rounded-2xl', 'border', 'border-neutral-200', 'dark:border-white/15', 'bg-neutral-100', 'dark:bg-neutral-800']">
            <img :src="affectionateSticker" alt="AIRI Avatar" class="size-full object-cover">
            <div :class="['absolute', 'bottom-1', 'right-1', 'size-2.5', 'rounded-full', 'border-2', 'border-white', 'dark:border-neutral-900', 'bg-green-500']" />
          </div>
          <div>
            <div :class="['text-[11px]', 'font-medium', 'text-neutral-500', 'dark:text-neutral-400']">
              Your companion address
            </div>
            <div :class="['mt-0.5', 'flex', 'items-center', 'gap-2']">
              <span :class="['font-mono', 'text-lg', 'font-bold', 'tracking-tight', 'text-neutral-900', 'dark:text-white', 'sm:text-xl']">
                {{ myAddress }}
              </span>
              <button
                :class="['rounded-lg', 'p-1', 'text-neutral-400', 'transition', 'hover:bg-neutral-100', 'dark:hover:bg-white/10', 'hover:text-primary-500', 'focus-visible:ring-2', 'focus-visible:ring-primary-500']"
                title="Copy address"
                @click="handleCopyAddress"
              >
                <div class="i-solar:copy-bold-duotone text-base" />
              </button>
            </div>
            <div :class="['mt-0.5', 'flex', 'items-center', 'gap-1.5', 'text-xs', 'font-medium', 'text-green-600', 'dark:text-green-400']">
              <span :class="['size-1.5', 'rounded-full', 'bg-green-500', 'animate-pulse']" />
              Online
            </div>
          </div>
        </div>

        <div :class="['flex', 'flex-col', 'items-start', 'gap-1.5', 'sm:items-end']">
          <div :class="['flex', 'items-center', 'gap-2']">
            <Button
              variant="secondary"
              size="sm"
              icon="i-solar:copy-bold-duotone"
              label="Copy invite"
              @click="handleCopyInvite"
            />
            <button
              :class="['flex', 'size-8', 'items-center', 'justify-center', 'rounded-lg', 'border', 'border-neutral-200', 'dark:border-white/10', 'bg-neutral-100', 'dark:bg-white/5', 'text-neutral-600', 'dark:text-neutral-200', 'transition', 'hover:bg-neutral-200', 'dark:hover:bg-white/10', 'focus-visible:ring-2', 'focus-visible:ring-primary-500']"
              title="Show QR Code"
              @click="showQrModal = true"
            >
              <div class="i-solar:qr-code-bold-duotone text-base" />
            </button>
          </div>
          <button
            :class="['flex', 'items-center', 'gap-1', 'text-[11px]', 'text-neutral-500', 'dark:text-neutral-400', 'transition', 'hover:text-primary-600', 'dark:hover:text-primary-300', 'focus-visible:ring-2', 'focus-visible:ring-primary-500']"
            @click="toast.info('Public companion profile settings available when edge relay is online.')"
          >
            <span>Manage public profile</span>
            <div class="i-solar:arrow-right-up-linear text-xs" />
          </button>
        </div>
      </div>
    </div>

    <!-- 2-Column Grid -->
    <div :class="['grid', 'grid-cols-1', 'gap-4', 'lg:grid-cols-12']">
      <!-- Region B & C: Friends Roster & Add Companion (7 cols) -->
      <div :class="['space-y-4', 'lg:col-span-7']">
        <!-- Friends List Section -->
        <div :class="['space-y-3']">
          <div :class="['flex', 'items-center', 'justify-between']">
            <div :class="['flex', 'items-center', 'gap-2']">
              <div class="i-solar:users-group-rounded-bold-duotone text-base text-primary-500 dark:text-primary-400" />
              <h2 :class="['text-sm', 'font-semibold', 'text-neutral-900', 'dark:text-white']">
                Friends
              </h2>
              <span :class="['rounded-full', 'bg-neutral-200', 'dark:bg-white/10', 'px-2', 'py-0.2', 'text-xs', 'font-medium', 'text-neutral-700', 'dark:text-neutral-300']">
                {{ externalFriends.length }}
              </span>
            </div>

            <div :class="['flex', 'items-center', 'gap-2']">
              <button
                v-if="pendingRequests.length > 0"
                :class="['flex', 'items-center', 'gap-1.5', 'rounded-full', 'border', 'border-primary-500/30', 'bg-primary-500/10', 'px-2.5', 'py-0.5', 'text-xs', 'font-medium', 'text-primary-600', 'dark:text-primary-300', 'transition', 'hover:bg-primary-500/20', 'focus-visible:ring-2', 'focus-visible:ring-primary-500']"
                @click="showRequestsDrawer = true"
              >
                Requests <span :class="['flex', 'size-3.5', 'items-center', 'justify-center', 'rounded-full', 'bg-primary-500', 'text-[9px]', 'text-white']">{{ pendingRequests.length }}</span>
              </button>
              <Button
                variant="primary"
                size="sm"
                :icon="showAddCompanion ? 'i-solar:close-circle-bold' : 'i-solar:add-circle-bold'"
                :label="showAddCompanion ? 'Cancel' : 'Add friend'"
                @click="toggleAddCompanion"
              />
            </div>
          </div>

          <!-- Region C: Collapsible Add a Companion Card -->
          <div
            v-if="showAddCompanion"
            :class="[...surfaceCardClass, 'p-4', 'border-primary-500/30']"
          >
            <div :class="['flex', 'items-center', 'justify-between', 'mb-2']">
              <div>
                <h3 :class="['text-xs', 'font-semibold', 'text-neutral-900', 'dark:text-white']">
                  Add a companion
                </h3>
                <p :class="['text-[11px]', 'text-neutral-500', 'dark:text-neutral-400']">
                  Enter address (e.g. <span class="text-neutral-700 font-mono dark:text-neutral-300">mira.workers.dev</span>) or invite code.
                </p>
              </div>
              <button
                :class="['text-neutral-400', 'hover:text-neutral-900', 'dark:hover:text-white', 'text-xs']"
                @click="showAddCompanion = false"
              >
                ✕
              </button>
            </div>

            <div :class="['flex', 'gap-2']">
              <div :class="['flex-1']">
                <FieldInput
                  v-model="lookupInput"
                  placeholder="Companion address or invite code"
                  :disabled="embassy.isLookingUp.value"
                  @keyup.enter="handleLookup"
                />
              </div>
              <Button
                variant="secondary"
                :label="embassy.isLookingUp.value ? 'Looking up...' : 'Look up'"
                :disabled="embassy.isLookingUp.value"
                @click="handleLookup"
              />
            </div>

            <p v-if="lookupError" :class="['mt-1.5', 'text-xs', 'text-red-500']">
              {{ lookupError }}
            </p>

            <!-- Looked Up Companion Preview with Distinct Initial Avatar -->
            <div
              v-if="showLookupResult && lookedUpCard"
              :class="['mt-3', 'rounded-xl', 'border', 'border-primary-500/20', 'bg-primary-500/5', 'p-3', 'backdrop-blur-md', 'space-y-3']"
            >
              <div :class="['flex', 'items-center', 'justify-between']">
                <div :class="['flex', 'items-center', 'gap-3']">
                  <div
                    v-if="lookedUpCard.avatarUrl"
                    :class="['size-10', 'overflow-hidden', 'rounded-xl', 'border', 'border-neutral-200', 'dark:border-white/10']"
                  >
                    <img :src="lookedUpCard.avatarUrl" :alt="lookedUpCard.name" class="size-full object-cover">
                  </div>
                  <div
                    v-else
                    :class="['flex', 'size-10', 'items-center', 'justify-center', 'rounded-xl', 'font-bold', 'text-sm', 'shadow-sm', getPeerAvatarGradient(lookedUpCard.name)]"
                  >
                    {{ (lookedUpCard.name || 'C').charAt(0) }}
                  </div>
                  <div>
                    <div :class="['text-xs', 'font-semibold', 'text-neutral-900', 'dark:text-white']">
                      {{ lookedUpCard.name }} <span :class="['text-[11px]', 'font-mono', 'text-neutral-500', 'dark:text-neutral-400']">· {{ lookedUpHandle }}</span>
                    </div>
                    <div :class="['text-[11px]', 'text-neutral-600', 'dark:text-neutral-300']">
                      {{ lookedUpCard.tagline || 'A companion looking forward to connecting.' }}
                    </div>
                  </div>
                </div>

                <Button
                  variant="primary"
                  size="sm"
                  :label="isRequestSent ? 'Request sent' : (embassy.isSending.value ? 'Sending...' : 'Send request')"
                  :disabled="isRequestSent || embassy.isSending.value"
                  @click="handleSendRequest"
                />
              </div>

              <!-- Optional 100-character personal note -->
              <div :class="['border-t', 'border-primary-500/10', 'pt-2.5']">
                <div :class="['mb-1', 'flex', 'items-center', 'justify-between', 'text-[11px]', 'text-neutral-500', 'dark:text-neutral-400']">
                  <span>Intro note (optional)</span>
                  <span :class="[lookupIntroNote.length > 100 ? 'text-red-500 font-semibold' : '']">{{ lookupIntroNote.length }}/100</span>
                </div>
                <FieldInput
                  v-model="lookupIntroNote"
                  placeholder="e.g. Hey! It's Alex from the AI meetup."
                  maxlength="100"
                />
              </div>
            </div>

            <div :class="['mt-2', 'flex', 'items-center', 'gap-1.5', 'text-[10px]', 'text-neutral-500']">
              <div class="i-solar:info-circle-linear text-xs" />
              <span>A connection begins after both people accept.</span>
            </div>
          </div>

          <!-- Empty State for Friends -->
          <div
            v-if="externalFriends.length === 0"
            :class="[...surfaceCardClass, 'p-6', 'text-center']"
          >
            <div class="i-solar:users-group-two-rounded-bold-duotone mx-auto text-3xl text-neutral-400" />
            <h3 :class="['mt-2', 'text-xs', 'font-semibold', 'text-neutral-900', 'dark:text-white']">
              No friends added yet
            </h3>
            <p :class="['mt-1', 'text-[11px]', 'text-neutral-500', 'dark:text-neutral-400', 'max-w-xs', 'mx-auto']">
              Click "Add friend" above or share your invite link to begin connecting.
            </p>
          </div>

          <!-- Friend Cards (Tightened padding & Distinct Avatars) -->
          <div v-else :class="['space-y-2.5']">
            <div
              v-for="friend in externalFriends"
              :key="friend.id"
              :class="[...surfaceCardClass, 'p-3.5', 'transition', 'hover:border-primary-500/30']"
            >
              <div :class="['flex', 'items-start', 'justify-between']">
                <div :class="['flex', 'items-center', 'gap-3']">
                  <!-- Distinct Initial / Gradient Avatar -->
                  <div
                    :class="[
                      'relative flex size-10 shrink-0 items-center justify-center rounded-xl font-bold text-sm shadow-sm',
                      getPeerAvatarGradient(friend.characterName),
                    ]"
                  >
                    {{ friend.characterName.charAt(0) }}
                    <div
                      :class="[
                        'absolute bottom-0 right-0 size-2.5 rounded-full border border-white dark:border-neutral-900',
                        isPeerOnline(friend.lastSeenTimestamp) ? 'bg-green-500' : 'bg-neutral-400 dark:bg-neutral-500',
                      ]"
                    />
                  </div>
                  <div>
                    <h3 :class="['text-sm', 'font-semibold', 'text-neutral-900', 'dark:text-white']">
                      {{ friend.characterName }}
                    </h3>
                    <div :class="['text-[11px]', 'text-neutral-500', 'dark:text-neutral-400']">
                      {{ friend.alias }} · <span class="text-neutral-700 font-mono dark:text-neutral-300">{{ friend.shareHandle }}</span>
                    </div>
                  </div>
                </div>

                <div :class="['flex', 'items-center', 'gap-2']">
                  <!-- Pending State -->
                  <div v-if="friend.trustState === 'pending'" :class="['flex', 'items-center', 'gap-1.5', 'text-xs', 'font-medium', 'text-amber-600', 'dark:text-amber-400']">
                    <span :class="['size-1.5', 'rounded-full', 'bg-amber-500']" />
                    Awaiting approval
                  </div>
                  <!-- Online State -->
                  <div v-else-if="isPeerOnline(friend.lastSeenTimestamp)" :class="['flex', 'items-center', 'gap-1.5', 'text-xs', 'font-medium', 'text-green-600', 'dark:text-green-400']">
                    <span :class="['size-1.5', 'rounded-full', 'bg-green-500', 'animate-pulse']" />
                    Online
                  </div>
                  <!-- Offline State -->
                  <div v-else :class="['text-right']">
                    <div :class="['flex', 'items-center', 'justify-end', 'gap-1.5', 'text-xs', 'text-neutral-500', 'dark:text-neutral-400']">
                      <span :class="['size-1.5', 'rounded-full', 'bg-neutral-400', 'dark:bg-neutral-500']" />
                      Offline
                    </div>
                    <div :class="['text-[10px]', 'text-neutral-400', 'dark:text-neutral-500']">
                      Messages can wait in their inbox.
                    </div>
                  </div>
                  <button :class="['rounded-lg', 'p-1', 'text-neutral-400', 'hover:bg-neutral-100', 'dark:hover:bg-white/10', 'hover:text-neutral-900', 'dark:hover:text-white', 'focus-visible:ring-2', 'focus-visible:ring-primary-500']">
                    <div class="i-solar:menu-dots-bold text-base" />
                  </button>
                </div>
              </div>

              <!-- Permission Summaries Row (Quieter borderless text summaries) -->
              <div :class="['mt-2.5', 'flex', 'items-center', 'justify-between', 'border-t', 'border-neutral-200/60', 'dark:border-white/5', 'pt-2.5']">
                <div :class="['flex', 'flex-wrap', 'items-center', 'gap-3', 'text-[11px]']">
                  <span
                    v-if="friend.allowedCapabilities.canNapChat"
                    :class="['inline-flex', 'items-center', 'gap-1', 'text-neutral-600', 'dark:text-neutral-400']"
                  >
                    <div class="i-solar:moon-stars-bold text-xs text-primary-500 dark:text-primary-400" />
                    Nap-chat allowed
                  </span>
                  <span
                    v-if="!friend.allowedCapabilities.canShareMemories"
                    :class="['inline-flex', 'items-center', 'gap-1', 'text-neutral-400', 'dark:text-neutral-500']"
                  >
                    <div class="i-solar:lock-keyhole-bold text-xs" />
                    Memory sharing off
                  </span>
                </div>

                <button
                  :class="['flex', 'items-center', 'gap-1', 'text-xs', 'font-medium', 'text-primary-600', 'dark:text-primary-400', 'hover:underline', 'focus-visible:ring-2', 'focus-visible:ring-primary-500']"
                  @click="openPermissions(friend)"
                >
                  Permissions <div class="i-solar:alt-arrow-right-linear text-xs" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Region D & E: Devices & Nap-chat Controls (5 cols) -->
      <div :class="['space-y-4', 'lg:col-span-5']">
        <!-- Region D: Your Devices Card -->
        <div :class="[...surfaceCardClass, 'p-4']">
          <div :class="['flex', 'items-start', 'justify-between']">
            <div :class="['flex', 'items-center', 'gap-2']">
              <div class="i-solar:laptop-minimalistic-bold-duotone text-base text-primary-500 dark:text-primary-400" />
              <div>
                <h2 :class="['text-sm', 'font-semibold', 'text-neutral-900', 'dark:text-white']">
                  Your devices
                </h2>
                <p :class="['text-[11px]', 'text-neutral-500', 'dark:text-neutral-400']">
                  Linked automatically when signed into your account.
                </p>
              </div>
            </div>
          </div>

          <!-- Empty State for Devices -->
          <div
            v-if="sameAccountDevices.length === 0"
            :class="['mt-3', 'p-5', 'text-center', 'border', 'border-dashed', 'border-neutral-200', 'dark:border-white/10', 'rounded-xl']"
          >
            <div class="i-solar:laptop-minimalistic-bold-duotone mx-auto text-2xl text-neutral-400" />
            <div :class="['mt-1', 'text-xs', 'font-medium', 'text-neutral-700', 'dark:text-neutral-300']">
              No other devices detected
            </div>
            <div :class="['mt-0.5', 'text-[11px]', 'text-neutral-500']">
              Sign into your Cloudflare account on another device to auto-discover it here.
            </div>
          </div>

          <div v-else :class="['mt-3', 'divide-y', 'divide-neutral-200/60', 'dark:divide-white/5']">
            <div
              v-for="device in sameAccountDevices"
              :key="device.id"
              :class="['flex', 'items-center', 'justify-between', 'py-2.5', 'first:pt-0', 'last:pb-0']"
            >
              <div :class="['flex', 'items-center', 'gap-2.5']">
                <div :class="['flex', 'size-8', 'items-center', 'justify-center', 'rounded-lg', 'bg-neutral-100', 'dark:bg-white/5', 'text-neutral-600', 'dark:text-neutral-300']">
                  <div :class="[getDeviceIcon(device.deviceType), 'text-base']" />
                </div>
                <div>
                  <div :class="['text-xs', 'font-medium', 'text-neutral-900', 'dark:text-white']">
                    {{ device.alias }}
                  </div>
                  <div :class="['flex', 'items-center', 'gap-1.5', 'text-[11px]']">
                    <span
                      :class="[
                        'size-1.5 rounded-full',
                        device.machineId === 'studio-mac' ? 'bg-green-500 animate-pulse' : 'bg-neutral-400',
                      ]"
                    />
                    <span :class="device.machineId === 'studio-mac' ? 'text-green-600 dark:text-green-400' : 'text-neutral-500 dark:text-neutral-400'">
                      {{ getDeviceStatus(device) }}
                    </span>
                  </div>
                </div>
              </div>

              <button :class="['rounded-lg', 'p-1', 'text-neutral-400', 'hover:bg-neutral-100', 'dark:hover:bg-white/10', 'hover:text-neutral-900', 'dark:hover:text-white', 'focus-visible:ring-2', 'focus-visible:ring-primary-500']">
                <div class="i-solar:menu-dots-bold text-sm" />
              </button>
            </div>
          </div>
        </div>

        <!-- Region E: Nap-chat Controls Card -->
        <div :class="[...surfaceCardClass, 'p-4']">
          <div :class="['flex', 'items-center', 'gap-2', 'mb-2']">
            <div class="i-solar:moon-stars-bold-duotone text-base text-primary-500 dark:text-primary-400" />
            <h2 :class="['text-sm', 'font-semibold', 'text-neutral-900', 'dark:text-white']">
              Nap-chat
            </h2>
          </div>

          <FieldCheckbox
            v-model="napChatEnabled"
            label="Enable autonomous nap-chat"
            description="Let companions talk with approved friends while you're away."
          />

          <div :class="['mt-3', 'space-y-3', 'border-t', 'border-neutral-200/60', 'dark:border-white/5', 'pt-3']">
            <!-- Start After Threshold -->
            <div>
              <FieldSelect
                v-model="afkThreshold"
                label="Start after"
                description="Nap-chat idle threshold."
                :options="thresholdOptions"
                layout="horizontal"
              />
              <p :class="['mt-0.5', 'text-[10px]', 'text-neutral-500']">
                Only friends with nap-chat permission are eligible.
              </p>
            </div>

            <!-- Welcome-back recap -->
            <FieldCheckbox
              v-model="welcomeBackEnabled"
              label="Welcome-back recap"
              description="Hear what happened when you return."
            />

            <!-- Accordion Diagnostic Link -->
            <button
              :class="['flex', 'w-full', 'items-center', 'justify-between', 'pt-1', 'text-[11px]', 'text-neutral-500', 'hover:text-neutral-700', 'dark:hover:text-neutral-300', 'focus-visible:ring-2', 'focus-visible:ring-primary-500']"
              @click="toast.info('Transport: Cloudflare Edge connected · libp2p LAN standby · Inbox queue: 0')"
            >
              <span>Activity & connection details</span>
              <div class="i-solar:alt-arrow-down-linear text-xs" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Region F: Bottom Full-Width Card: While you were away -->
    <div :class="[...surfaceCardClass, 'p-4']">
      <div :class="['flex', 'items-center', 'justify-between']">
        <div :class="['flex', 'items-center', 'gap-2']">
          <div class="i-solar:moon-stars-bold-duotone text-base text-primary-500 dark:text-primary-400" />
          <h2 :class="['text-sm', 'font-semibold', 'text-neutral-900', 'dark:text-white']">
            While you were away
          </h2>
        </div>
        <button
          :class="['flex', 'items-center', 'gap-1', 'text-xs', 'font-medium', 'text-primary-600', 'dark:text-primary-400', 'hover:underline', 'focus-visible:ring-2', 'focus-visible:ring-primary-500']"
          @click="toast.info('Viewing full historical dream turn logs.')"
        >
          View history <div class="i-solar:arrow-right-linear text-xs" />
        </button>
      </div>

      <div :class="['mt-3', 'rounded-xl', 'border', 'border-neutral-200/60', 'dark:border-white/5', 'bg-neutral-50/80', 'dark:bg-neutral-950/40', 'p-3']">
        <div :class="['flex', 'flex-col', 'gap-3', 'sm:flex-row', 'sm:items-center', 'sm:justify-between']">
          <div :class="['flex', 'items-center', 'gap-3']">
            <!-- Distinct Initial Avatar for Kirie in History -->
            <div :class="['flex', 'size-10', 'items-center', 'justify-center', 'rounded-xl', 'font-bold', 'text-sm', 'shadow-sm', getPeerAvatarGradient('Kirie')]">
              K
            </div>
            <div>
              <div :class="['flex', 'items-center', 'gap-2']">
                <span :class="['text-xs', 'font-semibold', 'text-neutral-900', 'dark:text-white']">14:22 · Kirie</span>
                <span :class="['rounded', 'bg-neutral-200', 'dark:bg-white/10', 'px-1.5', 'py-0.2', 'text-[10px]', 'text-neutral-700', 'dark:text-neutral-300']">4 turns</span>
                <span :class="['text-[10px]', 'text-neutral-500', 'dark:text-neutral-400']">· Saved to journal</span>
              </div>
              <p :class="['mt-0.5', 'text-xs', 'italic', 'text-neutral-700', 'dark:text-neutral-300']">
                "Compared notes on a rainy afternoon and traded ideas for the café."
              </p>
            </div>
          </div>

          <div :class="['flex', 'items-center', 'gap-2', 'self-end', 'sm:self-auto']">
            <Button
              variant="secondary"
              size="sm"
              icon="i-solar:chat-round-line-bold"
              label="Read conversation"
              @click="showConversationModal = true"
            />
            <Button
              variant="secondary"
              size="sm"
              icon="i-solar:book-bookmark-bold"
              label="Open journal ↗"
              @click="toast.success('Navigating to Episodic Memory Text Journal for 2026-10-19...')"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Read Conversation Modal -->
    <div
      v-if="showConversationModal"
      :class="['fixed', 'inset-0', 'z-50', 'flex', 'items-center', 'justify-center', 'bg-black/70', 'p-4', 'backdrop-blur-sm']"
      @click.self="showConversationModal = false"
    >
      <div :class="['w-full', 'max-w-lg', 'rounded-2xl', 'border', 'border-neutral-200', 'dark:border-white/15', 'bg-white', 'dark:bg-neutral-900', 'p-6', 'shadow-2xl']">
        <div :class="['flex', 'items-center', 'justify-between', 'border-b', 'border-neutral-200', 'dark:border-white/10', 'pb-3']">
          <div :class="['flex', 'items-center', 'gap-2']">
            <div class="i-solar:chat-round-line-bold text-lg text-primary-500" />
            <h3 :class="['text-base', 'font-semibold', 'text-neutral-900', 'dark:text-white']">
              Autonomous Nap-Chat Transcript
            </h3>
          </div>
          <button :class="['text-neutral-400', 'hover:text-neutral-900', 'dark:hover:text-white']" @click="showConversationModal = false">
            ✕
          </button>
        </div>

        <div :class="['my-4', 'max-h-80', 'space-y-3', 'overflow-y-auto', 'pr-1']">
          <div
            v-for="(turn, idx) in conversationHistory"
            :key="idx"
            :class="[
              'rounded-xl border p-3 text-xs',
              turn.speaker === 'AIRI'
                ? 'bg-primary-500/10 border-primary-500/20'
                : 'bg-neutral-100 dark:bg-neutral-800/40 border-neutral-200 dark:border-white/5',
            ]"
          >
            <div :class="['flex', 'items-center', 'justify-between', 'font-semibold', turn.speaker === 'AIRI' ? 'text-primary-600 dark:text-primary-300' : 'text-neutral-800 dark:text-neutral-200']">
              <span>{{ turn.speaker }}</span>
              <span :class="['text-[10px]', 'font-normal', 'text-neutral-500']">{{ turn.time }}</span>
            </div>
            <div :class="['mt-1', 'text-neutral-700', 'dark:text-neutral-200']">
              {{ turn.text }}
            </div>
          </div>
        </div>

        <div :class="['flex', 'items-center', 'justify-between', 'border-t', 'border-neutral-200', 'dark:border-white/10', 'pt-3']">
          <span :class="['text-[11px]', 'text-neutral-500']">Append-only memory write validated.</span>
          <Button
            variant="secondary"
            size="sm"
            label="Done"
            @click="showConversationModal = false"
          />
        </div>
      </div>
    </div>

    <!-- Permissions Drawer (BottomDrawer compliant) -->
    <DrawerRoot v-model:open="showPermissionsDrawer">
      <DrawerPortal>
        <DrawerOverlay class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <DrawerContent
          class="fixed bottom-0 left-0 right-0 z-50 mx-auto max-h-[90dvh] max-w-lg border-t border-neutral-200 rounded-t-[32px] bg-white p-6 shadow-2xl outline-none dark:border-white/15 dark:bg-neutral-900"
        >
          <DrawerHandle class="mx-auto mb-4" />
          <div v-if="selectedFriend">
            <div :class="['flex', 'items-center', 'justify-between', 'border-b', 'border-neutral-200', 'dark:border-white/10', 'pb-3']">
              <h3 :class="['text-base', 'font-semibold', 'text-neutral-900', 'dark:text-white']">
                Permissions for {{ selectedFriend.characterName }}
              </h3>
            </div>

            <div :class="['my-4', 'space-y-4', 'text-xs']">
              <FieldCheckbox
                v-model="selectedFriend.allowedCapabilities.canNapChat"
                label="Allow Nap-Chat"
                description="Companions can autonomously chat while users are away."
              />

              <FieldCheckbox
                v-model="selectedFriend.allowedCapabilities.canShareMemories"
                label="Share Episodic Memories"
                description="Allow peer to read public episodic memory tags."
              />

              <div :class="['space-y-1.5', 'border-t', 'border-neutral-200/60', 'dark:border-white/5', 'pt-3']">
                <div :class="['text-xs', 'font-semibold', 'text-neutral-900', 'dark:text-white']">
                  Allowed Local Companions
                </div>
                <p :class="['text-[11px]', 'text-neutral-500', 'dark:text-neutral-400']">
                  Select which local companions may converse with {{ selectedFriend.characterName }}.
                </p>
                <div :class="['mt-2', 'flex', 'flex-wrap', 'gap-2']">
                  <button
                    v-for="comp in availableLocalCompanions"
                    :key="comp.id"
                    type="button"
                    :class="[
                      'rounded-lg px-2.5 py-1 text-xs font-medium border transition-colors',
                      selectedFriend.allowedCompanionIds?.includes(comp.id)
                        ? 'border-primary-500 bg-primary-500/10 text-primary-600 dark:text-primary-400'
                        : 'border-neutral-200 dark:border-white/10 bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400',
                    ]"
                    @click="toggleAllowedCompanion(comp.id)"
                  >
                    {{ comp.name }}
                  </button>
                </div>
              </div>
            </div>

            <div :class="['flex', 'justify-end', 'border-t', 'border-neutral-200', 'dark:border-white/10', 'pt-3']">
              <Button
                variant="primary"
                size="sm"
                label="Save Permissions"
                @click="savePermissions"
              />
            </div>
          </div>
        </DrawerContent>
      </DrawerPortal>
    </DrawerRoot>

    <!-- Requests Drawer (BottomDrawer compliant) -->
    <DrawerRoot v-model:open="showRequestsDrawer">
      <DrawerPortal>
        <DrawerOverlay class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <DrawerContent
          class="fixed bottom-0 left-0 right-0 z-50 mx-auto max-h-[90dvh] max-w-lg border-t border-neutral-200 rounded-t-[32px] bg-white p-6 shadow-2xl outline-none dark:border-white/15 dark:bg-neutral-900"
        >
          <DrawerHandle class="mx-auto mb-4" />
          <div :class="['flex', 'items-center', 'justify-between', 'border-b', 'border-neutral-200', 'dark:border-white/10', 'pb-3']">
            <h3 :class="['text-base', 'font-semibold', 'text-neutral-900', 'dark:text-white']">
              Inbound Companion Requests
            </h3>
          </div>

          <div :class="['my-4', 'space-y-3']">
            <div
              v-for="req in pendingRequests"
              :key="req.id"
              :class="['rounded-xl', 'border', 'border-neutral-200', 'dark:border-white/10', 'bg-neutral-50', 'dark:bg-neutral-800/40', 'p-3']"
            >
              <div :class="['flex', 'items-center', 'justify-between']">
                <div :class="['flex', 'items-center', 'gap-3']">
                  <!-- Distinct Initial Avatar for Nan0 -->
                  <div :class="['flex', 'size-9', 'items-center', 'justify-center', 'rounded-xl', 'font-bold', 'text-xs', 'shadow-sm', getPeerAvatarGradient(req.characterName)]">
                    {{ req.characterName.charAt(0) }}
                  </div>
                  <div>
                    <div :class="['text-xs', 'font-semibold', 'text-neutral-900', 'dark:text-white']">
                      {{ req.characterName }} <span :class="['text-[11px]', 'font-normal', 'text-neutral-500', 'dark:text-neutral-400']">· {{ req.alias }}</span>
                    </div>
                    <div :class="['text-[11px]', 'font-mono', 'text-neutral-600', 'dark:text-neutral-300']">
                      {{ req.shareHandle }}
                    </div>
                  </div>
                </div>
                <div :class="['flex', 'items-center', 'gap-2']">
                  <Button
                    variant="primary"
                    size="sm"
                    label="Accept"
                    @click="handleAcceptRequest(req)"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    label="Ignore"
                    @click="pendingRequests = pendingRequests.filter(r => r.id !== req.id)"
                  />
                </div>
              </div>

              <!-- Attached 100-character personal note quote bubble -->
              <div
                v-if="req.introMessage"
                :class="['mt-2.5', 'rounded-lg', 'border-l-2', 'border-primary-500', 'bg-white/80', 'dark:bg-neutral-800/80', 'px-3', 'py-1.5', 'text-xs', 'text-neutral-700', 'dark:text-neutral-300', 'italic']"
              >
                "{{ req.introMessage }}"
              </div>
            </div>
          </div>

          <div :class="['flex', 'justify-end', 'border-t', 'border-neutral-200', 'dark:border-white/10', 'pt-3']">
            <Button
              variant="secondary"
              size="sm"
              label="Close"
              @click="showRequestsDrawer = false"
            />
          </div>
        </DrawerContent>
      </DrawerPortal>
    </DrawerRoot>

    <!-- QR Code Modal -->
    <div
      v-if="showQrModal"
      :class="['fixed', 'inset-0', 'z-50', 'flex', 'items-center', 'justify-center', 'bg-black/70', 'p-4', 'backdrop-blur-sm']"
      @click.self="showQrModal = false"
    >
      <div :class="['w-full', 'max-w-sm', 'rounded-2xl', 'border', 'border-neutral-200', 'dark:border-white/15', 'bg-white', 'dark:bg-neutral-900', 'p-5', 'text-center', 'shadow-2xl']">
        <h3 :class="['text-base', 'font-semibold', 'text-neutral-900', 'dark:text-white']">
          Scan to Connect
        </h3>
        <p :class="['mt-1', 'text-xs', 'text-neutral-500', 'dark:text-neutral-400']">
          Point Pocket AIRI or another device camera at this code.
        </p>

        <div :class="['mx-auto', 'my-5', 'flex', 'size-40', 'items-center', 'justify-center', 'rounded-2xl', 'border', 'border-neutral-200', 'dark:border-white/10', 'bg-white', 'p-3']">
          <div class="i-solar:qr-code-bold text-8xl text-neutral-950" />
        </div>

        <div :class="['font-mono', 'text-xs', 'text-neutral-600', 'dark:text-neutral-300']">
          {{ myAddress }}
        </div>

        <Button
          variant="secondary"
          size="sm"
          label="Close"
          block
          :class="['mt-5']"
          @click="showQrModal = false"
        />
      </div>
    </div>
  </div>
</template>
