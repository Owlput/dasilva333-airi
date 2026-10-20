import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useCloudflareStore } from './cloudflare'
import { resolveAccountId } from './cloudflare-auth'

describe('cloudflare store persistence & corruption recovery', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('serializes token objects to valid JSON instead of [object Object]', async () => {
    const store = useCloudflareStore()

    store.cfOAuthTokens = {
      accessToken: 'test_access_token_123',
      refreshToken: 'test_refresh_token_456',
      expiresIn: 3600,
      accountId: 'test_account_id_789',
    }

    // Wait a tick for watcher / storage flush
    await new Promise(resolve => setTimeout(resolve, 50))

    const rawInStorage = localStorage.getItem('settings/cloudflare/cfOAuthTokens')
    expect(rawInStorage).not.toBeNull()
    expect(rawInStorage).not.toBe('[object Object]')
    expect(rawInStorage).toContain('test_access_token_123')

    const parsed = JSON.parse(rawInStorage || '{}')
    expect(parsed.accessToken).toBe('test_access_token_123')
    expect(parsed.refreshToken).toBe('test_refresh_token_456')
    expect(parsed.accountId).toBe('test_account_id_789')
  })

  it('recovers gracefully from legacy corrupted [object Object] in localStorage on boot', () => {
    // Seed corrupted state that previously occurred
    localStorage.setItem('settings/cloudflare/cfOAuthTokens', '[object Object]')
    localStorage.setItem('settings/discord/cfOAuthTokens', '[object Object]')
    localStorage.setItem('settings/cloudflare/cfAccountId', '[object Object]')
    localStorage.setItem('settings/cloudflare/cfApiToken', '[object Object]')

    // Creating the store should not throw and should clean up corrupted values
    const store = useCloudflareStore()

    expect(store.cfOAuthTokens).toBeNull()
    expect(store.cfAccountId).toBe('')
    expect(store.cfApiToken).toBe('')
    expect(store.isAuthenticated).toBe(false)
    expect(localStorage.getItem('settings/cloudflare/cfOAuthTokens')).toBeNull()
    expect(localStorage.getItem('settings/discord/cfOAuthTokens')).toBeNull()
  })

  it('persists authenticated state across simulated app restarts', async () => {
    // Session 1: User logs in
    const session1Store = useCloudflareStore()
    session1Store.cfOAuthTokens = {
      accessToken: 'persisted_token_abc',
      refreshToken: 'persisted_refresh_def',
      expiresIn: 3600,
      accountId: 'persisted_acc_123',
    }
    session1Store.cfAccountId = 'persisted_acc_123'
    expect(session1Store.isAuthenticated).toBe(true)

    await new Promise(resolve => setTimeout(resolve, 50))

    // Session 2: App restarts (new pinia root, re-instantiate store)
    setActivePinia(createPinia())
    const session2Store = useCloudflareStore()

    expect(session2Store.cfOAuthTokens).not.toBeNull()
    expect(session2Store.cfOAuthTokens?.accessToken).toBe('persisted_token_abc')
    expect(session2Store.cfOAuthTokens?.refreshToken).toBe('persisted_refresh_def')
    expect(session2Store.cfAccountId).toBe('persisted_acc_123')
    expect(session2Store.isAuthenticated).toBe(true)
    expect(session2Store.activeAccessToken).toBe('persisted_token_abc')
    expect(session2Store.activeAccountId).toBe('persisted_acc_123')
  })

  it('correctly resolves account ID from accounts list when missing from token response', () => {
    // Token endpoint response does not include account_id
    const tokenDataWithoutAccountId = {
      account_id: undefined,
      access_token: 'valid_access_token',
      refresh_token: 'valid_refresh_token',
    }

    const accountsApiResponse = {
      result: [
        { id: 'resolved_cf_account_id_999', name: 'Primary Account' },
      ],
    }

    const resolved = resolveAccountId(tokenDataWithoutAccountId, accountsApiResponse)
    expect(resolved).toBe('resolved_cf_account_id_999')
  })

  it('syncVaultDevices merges remote devices from Edge Vault and writes back updated roster', async () => {
    const store = useCloudflareStore()
    store.cfApiToken = 'dummy_token'
    store.cfAccountId = 'dummy_acc'

    const remoteMap = {
      'remote-laptop': {
        machineId: 'remote-laptop',
        deviceName: 'MacBook Air',
        deviceType: 'desktop' as const,
        workerUrl: 'https://airi-stage-edge.r1ch4rd.workers.dev',
        lastSeen: Date.now() - 5000,
        presenceState: 'active' as const,
      },
    }

    const putCalls: Array<{ url: string, body: string }> = []

    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const decodedUrl = decodeURIComponent(String(url))
      if (decodedUrl.includes('/storage/kv/namespaces') && !decodedUrl.includes('/values/')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            result: init?.method === 'POST'
              ? { id: 'mock-edge-vault-ns', title: 'airi-edge-vault' }
              : [{ id: 'mock-edge-vault-ns', title: 'airi-edge-vault' }],
          }),
        } as any
      }

      if (decodedUrl.includes('/values/devices%2Fmap') && (!init?.method || init.method === 'GET')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify(remoteMap),
        } as any
      }

      if (decodedUrl.includes('/values/devices%2Fmap') && init?.method === 'PUT') {
        putCalls.push({ url: decodedUrl, body: String(init.body) })
        return {
          ok: true,
          status: 200,
          text: async () => '',
        } as any
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
        text: async () => '',
      } as any
    }))

    const res = await store.syncVaultDevices()
    expect(res.success).toBe(true)
    expect(putCalls.length).toBeGreaterThan(0)
    expect(putCalls[0].url).toContain('devices%2Fmap')

    const parsedSaved = JSON.parse(putCalls[0].body)
    expect(parsedSaved['remote-laptop']).toBeDefined()
    expect(parsedSaved['remote-laptop'].deviceName).toBe('MacBook Air')

    vi.unstubAllGlobals()
  })
})
