import type { Env } from './index'

import crypto from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

import worker from './index'

function uint8ArrayToHex(arr: Uint8Array): string {
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('')
}

function createKv() {
  const map = new Map<string, string>()
  return {
    store: map,
    async get(key: string) {
      return map.has(key) ? map.get(key)! : null
    },
    async put(key: string, value: string) {
      map.set(key, value)
    },
    async delete(key: string) {
      map.delete(key)
    },
  }
}

async function generateEdKey() {
  const keyPair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']) as CryptoKeyPair
  const rawPublicKey = await crypto.subtle.exportKey('raw', keyPair.publicKey)
  const publicKeyHex = uint8ArrayToHex(new Uint8Array(rawPublicKey))
  return { keyPair, publicKeyHex }
}

describe('apps/stage-edge worker index', () => {
  const baseEnv: Env = {
    LLM_API_KEY: 'test-llm-key',
    DISCORD_PUBLIC_KEY: 'test-discord-public-key',
  }

  describe('oPTIONS CORS preflight', () => {
    it('returns status 204 with permissive CORS headers', async () => {
      const req = new Request('https://edge.airi.moeru.ai/cors-proxy', {
        method: 'OPTIONS',
      })
      const res = await worker.fetch(req, baseEnv)

      expect(res.status).toBe(204)
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
      expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST')
      expect(res.headers.get('Access-Control-Max-Age')).toBe('86400')
    })
  })

  describe('/health endpoint', () => {
    it('returns ok status and worker identity', async () => {
      const req = new Request('https://edge.airi.moeru.ai/health')
      const res = await worker.fetch(req, baseEnv)

      expect(res.status).toBe(200)
      const data: any = await res.json()
      expect(data).toEqual({ status: 'ok', worker: '@proj-airi/stage-edge' })
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    })
  })

  describe('/cors-proxy & /proxy endpoint', () => {
    it('returns 400 when url parameter is missing', async () => {
      const req = new Request('https://edge.airi.moeru.ai/cors-proxy')
      const res = await worker.fetch(req, baseEnv)

      expect(res.status).toBe(400)
      const data: any = await res.json()
      expect(data.error).toContain('Missing target URL')
    })

    it('remaps x-target-authorization and strips forbidden headers', async () => {
      let interceptedReq: Request | null = null
      const originalFetch = globalThis.fetch
      globalThis.fetch = vi.fn(async (input: any, init?: any) => {
        interceptedReq = new Request(input, init)
        return new Response(JSON.stringify({ proxied: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      })

      try {
        const req = new Request('https://edge.airi.moeru.ai/cors-proxy?url=https://api.cloudflare.com/client/v4/user', {
          headers: {
            'x-target-authorization': 'Bearer proxy-token-123',
            'x-target-url': 'https://api.cloudflare.com/client/v4/user',
            'origin': 'https://airi.moeru.ai',
            'referer': 'https://airi.moeru.ai/settings',
          },
        })

        const res = await worker.fetch(req, baseEnv)
        expect(res.status).toBe(200)
        expect(interceptedReq).not.toBeNull()
        expect(interceptedReq!.headers.get('Authorization')).toBe('Bearer proxy-token-123')
        expect(interceptedReq!.headers.get('x-target-authorization')).toBeNull()
        expect(interceptedReq!.headers.get('x-target-url')).toBeNull()
        expect(interceptedReq!.headers.get('origin')).toBeNull()
        expect(interceptedReq!.headers.get('referer')).toBeNull()
      }
      finally {
        globalThis.fetch = originalFetch
      }
    })
  })

  describe('/discord webhook handling', () => {
    it('returns 401 when signature verification fails', async () => {
      const req = new Request('https://edge.airi.moeru.ai/discord', {
        method: 'POST',
        headers: {
          'x-signature-ed25519': 'bad-signature',
          'x-signature-timestamp': '1700000000',
        },
        body: JSON.stringify({ type: 1 }),
      })

      const res = await worker.fetch(req, baseEnv)
      expect(res.status).toBe(401)
      const text = await res.text()
      expect(text).toBe('Invalid signature')
    })

    it('handles Type 1 PING with Type 1 PONG response when signature is valid', async () => {
      const keyPair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']) as CryptoKeyPair
      const rawPublicKey = await crypto.subtle.exportKey('raw', keyPair.publicKey)
      const publicKeyHex = uint8ArrayToHex(new Uint8Array(rawPublicKey))

      const timestamp = '1725800000'
      const body = JSON.stringify({ type: 1 })
      const encoder = new TextEncoder()
      const signedData = encoder.encode(timestamp + body)
      const signatureBuffer = await crypto.subtle.sign('Ed25519', keyPair.privateKey, signedData)
      const signatureHex = uint8ArrayToHex(new Uint8Array(signatureBuffer))

      const req = new Request('https://edge.airi.moeru.ai/discord', {
        method: 'POST',
        headers: {
          'x-signature-ed25519': signatureHex,
          'x-signature-timestamp': timestamp,
        },
        body,
      })

      const env: Env = {
        ...baseEnv,
        DISCORD_PUBLIC_KEY: publicKeyHex,
      }

      const res = await worker.fetch(req, env)
      expect(res.status).toBe(200)
      const data: any = await res.json()
      expect(data).toEqual({ type: 1 })
    })

    it('returns Type 5 DEFERRED for Type 2 command and registers waitUntil execution', async () => {
      const keyPair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']) as CryptoKeyPair
      const rawPublicKey = await crypto.subtle.exportKey('raw', keyPair.publicKey)
      const publicKeyHex = uint8ArrayToHex(new Uint8Array(rawPublicKey))

      const timestamp = '1725800000'
      const interactionPayload = {
        type: 2,
        application_id: 'app_123',
        token: 'token_456',
        data: {
          options: [{ name: 'message', value: 'Hello AIRI!' }],
        },
      }
      const body = JSON.stringify(interactionPayload)
      const encoder = new TextEncoder()
      const signedData = encoder.encode(timestamp + body)
      const signatureBuffer = await crypto.subtle.sign('Ed25519', keyPair.privateKey, signedData)
      const signatureHex = uint8ArrayToHex(new Uint8Array(signatureBuffer))

      const req = new Request('https://edge.airi.moeru.ai/discord', {
        method: 'POST',
        headers: {
          'x-signature-ed25519': signatureHex,
          'x-signature-timestamp': timestamp,
        },
        body,
      })

      const env: Env = {
        ...baseEnv,
        DISCORD_PUBLIC_KEY: publicKeyHex,
      }

      let waitedPromise: Promise<any> | null = null
      const ctx = {
        waitUntil: (p: Promise<any>) => {
          waitedPromise = p
        },
      }

      const res = await worker.fetch(req, env, ctx)
      expect(res.status).toBe(200)
      const data: any = await res.json()
      expect(data).toEqual({ type: 5 })
      expect(waitedPromise).not.toBeNull()
    })
  })

  describe('embassy DO routing (KV fallback preserved)', () => {
    function stubEmbassy(handler: (url: string, init: any) => Promise<Response>) {
      const fetchFn = vi.fn(handler)
      const stub = { fetch: fetchFn }
      const ns = {
        idFromName: vi.fn(() => ({ toString: () => 'embassy-id' })),
        get: vi.fn(() => stub),
      }
      return { ns, stub, fetchFn }
    }

    async function signedRequestPayload(keyPair: CryptoKeyPair, publicKeyHex: string, intro: string, nonce: string) {
      const timestamp = Date.now()
      const payload = `${timestamp}:${nonce}:${intro}:${publicKeyHex}`
      const data = new TextEncoder().encode(payload)
      const sig = await crypto.subtle.sign('Ed25519', keyPair.privateKey, data)
      return { timestamp, signature: uint8ArrayToHex(new Uint8Array(sig)) }
    }

    it('routes friend requests through the DO when bound, skipping KV', async () => {
      const { keyPair, publicKeyHex } = await generateEdKey()
      const kv = createKv()
      const { ns, fetchFn } = stubEmbassy(async () => new Response(JSON.stringify({ stored: true, pushed: 1 }), { status: 200 }))
      const { timestamp, signature } = await signedRequestPayload(keyPair, publicKeyHex, 'hi there', 'do-nonce-1')
      const res = await worker.fetch(
        new Request('https://edge.airi.moeru.ai/api/friends/request', {
          method: 'POST',
          body: JSON.stringify({
            fromHandle: 'alex.workers.dev',
            fromPubkey: publicKeyHex,
            fromCharacterName: 'Kirie',
            introMessage: 'hi there',
            timestamp,
            nonce: 'do-nonce-1',
            signature,
          }),
        }),
        { ...baseEnv, MEMORY: kv as any, EMBASSY: ns as any },
      )
      expect(res.status).toBe(200)
      const data: any = await res.json()
      expect(data.status).toBe('pending')
      expect(data.pushed).toBe(1)
      expect(fetchFn).toHaveBeenCalledOnce()
      expect([...kv.store.keys()].some(k => k.startsWith('friends/requests/inbound/'))).toBe(false)
    })

    it('returns 502 when the DO is unreachable', async () => {
      const { keyPair, publicKeyHex } = await generateEdKey()
      const kv = createKv()
      const ns = {
        idFromName: () => ({ toString: () => 'embassy-id' }),
        get: () => ({ fetch: async () => { throw new Error('boom') } }),
      }
      const { timestamp, signature } = await signedRequestPayload(keyPair, publicKeyHex, 'hi', 'do-nonce-2')
      const res = await worker.fetch(
        new Request('https://edge.airi.moeru.ai/api/friends/request', {
          method: 'POST',
          body: JSON.stringify({
            fromHandle: 'alex.workers.dev',
            fromPubkey: publicKeyHex,
            fromCharacterName: 'Kirie',
            introMessage: 'hi',
            timestamp,
            nonce: 'do-nonce-2',
            signature,
          }),
        }),
        { ...baseEnv, MEMORY: kv as any, EMBASSY: ns as any },
      )
      expect(res.status).toBe(502)
    })

    it('routes inbox through the DO and maps quarantine', async () => {
      const { keyPair, publicKeyHex } = await generateEdKey()
      const kv = createKv()
      const trusted = stubEmbassy(async () => new Response(JSON.stringify({ queued: true, pushed: 2 }), { status: 200 }))
      const bodyText = JSON.stringify({ topic: 'airi/nap-chat/turn', payload: { text: 'hey' } })
      const timestamp = Date.now()
      const nonce = 'do-inbox-1'
      const sigData = new TextEncoder().encode(`${timestamp}:${nonce}:${bodyText}`)
      const sig = uint8ArrayToHex(new Uint8Array(await crypto.subtle.sign('Ed25519', keyPair.privateKey, sigData)))
      const res = await worker.fetch(
        new Request('https://edge.airi.moeru.ai/api/friends/inbox', {
          method: 'POST',
          headers: {
            'x-sender-pubkey': publicKeyHex,
            'x-signature-ed25519': sig,
            'x-signature-timestamp': String(timestamp),
            'x-signature-nonce': nonce,
          },
          body: bodyText,
        }),
        { ...baseEnv, MEMORY: kv as any, EMBASSY: trusted.ns as any },
      )
      expect(res.status).toBe(200)
      expect((await res.json() as any).queued).toBe(true)

      const quarantined = stubEmbassy(async () => new Response(JSON.stringify({ error: 'quarantined' }), { status: 403 }))
      const nonce2 = 'do-inbox-2'
      const sigData2 = new TextEncoder().encode(`${timestamp}:${nonce2}:${bodyText}`)
      const sig2 = uint8ArrayToHex(new Uint8Array(await crypto.subtle.sign('Ed25519', keyPair.privateKey, sigData2)))
      const res2 = await worker.fetch(
        new Request('https://edge.airi.moeru.ai/api/friends/inbox', {
          method: 'POST',
          headers: {
            'x-sender-pubkey': publicKeyHex,
            'x-signature-ed25519': sig2,
            'x-signature-timestamp': String(timestamp),
            'x-signature-nonce': nonce2,
          },
          body: bodyText,
        }),
        { ...baseEnv, MEMORY: kv as any, EMBASSY: quarantined.ns as any },
      )
      expect(res2.status).toBe(403)
    })

    it('gates /ws on owner proof and DO binding', async () => {
      const noDo = await worker.fetch(
        new Request('https://edge.airi.moeru.ai/ws', { headers: { 'x-owner-id': 'owner-1' } }),
        { ...baseEnv, OWNER_ID: 'owner-1' },
      )
      expect(noDo.status).toBe(503)

      const forbidden = await worker.fetch(
        new Request('https://edge.airi.moeru.ai/ws'),
        { ...baseEnv, OWNER_ID: 'owner-1', EMBASSY: stubEmbassy(async () => new Response(null, { status: 200 })).ns as any },
      )
      expect(forbidden.status).toBe(403)

      // NOTE: Node's Response caps status at 599, so the stub answers 200 here;
      // in workerd the DO answers the real 101 upgrade. Passthrough is what matters.
      const { ns } = stubEmbassy(async () => new Response(null, { status: 200 }))
      const passthrough = await worker.fetch(
        new Request('https://edge.airi.moeru.ai/ws?machine=studio-mac', { headers: { 'x-owner-id': 'owner-1' } }),
        { ...baseEnv, OWNER_ID: 'owner-1', EMBASSY: ns as any },
      )
      expect(passthrough.status).toBe(200)
    })
  })

  describe('pOST /api/friends/accept trust grant', () => {
    const acceptBody = (pubkey: string, handle = 'alex.workers.dev') => ({
      method: 'POST',
      headers: { 'x-owner-id': 'owner-1' },
      body: JSON.stringify({ pubkey, handle }),
    })

    it('rejects unauthenticated, malformed, and KV-less calls', async () => {
      const { publicKeyHex } = await generateEdKey()

      const noKv = await worker.fetch(
        new Request('https://edge.airi.moeru.ai/api/friends/accept', acceptBody(publicKeyHex)),
        { ...baseEnv, OWNER_ID: 'owner-1' },
      )
      expect(noKv.status).toBe(503)

      const kv = createKv()
      const noOwner = await worker.fetch(
        new Request('https://edge.airi.moeru.ai/api/friends/accept', {
          method: 'POST',
          body: JSON.stringify({ pubkey: publicKeyHex }),
        }),
        { ...baseEnv, OWNER_ID: 'owner-1', MEMORY: kv as any },
      )
      expect(noOwner.status).toBe(403)

      const badKey = await worker.fetch(
        new Request('https://edge.airi.moeru.ai/api/friends/accept', {
          method: 'POST',
          headers: { 'x-owner-id': 'owner-1' },
          body: JSON.stringify({ pubkey: 'not-a-key' }),
        }),
        { ...baseEnv, OWNER_ID: 'owner-1', MEMORY: kv as any },
      )
      expect(badKey.status).toBe(400)
    })

    it('routes trust grants through the DO when bound', async () => {
      const { publicKeyHex } = await generateEdKey()
      const kv = createKv()
      const seen: string[] = []
      const ns = {
        idFromName: vi.fn(() => ({ toString: () => 'embassy-id' })),
        get: vi.fn(() => ({
          fetch: vi.fn(async (url: string) => {
            seen.push(url)
            return new Response(JSON.stringify({ trusted: true }), { status: 200 })
          }),
        })),
      }
      const res = await worker.fetch(
        new Request('https://edge.airi.moeru.ai/api/friends/accept', acceptBody(publicKeyHex)),
        { ...baseEnv, OWNER_ID: 'owner-1', MEMORY: kv as any, EMBASSY: ns as any },
      )
      expect(res.status).toBe(200)
      expect((await res.json() as any).trusted).toBe(true)
      expect(seen).toEqual(['https://embassy/internal/accept'])

      const downNs = {
        idFromName: () => ({ toString: () => 'embassy-id' }),
        get: () => ({ fetch: async () => { throw new Error('boom') } }),
      }
      const down = await worker.fetch(
        new Request('https://edge.airi.moeru.ai/api/friends/accept', acceptBody(publicKeyHex)),
        { ...baseEnv, OWNER_ID: 'owner-1', MEMORY: kv as any, EMBASSY: downNs as any },
      )
      expect(down.status).toBe(502)
    })

    it('kV fallback closes the loop: accept then inbox queues', async () => {
      const { keyPair, publicKeyHex } = await generateEdKey()
      const kv = createKv()
      const env: Env = { ...baseEnv, OWNER_ID: 'owner-1', MEMORY: kv as any }

      const accept = await worker.fetch(
        new Request('https://edge.airi.moeru.ai/api/friends/accept', acceptBody(publicKeyHex)),
        env,
      )
      expect(accept.status).toBe(200)
      expect(kv.store.has(`friends/accepted/${publicKeyHex}`)).toBe(true)

      const bodyText = JSON.stringify({ topic: 'airi/nap-chat/turn', payload: {} })
      const timestamp = Date.now()
      const nonce = 'accept-loop-nonce-1'
      const sigData = new TextEncoder().encode(`${timestamp}:${nonce}:${bodyText}`)
      const sig = uint8ArrayToHex(new Uint8Array(await crypto.subtle.sign('Ed25519', keyPair.privateKey, sigData)))
      const inbox = await worker.fetch(
        new Request('https://edge.airi.moeru.ai/api/friends/inbox', {
          method: 'POST',
          headers: {
            'x-sender-pubkey': publicKeyHex,
            'x-signature-ed25519': sig,
            'x-signature-timestamp': String(timestamp),
            'x-signature-nonce': nonce,
          },
          body: bodyText,
        }),
        env,
      )
      expect(inbox.status).toBe(200)
      expect((await inbox.json() as any).queued).toBe(true)
    })
  })

  describe('unmatched routes', () => {
    it('returns 404 Not Found for unrecognized path', async () => {
      const req = new Request('https://edge.airi.moeru.ai/unknown-route')
      const res = await worker.fetch(req, baseEnv)
      expect(res.status).toBe(404)
    })
  })

  describe('companion embassy', () => {
    async function signHex(privateKey: CryptoKey, message: string): Promise<string> {
      const data = new TextEncoder().encode(message)
      const sig = await crypto.subtle.sign('Ed25519', privateKey, data)
      return uint8ArrayToHex(new Uint8Array(sig))
    }

    it('gET /api/companion/card exposes ambassador only', async () => {
      const req = new Request('https://edge.airi.moeru.ai/api/companion/card')
      const res = await worker.fetch(req, {
        ...baseEnv,
        CHARACTER_NAME: 'Kirie',
        COMPANION_TAGLINE: 'quiet conversations',
        COMPANION_PUBLIC_KEY: 'ab'.repeat(32),
      })
      expect(res.status).toBe(200)
      const data: any = await res.json()
      expect(data.name).toBe('Kirie')
      expect(data.tagline).toBe('quiet conversations')
      expect(data.publicKey).toBe('ab'.repeat(32))
      expect(data.cards ?? null).toBeNull()
      expect(data.systemPrompt ?? null).toBeNull()
    })

    it('pOST /api/friends/invite requires KV and owner', async () => {
      const noKv = await worker.fetch(
        new Request('https://edge.airi.moeru.ai/api/friends/invite', { method: 'POST' }),
        { ...baseEnv, OWNER_ID: 'owner-1' },
      )
      expect(noKv.status).toBe(503)

      const kv = createKv()
      const forbidden = await worker.fetch(
        new Request('https://edge.airi.moeru.ai/api/friends/invite', { method: 'POST' }),
        { ...baseEnv, OWNER_ID: 'owner-1', MEMORY: kv as any },
      )
      expect(forbidden.status).toBe(403)

      const ok = await worker.fetch(
        new Request('https://edge.airi.moeru.ai/api/friends/invite', {
          method: 'POST',
          headers: { 'x-owner-id': 'owner-1' },
        }),
        { ...baseEnv, OWNER_ID: 'owner-1', MEMORY: kv as any },
      )
      expect(ok.status).toBe(200)
      const data: any = await ok.json()
      expect(typeof data.invite).toBe('string')
      expect(data.uri).toContain('airi://pair?worker=')
      expect(data.expiresAt).toBeGreaterThan(Date.now() + 23 * 3600 * 1000)
      expect(kv.store.has(`friends/invites/${data.invite}`)).toBe(true)
    })

    it('pOST /api/friends/request enforces intro limit, freshness, nonce, signature', async () => {
      const { keyPair, publicKeyHex } = await generateEdKey()
      const kv = createKv()
      const env: Env = { ...baseEnv, MEMORY: kv as any }

      const tooLong = await worker.fetch(
        new Request('https://edge.airi.moeru.ai/api/friends/request', {
          method: 'POST',
          body: JSON.stringify({
            fromHandle: 'alex.workers.dev',
            fromPubkey: publicKeyHex,
            fromCharacterName: 'Kirie',
            introMessage: 'x'.repeat(101),
            timestamp: Date.now(),
            nonce: 'nonce-1-abcdef',
            signature: '00'.repeat(64),
          }),
        }),
        env,
      )
      expect(tooLong.status).toBe(400)
      expect((await tooLong.json() as any).error).toBe('intro_too_long')

      const stale = await worker.fetch(
        new Request('https://edge.airi.moeru.ai/api/friends/request', {
          method: 'POST',
          body: JSON.stringify({
            fromHandle: 'alex.workers.dev',
            fromPubkey: publicKeyHex,
            fromCharacterName: 'Kirie',
            introMessage: 'hi',
            timestamp: Date.now() - 600_000,
            nonce: 'nonce-2-abcdef',
            signature: '00'.repeat(64),
          }),
        }),
        env,
      )
      expect(stale.status).toBe(400)

      const timestamp = Date.now()
      const nonce = 'nonce-3-abcdef'
      const payload = `${timestamp}:${nonce}:hi:${publicKeyHex}`
      const signature = await signHex(keyPair.privateKey, payload)
      const first = await worker.fetch(
        new Request('https://edge.airi.moeru.ai/api/friends/request', {
          method: 'POST',
          body: JSON.stringify({
            fromHandle: 'alex.workers.dev',
            fromPubkey: publicKeyHex,
            fromCharacterName: 'Kirie',
            introMessage: 'hi <b>there</b>',
            timestamp,
            nonce,
            signature: await signHex(keyPair.privateKey, `${timestamp}:${nonce}:hi there:${publicKeyHex}`),
          }),
        }),
        env,
      )
      expect(first.status).toBe(200)
      expect((await first.json() as any).status).toBe('pending')

      const replay = await worker.fetch(
        new Request('https://edge.airi.moeru.ai/api/friends/request', {
          method: 'POST',
          body: JSON.stringify({
            fromHandle: 'alex.workers.dev',
            fromPubkey: publicKeyHex,
            fromCharacterName: 'Kirie',
            introMessage: 'hi there',
            timestamp: Date.now(),
            nonce,
            signature,
          }),
        }),
        env,
      )
      expect(replay.status).toBe(400)
      expect((await replay.json() as any).error).toBe('replayed_nonce')

      const tampered = await worker.fetch(
        new Request('https://edge.airi.moeru.ai/api/friends/request', {
          method: 'POST',
          body: JSON.stringify({
            fromHandle: 'alex.workers.dev',
            fromPubkey: publicKeyHex,
            fromCharacterName: 'Kirie',
            introMessage: 'tampered',
            timestamp: Date.now(),
            nonce: 'nonce-4-abcdef',
            signature: '00'.repeat(64),
          }),
        }),
        env,
      )
      expect(tampered.status).toBe(401)
    })

    it('pOST /api/friends/request ferries an opted-in tagline outside the signature', async () => {
      // ROOT CAUSE LOCK: the tagline is a self-asserted public claim (same class
      // as the display name). It must verify against the ORIGINAL signature
      // payload and ride to storage unmodified apart from sanitization.
      const { keyPair, publicKeyHex } = await generateEdKey()
      const kv = createKv()
      const env: Env = { ...baseEnv, MEMORY: kv as any }

      const timestamp = Date.now()
      const nonce = 'tagline-nonce-1'
      const payload = `${timestamp}:${nonce}:hi:${publicKeyHex}`
      const signature = await signHex(keyPair.privateKey, payload)
      const res = await worker.fetch(
        new Request('https://edge.airi.moeru.ai/api/friends/request', {
          method: 'POST',
          body: JSON.stringify({
            fromHandle: 'alex.workers.dev',
            fromPubkey: publicKeyHex,
            fromCharacterName: 'Kirie',
            introMessage: 'hi',
            fromTagline: 'Quiet <b>conversations</b>',
            timestamp,
            nonce,
            signature,
          }),
        }),
        env,
      )
      expect(res.status).toBe(200)

      const stored = [...kv.store.values()].map(v => JSON.parse(v)).find(r => r.nonce === nonce)
      expect(stored).toBeDefined()
      expect(stored.fromTagline).toBe('Quiet conversations')

      const tooLong = await worker.fetch(
        new Request('https://edge.airi.moeru.ai/api/friends/request', {
          method: 'POST',
          body: JSON.stringify({
            fromHandle: 'alex.workers.dev',
            fromPubkey: publicKeyHex,
            fromCharacterName: 'Kirie',
            introMessage: 'hi',
            fromTagline: 'x'.repeat(141),
            timestamp: Date.now(),
            nonce: 'tagline-nonce-2',
            signature: '00'.repeat(64),
          }),
        }),
        env,
      )
      expect(tooLong.status).toBe(400)
      expect((await tooLong.json() as any).error).toBe('tagline_too_long')
    })

    it('pOST /api/friends/inbox quarantines untrusted senders and queues trusted', async () => {
      const { keyPair, publicKeyHex } = await generateEdKey()
      const kv = createKv()
      const env: Env = { ...baseEnv, MEMORY: kv as any }
      const bodyText = JSON.stringify({ action: 'nap_propose' })

      // Authenticated but untrusted sender: valid signature, no roster entry → 403.
      // Signature is verified before the trust check so strangers cannot probe
      // the roster (no membership oracle for unauthenticated callers).
      const quarantineTimestamp = Date.now()
      const quarantineSig = await signHex(keyPair.privateKey, `${quarantineTimestamp}:inbox-nonce-1:${bodyText}`)
      const quarantined = await worker.fetch(
        new Request('https://edge.airi.moeru.ai/api/friends/inbox', {
          method: 'POST',
          headers: {
            'x-sender-pubkey': publicKeyHex,
            'x-signature-ed25519': quarantineSig,
            'x-signature-timestamp': String(quarantineTimestamp),
            'x-signature-nonce': 'inbox-nonce-1',
          },
          body: bodyText,
        }),
        env,
      )
      expect(quarantined.status).toBe(403)

      await kv.put(`friends/accepted/${publicKeyHex}`, JSON.stringify({ at: Date.now() }))
      const timestamp = Date.now()
      const nonce = 'inbox-nonce-2'
      const signature = await signHex(keyPair.privateKey, `${timestamp}:${nonce}:${bodyText}`)
      const queued = await worker.fetch(
        new Request('https://edge.airi.moeru.ai/api/friends/inbox', {
          method: 'POST',
          headers: {
            'x-sender-pubkey': publicKeyHex,
            'x-signature-ed25519': signature,
            'x-signature-timestamp': String(timestamp),
            'x-signature-nonce': nonce,
          },
          body: bodyText,
        }),
        env,
      )
      expect(queued.status).toBe(200)
      expect((await queued.json() as any).queued).toBe(true)

      const replay = await worker.fetch(
        new Request('https://edge.airi.moeru.ai/api/friends/inbox', {
          method: 'POST',
          headers: {
            'x-sender-pubkey': publicKeyHex,
            'x-signature-ed25519': signature,
            'x-signature-timestamp': String(timestamp),
            'x-signature-nonce': nonce,
          },
          body: bodyText,
        }),
        env,
      )
      expect(replay.status).toBe(400)
    })
  })
})
