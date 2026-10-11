export interface WidgetIframeOptions {
  path: string
  code: string
  title?: string
}

export async function buildWidgetIframeSrcdoc(
  widget: WidgetIframeOptions,
  readFileFn?: (path: string) => Promise<string>,
): Promise<string> {
  let sessionData: any = {}
  let telemetryData: any = {}
  let cognitionData: any = {}

  if (readFileFn) {
    try {
      const rawSession = await readFileFn('/workspace/.airi/session.json')
      sessionData = JSON.parse(rawSession)
    }
    catch {}

    try {
      const rawTelemetry = await readFileFn('/workspace/.airi/telemetry.json')
      telemetryData = JSON.parse(rawTelemetry)
    }
    catch {}

    try {
      const rawCognition = await readFileFn('/workspace/.airi/cognition.json')
      cognitionData = JSON.parse(rawCognition)
    }
    catch {}
  }

  // High-resilience normalization for Telemetry
  const cpu1m = Array.isArray(telemetryData.cpuLoad) ? telemetryData.cpuLoad[0] : (telemetryData.cpuLoad?.['1m'] ?? 0)
  const cpu5m = Array.isArray(telemetryData.cpuLoad) ? telemetryData.cpuLoad[1] : (telemetryData.cpuLoad?.['5m'] ?? 0)
  const cpu15m = Array.isArray(telemetryData.cpuLoad) ? telemetryData.cpuLoad[2] : (telemetryData.cpuLoad?.['15m'] ?? 0)

  const normalizedCpuLoad = Object.assign([cpu1m, cpu5m, cpu15m], {
    '1m': cpu1m,
    '5m': cpu5m,
    '15m': cpu15m,
  })

  const normalizedTelemetry = {
    ...telemetryData,
    idleSeconds: telemetryData.idleTimeSec ?? telemetryData.idleSeconds ?? 0,
    idleTimeSec: telemetryData.idleTimeSec ?? telemetryData.idleSeconds ?? 0,
    activeApp: telemetryData.activeProgram || telemetryData.activeWindowTitle || 'AIRI',
    activeProgram: telemetryData.activeProgram || telemetryData.activeWindowTitle || 'AIRI',
    activeWindowTitle: telemetryData.activeWindowTitle || telemetryData.activeProgram || 'AIRI',
    isAfk: (telemetryData.idleTimeSec ?? 0) > 60,
    cpuLoad: normalizedCpuLoad,
  }

  // High-resilience normalization for Cognition
  const normalizedCognition = {
    ...cognitionData,
    emotion: cognitionData.emotion || 'focused',
    valence: cognitionData.valence ?? 0.8,
    energy: cognitionData.energy ?? 0.85,
    somaticState: cognitionData.somaticState || 'engaged',
    characterName: cognitionData.character?.name || sessionData.characterName || 'AIRI',
    provider: cognitionData.consciousness?.activeProvider || 'local',
    model: cognitionData.consciousness?.activeModel || 'default',
  }

  // High-resilience normalization for Session
  const normalizedSession = {
    ...sessionData,
    id: sessionData.activeSessionId || sessionData.id || 'default',
    activeSessionId: sessionData.activeSessionId || sessionData.id || 'default',
    activeCardName: sessionData.characterName || sessionData.activeCardName || 'AIRI',
    messageCount: sessionData.messageCount ?? 0,
    lastUserMessageAt: sessionData.lastMessageAt || sessionData.lastUserMessageAt || new Date().toISOString(),
    hoursSinceLastMessage: sessionData.hoursSinceLastMessage ?? 0,
  }

  const sidecar = {
    session: normalizedSession,
    telemetry: normalizedTelemetry,
    cognition: normalizedCognition,
  }

  if (widget.path.endsWith('.html')) {
    return `<!DOCTYPE html>
<html class="dark" style="background: transparent !important; color-scheme: dark;">
<head>
  <meta charset="UTF-8">
  <${'script'} src="https://cdn.tailwindcss.com"></${'script'}>
  <style>
    * { box-sizing: border-box; }
    html, body {
      background: transparent !important;
      color: #f8fafc;
      font-family: ui-sans-serif, system-ui, sans-serif;
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      overflow-x: hidden;
    }
  </style>
</head>
<body class="antialiased">
  <div id="root" class="w-full min-h-full">${widget.code}</div>
  <${'script'}>
    function reportH() {
      const h = document.getElementById('root')?.scrollHeight || document.body.scrollHeight;
      window.parent.postMessage({ type: 'widget-resize', height: h }, '*');
    }
    window.addEventListener('load', reportH);
    if (window.ResizeObserver) new ResizeObserver(reportH).observe(document.body);
  </${'script'}>
</body>
</html>`
  }

  // ES Module (.js / .ts output)
  return `<!DOCTYPE html>
<html class="dark" style="background: transparent !important; color-scheme: dark;">
<head>
  <meta charset="UTF-8">
  <${'script'} src="https://cdn.tailwindcss.com"></${'script'}>
  <style>
    * { box-sizing: border-box; }
    html, body {
      background: transparent !important;
      color: #f8fafc;
      font-family: ui-sans-serif, system-ui, sans-serif;
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      overflow-x: hidden;
    }
    #root {
      width: 100%;
      min-height: 100%;
      display: block;
    }
  </style>
</head>
<body class="antialiased">
  <div id="root" class="w-full min-h-full"></div>
  <${'script'} type="module">
    const sidecarData = ${JSON.stringify(sidecar)};
    const root = document.getElementById('root');

    function reportH() {
      const h = root.scrollHeight || document.body.scrollHeight;
      window.parent.postMessage({ type: 'widget-resize', height: h }, '*');
    }
    window.addEventListener('load', reportH);
    if (window.ResizeObserver) new ResizeObserver(reportH).observe(document.body);

    const baseContext = {
      container: root,
      sidecar: sidecarData,
      data: sidecarData,
      onUpdate: (cb) => {
        window.addEventListener('message', (e) => {
          if (e.data && e.data.type === 'sidecar-update') cb(e.data.sidecar);
        });
        return () => {};
      },
      callMcpTool: (name, args) => {
        return new Promise((resolve, reject) => {
          const reqId = 'mcp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
          function onMsg(e) {
            if (e.data && e.data.type === 'mcp-call-result' && e.data.id === reqId) {
              window.removeEventListener('message', onMsg);
              if (e.data.error) reject(new Error(e.data.error));
              else resolve(e.data.result);
            }
          }
          window.addEventListener('message', onMsg);
          window.parent.postMessage({ type: 'mcp-call', id: reqId, name, args }, '*');
        });
      }
    };

    // Proxy so context acts seamlessly as both AiriWidgetContext and HTMLElement container
    const context = new Proxy(baseContext, {
      get(target, prop, receiver) {
        if (prop in target) {
          return Reflect.get(target, prop, receiver);
        }
        if (prop === 'querySelector') {
          return (selector) => {
            let el = root.querySelector(selector);
            if (!el && typeof selector === 'string' && !selector.startsWith('#') && !selector.startsWith('.') && !selector.includes('[') && !selector.includes(':') && !selector.includes(' ') && !selector.includes('>')) {
              el = root.querySelector('#' + selector);
            }
            return el;
          };
        }
        if (prop === 'getElementById') {
          return (id) => root.querySelector('#' + id);
        }
        const val = Reflect.get(root, prop);
        if (typeof val === 'function') {
          return val.bind(root);
        }
        return val;
      },
      set(target, prop, value, receiver) {
        if (prop in target) {
          return Reflect.set(target, prop, value, receiver);
        }
        const res = Reflect.set(root, prop, value);
        if (prop === 'innerHTML' || prop === 'style') {
          setTimeout(reportH, 50);
        }
        return res;
      }
    });

    try {
      const code = ${JSON.stringify(widget.code)};
      const blob = new Blob([code], { type: 'application/javascript' });
      const blobUrl = URL.createObjectURL(blob);
      const mod = await import(blobUrl);
      URL.revokeObjectURL(blobUrl);

      // Resolve mount/init/render function across all standard ESM and object export patterns
      let mountFn = null;
      let renderFn = null;

      if (typeof mod.default === 'function') {
        mountFn = mod.default;
      } else if (mod.default && typeof mod.default === 'object') {
        if (typeof mod.default.init === 'function') mountFn = mod.default.init;
        else if (typeof mod.default.mount === 'function') mountFn = mod.default.mount;
        else if (typeof mod.default.render === 'function') renderFn = mod.default.render;
        else if (typeof mod.default.default === 'function') mountFn = mod.default.default;
      }

      if (!mountFn && !renderFn) {
        if (typeof mod.mount === 'function') mountFn = mod.mount;
        else if (typeof mod.init === 'function') mountFn = mod.init;
        else if (typeof mod.render === 'function') renderFn = mod.render;
      }

      if (mountFn) {
        const res = mountFn(context, context.sidecar);
        if (typeof res === 'string') root.innerHTML = res;
      } else if (renderFn) {
        const res = renderFn(context, context.sidecar);
        if (typeof res === 'string') root.innerHTML = res;
      } else {
        throw new Error('No valid entrypoint found in widget module. Expected default function, { init }, { mount }, or render() export.');
      }
      setTimeout(reportH, 100);
    } catch (err) {
      console.error('[GenerativeWidget] Execution Error:', err);
      root.innerHTML = \`
        <div class="rounded-xl border border-rose-800/80 bg-rose-950/70 p-3 text-rose-200 w-full text-xs space-y-1 shadow-lg">
          <div class="font-bold flex items-center gap-1.5 text-rose-300">
            <span>⚠️ Widget Execution Error</span>
          </div>
          <pre class="mt-1 text-[11px] font-mono whitespace-pre-wrap text-rose-300 overflow-x-auto">\${err.stack || err.message}</pre>
        </div>
      \`;
      setTimeout(reportH, 50);
    }
  </${'script'}>
</body>
</html>`
}
