import type { Env, GatewayStatus, LoggedMessage } from './types'

import { DiscordHostDO } from './discord-host-do'

export { DiscordHostDO }

const SINGLETON_DO_NAME = 'default-discord-host'

function getHostStub(env: Env): DurableObjectStub {
  const id = env.DISCORD_HOST.idFromName(SINGLETON_DO_NAME)
  return env.DISCORD_HOST.get(id)
}

function renderHtmlDashboard(status: GatewayStatus, messages: LoggedMessage[]): string {
  const isConnected = status.status === 'connected'
  const badgeColor = isConnected ? '#10b981' : (status.status === 'connecting' || status.status === 'reconnecting') ? '#f59e0b' : '#ef4444'

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AIRI • Discord Durable Object Host</title>
  <style>
    :root {
      --bg: #090a0f;
      --card-bg: #13151f;
      --card-border: #232738;
      --text: #e2e8f0;
      --text-muted: #94a3b8;
      --accent: #6366f1;
      --accent-hover: #4f46e5;
    }
    body {
      margin: 0;
      padding: 24px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      display: flex;
      justify-content: center;
    }
    .container {
      width: 100%;
      max-width: 800px;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--card-border);
    }
    .header h1 {
      margin: 0;
      font-size: 20px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 9999px;
      font-size: 13px;
      font-weight: 500;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid var(--card-border);
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: ${badgeColor};
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 16px;
    }
    .card-label {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      margin-bottom: 6px;
    }
    .card-val {
      font-size: 18px;
      font-weight: 600;
      word-break: break-all;
    }
    .actions {
      display: flex;
      gap: 12px;
      margin-bottom: 24px;
    }
    button {
      background: var(--accent);
      color: white;
      border: none;
      padding: 10px 18px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s ease;
    }
    button:hover {
      background: var(--accent-hover);
    }
    button.secondary {
      background: rgba(255, 255, 255, 0.08);
      color: var(--text);
    }
    button.secondary:hover {
      background: rgba(255, 255, 255, 0.14);
    }
    .instructions {
      background: rgba(99, 102, 241, 0.08);
      border: 1px solid rgba(99, 102, 241, 0.3);
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 24px;
    }
    .instructions h2 {
      margin: 0 0 8px 0;
      font-size: 15px;
      font-weight: 600;
    }
    .instructions p {
      margin: 0;
      font-size: 14px;
      color: var(--text-muted);
      line-height: 1.5;
    }
    .log-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    .log-table th {
      text-align: left;
      padding: 8px 12px;
      color: var(--text-muted);
      border-bottom: 1px solid var(--card-border);
    }
    .log-table td {
      padding: 10px 12px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    }
    .error-banner {
      background: rgba(239, 68, 68, 0.15);
      border: 1px solid rgba(239, 68, 68, 0.4);
      color: #fca5a5;
      padding: 12px 16px;
      border-radius: 8px;
      margin-bottom: 20px;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>AIRI • Discord Durable Object Host</h1>
      <div class="badge">
        <span class="dot"></span>
        <span>${status.status.toUpperCase()}</span>
      </div>
    </div>

    ${status.lastErrorMessage ? `<div class="error-banner">⚠️ <strong>Error:</strong> ${status.lastErrorMessage}</div>` : ''}

    <div class="instructions">
      <h2>🧪 How to verify in Discord</h2>
      <p>
        Make sure your bot is in your Discord server. Go into any text channel and type <code>/test</code> or <code>!test</code>.
        The Durable Object receives the Gateway WebSocket event, increments its SQLite turn state, and replies instantly into your channel!
      </p>
    </div>

    <div class="actions">
      <form action="/connect" method="POST" style="margin:0"><button type="submit">Connect to Gateway</button></form>
      <form action="/disconnect" method="POST" style="margin:0"><button type="submit" class="secondary">Disconnect</button></form>
      <button class="secondary" onclick="window.location.reload()">Refresh State</button>
    </div>

    <div class="grid">
      <div class="card">
        <div class="card-label">Bot Identity</div>
        <div class="card-val">${status.botUser ? `${status.botUser.username} (${status.botUser.tag})` : 'Not connected'}</div>
      </div>
      <div class="card">
        <div class="card-label">Verified Turns Handled</div>
        <div class="card-val" style="color:#6366f1;">#${status.turnCount}</div>
      </div>
      <div class="card">
        <div class="card-label">Event Sequence (s)</div>
        <div class="card-val">${status.lastSeq ?? 0}</div>
      </div>
      <div class="card">
        <div class="card-label">Uptime</div>
        <div class="card-val">${Math.floor(status.uptimeMs / 1000)}s</div>
      </div>
    </div>

    <div class="card">
      <div class="card-label" style="margin-bottom:12px;">Recent Messages Observed by Durable Object (${messages.length})</div>
      ${messages.length === 0
        ? '<p style="color:var(--text-muted);font-size:14px;margin:0;">No messages seen yet. Send <code>/test</code> or <code>!test</code> in Discord!</p>'
        : `
        <table class="log-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Author</th>
              <th>Content</th>
              <th>Verification Replied</th>
            </tr>
          </thead>
          <tbody>
            ${messages.map(m => `
              <tr>
                <td>${new Date(m.createdAt).toLocaleTimeString()}</td>
                <td><strong>${m.authorName}</strong></td>
                <td><code>${m.content}</code></td>
                <td>${m.replySent ? '✅ Replied' : '—'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `}
    </div>
  </div>
</body>
</html>`
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const stub = getHostStub(env)

    // Auto-connect on incoming requests if configured and currently disconnected
    if (env.AUTO_CONNECT === 'true') {
      const statusRes = await stub.fetch('http://internal/status')
      const currentStatus = (await statusRes.json()) as GatewayStatus
      if (currentStatus.status === 'disconnected') {
        stub.fetch('http://internal/connect', { method: 'POST' }).catch(() => {})
      }
    }

    // JSON API Endpoints
    if (url.pathname === '/status') {
      return stub.fetch('http://internal/status')
    }

    if (url.pathname === '/connect' && request.method === 'POST') {
      const res = await stub.fetch('http://internal/connect', { method: 'POST' })
      if (request.headers.get('Accept')?.includes('text/html')) {
        return Response.redirect(url.origin, 303)
      }
      return res
    }

    if (url.pathname === '/disconnect' && request.method === 'POST') {
      const res = await stub.fetch('http://internal/disconnect', { method: 'POST' })
      if (request.headers.get('Accept')?.includes('text/html')) {
        return Response.redirect(url.origin, 303)
      }
      return res
    }

    if (url.pathname === '/events' || url.pathname === '/messages') {
      return stub.fetch(`http://internal/messages${url.search}`)
    }

    // Default HTML dashboard
    if (url.pathname === '/' || url.pathname === '') {
      if (request.headers.get('Accept')?.includes('application/json')) {
        return stub.fetch('http://internal/status')
      }

      const statusRes = await stub.fetch('http://internal/status')
      const status = (await statusRes.json()) as GatewayStatus

      const messagesRes = await stub.fetch('http://internal/messages?limit=15')
      const messages = (await messagesRes.json()) as LoggedMessage[]

      return new Response(renderHtmlDashboard(status, messages), {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
        },
      })
    }

    return new Response('Not Found', { status: 404 })
  },
}
