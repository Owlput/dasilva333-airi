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
      if (env && env.MEMORY) {
        try {
          var body = await request.clone().json();
          await env.MEMORY.put('friends/requests/inbound/' + reqId, JSON.stringify({
            id: reqId,
            fromHandle: body.fromHandle || '',
            fromPubkey: body.fromPubkey || '',
            fromCharacterName: body.fromCharacterName || '',
            introMessage: body.introMessage || '',
            timestamp: body.timestamp || Date.now(),
            status: 'pending'
          }));
        } catch (e) {}
      }
      return corsJson({ ok: true, id: reqId, status: 'pending' }, 200);
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
`
