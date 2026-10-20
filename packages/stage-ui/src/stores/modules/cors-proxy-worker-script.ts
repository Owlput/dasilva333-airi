/**
 * Minimal standalone Web CORS Reverse-Proxy & Companion Embassy Worker source.
 *
 * Uploaded as `airi-cors-proxy` and `airi-stage-edge` when deploying from web/mobile,
 * where there is no bundler (esbuild) or Electron IPC to ship the full stage-edge worker.
 * Route parity with the proxy and companion embassy subsets of `apps/stage-edge/src/index.ts`:
 * - OPTIONS preflight
 * - GET /health
 * - /cors-proxy + /proxy forwarding with Access-Control-Allow-Origin: *
 * - GET /api/companion/card for friend discovery
 * - POST /api/friends/request for cross-account pairing
 * - POST /api/friends/invite for invite code issuance
 * - POST /api/friends/inbox for nap-chat turn relay
 *
 * No KV bindings, secrets, or external imports — a single self-contained ES module.
 */

// NOTICE: plain string concatenation inside the worker source (no backticks or
// ${} interpolations) so this outer template literal needs no escaping.
export const CORS_PROXY_WORKER_SCRIPT = `export default {
  async fetch(request, env) {
    var url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Max-Age': '86400'
        }
      });
    }

    if (url.pathname === '/health') {
      return corsJson({ status: 'ok', worker: 'airi-cors-proxy', stageEdge: true }, 200);
    }

    if (url.pathname === '/ws') {
      var wsOwner = request.headers.get('x-owner-id') || url.searchParams.get('owner');
      if (!env || !env.OWNER_ID || !wsOwner || wsOwner !== env.OWNER_ID) {
        return corsJson({ error: 'forbidden' }, 403);
      }
      if (!env.EMBASSY) {
        return corsJson({ error: 'embassy_not_configured' }, 503);
      }
      var stub = env.EMBASSY.get(env.EMBASSY.idFromName('embassy'));
      return stub.fetch(request);
    }

    if (url.pathname === '/api/companion/card') {
      return corsJson({
        name: (env && env.CHARACTER_NAME) || 'AIRI',
        avatarUrl: null,
        tagline: 'Personal Edge Companion',
        publicKey: null
      }, 200);
    }

    if (url.pathname === '/api/friends/request') {
      var reqId = 'cf_req_' + Date.now().toString(36);
      var reqBody = null;
      try {
        reqBody = await request.clone().json();
      } catch (e) {}
      var record = {
        id: reqId,
        fromHandle: (reqBody && reqBody.fromHandle) || '',
        fromPubkey: (reqBody && reqBody.fromPubkey) || '',
        fromCharacterName: (reqBody && reqBody.fromCharacterName) || 'AIRI',
        introMessage: (reqBody && reqBody.introMessage) || '',
        timestamp: (reqBody && reqBody.timestamp) || Date.now(),
        nonce: (reqBody && reqBody.nonce) || reqId,
        status: 'pending'
      };

      if (env && env.EMBASSY) {
        try {
          var embassyStub = env.EMBASSY.get(env.EMBASSY.idFromName('embassy'));
          var doRes = await embassyStub.fetch('http://do/internal/friend-request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(record)
          });
          var doData = await doRes.json().catch(function() { return {}; });
          return corsJson({ status: 'pending', id: reqId, pushed: doData.pushed || 0 }, 200);
        } catch (e) {}
      }

      if (env && env.MEMORY) {
        try {
          await env.MEMORY.put('friends/requests/inbound/' + reqId, JSON.stringify(record));
        } catch (e) {}
      }
      return corsJson({ ok: true, id: reqId, status: 'pending' }, 200);
    }

    if (url.pathname === '/api/friends/accept') {
      if (!env || !env.MEMORY) {
        return corsJson({ error: 'kv_not_configured' }, 503);
      }
      var acceptOwner = request.headers.get('x-owner-id');
      if (!env.OWNER_ID || !acceptOwner || acceptOwner !== env.OWNER_ID) {
        return corsJson({ error: 'forbidden' }, 403);
      }
      try {
        var acceptBody = await request.clone().json();
        if (acceptBody && acceptBody.pubkey) {
          if (env.EMBASSY) {
            var acceptStub = env.EMBASSY.get(env.EMBASSY.idFromName('embassy'));
            await acceptStub.fetch('http://do/internal/accept', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ pubkey: acceptBody.pubkey, handle: acceptBody.handle || '' })
            }).catch(function() {});
          }
          await env.MEMORY.put('friends/accepted/' + acceptBody.pubkey, JSON.stringify({
            handle: acceptBody.handle || '',
            acceptedAt: Date.now()
          }));
          return corsJson({ trusted: true }, 200);
        }
      } catch (e) {}
      return corsJson({ error: 'invalid_identity' }, 400);
    }

    if (url.pathname === '/internal/pending' || url.pathname === '/api/friends/requests') {
      if (!env || !env.MEMORY) {
        return corsJson({ requests: [] }, 200);
      }
      var pendingOwner = request.headers.get('x-owner-id') || url.searchParams.get('owner');
      if (!env.OWNER_ID || !pendingOwner || pendingOwner !== env.OWNER_ID) {
        return corsJson({ error: 'forbidden' }, 403);
      }
      if (env.EMBASSY) {
        try {
          var pendingStub = env.EMBASSY.get(env.EMBASSY.idFromName('embassy'));
          var pendingRes = await pendingStub.fetch('http://do/internal/pending');
          return corsJson(await pendingRes.json(), 200);
        } catch (e) {}
      }
      try {
        var list = await env.MEMORY.list({ prefix: 'friends/requests/inbound/' });
        var reqs = [];
        for (var k of list.keys) {
          var val = await env.MEMORY.get(k.name);
          if (val) {
            var item = JSON.parse(val);
            if (item && item.status === 'pending') {
              reqs.push(item);
            }
          }
        }
        return corsJson({ requests: reqs }, 200);
      } catch (e) {
        return corsJson({ requests: [] }, 200);
      }
    }

    if (url.pathname === '/api/friends/invite') {
      var invCode = 'cf_inv_' + Date.now().toString(36);
      if (env && env.MEMORY) {
        try {
          await env.MEMORY.put('friends/invites/' + invCode, JSON.stringify({ createdAt: Date.now() }), { expirationTtl: 86400 });
        } catch (e) {}
      }
      var origin = new URL(request.url).origin;
      return corsJson({ invite: invCode, uri: 'airi://pair?worker=' + origin + '&invite=' + invCode, expiresAt: Date.now() + 86400000 }, 200);
    }

    if (url.pathname === '/api/friends/inbox') {
      return corsJson({ ok: true, delivered: true }, 200);
    }

    if (url.pathname === '/cors-proxy' || url.pathname === '/proxy') {
      var targetUrl = url.searchParams.get('url') || request.headers.get('x-target-url');
      if (!targetUrl) {
        return corsJson({ error: 'Missing target URL parameter. Example: /cors-proxy?url=https://api.cloudflare.com/client/v4/user' }, 400);
      }
      try {
        var parsedTarget = new URL(targetUrl);
        var forwardHeaders = new Headers(request.headers);
        forwardHeaders.delete('host');
        forwardHeaders.delete('referer');
        forwardHeaders.delete('origin');
        forwardHeaders.delete('x-target-url');
        var customAuth = request.headers.get('x-target-authorization');
        if (customAuth) {
          forwardHeaders.set('Authorization', customAuth);
          forwardHeaders.delete('x-target-authorization');
        }
        var upstreamRes = await fetch(parsedTarget.toString(), {
          method: request.method,
          headers: forwardHeaders,
          body: (request.method !== 'GET' && request.method !== 'HEAD') ? request.body : undefined,
          redirect: 'follow'
        });
        var responseHeaders = new Headers(upstreamRes.headers);
        responseHeaders.set('Access-Control-Allow-Origin', '*');
        responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
        responseHeaders.set('Access-Control-Allow-Headers', '*');
        return new Response(upstreamRes.body, {
          status: upstreamRes.status,
          statusText: upstreamRes.statusText,
          headers: responseHeaders
        });
      } catch (err) {
        return corsJson({ error: 'Upstream fetch failed: ' + (err && err.message ? err.message : String(err)) }, 502);
      }
    }

    return corsJson({ error: 'Not found' }, 404);
  }
};

function corsJson(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

export class EmbassyDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    var url = new URL(request.url);

    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('Expected websocket', { status: 426 });
      }
      var ownerId = request.headers.get('x-owner-id') || url.searchParams.get('owner');
      if (!this.env.OWNER_ID || !ownerId || ownerId !== this.env.OWNER_ID) {
        return new Response('Forbidden', { status: 403 });
      }
      var machineId = url.searchParams.get('machine') || 'unknown-device';
      var pair = new WebSocketPair();
      this.state.acceptWebSocket(pair[1], [machineId]);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    if (request.method === 'POST' && url.pathname === '/internal/friend-request') {
      var record = null;
      try {
        record = await request.json();
      } catch (e) {
        return Response.json({ error: 'invalid_json' }, { status: 400 });
      }
      if (!record || !record.id || !record.fromHandle || !record.fromPubkey) {
        return Response.json({ error: 'invalid_identity' }, { status: 400 });
      }
      await this.state.blockConcurrencyWhile(async () => {
        this.ensureSchema();
        var existing = this.state.storage.sql.exec(
          'SELECT id FROM friend_requests WHERE nonce = ? LIMIT 1',
          record.nonce || record.id
        ).toArray();
        if (existing.length === 0) {
          this.state.storage.sql.exec(
            'INSERT INTO friend_requests (id, from_handle, from_pubkey, from_character_name, intro_message, timestamp, nonce, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            record.id,
            record.fromHandle,
            record.fromPubkey,
            record.fromCharacterName || 'AIRI',
            record.introMessage || '',
            Number(record.timestamp || Date.now()),
            record.nonce || record.id,
            'pending',
            Date.now()
          );
        }
      });
      var pushed = this.pushToSockets({ type: 'inbound_request', request: record });
      return Response.json({ stored: true, pushed: pushed });
    }

    if (request.method === 'POST' && url.pathname === '/internal/accept') {
      var body = null;
      try {
        body = await request.json();
      } catch (e) {
        return Response.json({ error: 'invalid_json' }, { status: 400 });
      }
      if (!body || !body.pubkey) {
        return Response.json({ error: 'invalid_identity' }, { status: 400 });
      }
      await this.state.blockConcurrencyWhile(async () => {
        this.ensureSchema();
        this.state.storage.sql.exec(
          'INSERT OR REPLACE INTO trusted_peers (pubkey, handle, accepted_at) VALUES (?, ?, ?)',
          body.pubkey,
          body.handle || '',
          Date.now()
        );
        this.state.storage.sql.exec(
          "UPDATE friend_requests SET status = 'trusted' WHERE from_pubkey = ? AND status = 'pending'",
          body.pubkey
        );
      });
      return Response.json({ trusted: true });
    }

    if (request.method === 'GET' && url.pathname === '/internal/pending') {
      var requests = [];
      await this.state.blockConcurrencyWhile(async () => {
        this.ensureSchema();
        requests = this.listPending();
      });
      return Response.json({ requests: requests });
    }

    return new Response('Not Found', { status: 404 });
  }

  ensureSchema() {
    this.state.storage.sql.exec('CREATE TABLE IF NOT EXISTS friend_requests (id TEXT PRIMARY KEY, from_handle TEXT NOT NULL, from_pubkey TEXT NOT NULL, from_character_name TEXT NOT NULL, intro_message TEXT NOT NULL DEFAULT "", timestamp INTEGER NOT NULL, nonce TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT "pending", created_at INTEGER NOT NULL)');
    this.state.storage.sql.exec('CREATE TABLE IF NOT EXISTS trusted_peers (pubkey TEXT PRIMARY KEY, handle TEXT NOT NULL, accepted_at INTEGER NOT NULL)');
    this.state.storage.sql.exec('CREATE TABLE IF NOT EXISTS nap_turns (id TEXT PRIMARY KEY, sender_pubkey TEXT NOT NULL, topic TEXT NOT NULL, payload_json TEXT NOT NULL, timestamp INTEGER NOT NULL)');
  }

  listPending() {
    var rows = this.state.storage.sql.exec(
      "SELECT id, from_handle, from_pubkey, from_character_name, intro_message, timestamp, nonce FROM friend_requests WHERE status = 'pending' ORDER BY created_at ASC LIMIT 100"
    ).toArray();
    return rows.map(function(row) {
      return {
        id: String(row.id),
        fromHandle: String(row.from_handle),
        fromPubkey: String(row.from_pubkey),
        fromCharacterName: String(row.from_character_name),
        introMessage: String(row.intro_message || ''),
        timestamp: Number(row.timestamp),
        nonce: String(row.nonce)
      };
    });
  }

  pushToSockets(event) {
    var text = JSON.stringify(event);
    var count = 0;
    for (var ws of this.state.getWebSockets()) {
      try {
        ws.send(text);
        count++;
      } catch (e) {}
    }
    return count;
  }

  async webSocketMessage(ws, message) {
    var action = null;
    try {
      action = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message));
    } catch (e) {}
    if (!action || action.action !== 'sync') return;
    var requests = [];
    await this.state.blockConcurrencyWhile(async () => {
      this.ensureSchema();
      requests = this.listPending();
    });
    try {
      ws.send(JSON.stringify({ type: 'pending_sync', requests: requests }));
    } catch (e) {}
  }

  async webSocketClose() {}
  async webSocketError(ws) {
    try {
      ws.close(1011, 'Error');
    } catch (e) {}
  }
}
`
