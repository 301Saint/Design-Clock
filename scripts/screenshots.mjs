// Regenerates the README images in docs/images using headless Microsoft Edge.
// Runs a throwaway copy of the app (temporary database seeded with sample jobs),
// so your real data is never touched.  Usage: npm run build && npm run screenshots
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, 'docs', 'images');
const PORT = 5199;
const CDP_PORT = 9333;
const BASE = `http://127.0.0.1:${PORT}`;
const W = 1440, H = 900, DPR = 2;

const EDGE = [
  `${process.env['ProgramFiles(x86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
  `${process.env.ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
].find((p) => existsSync(p));
if (!EDGE) throw new Error('Microsoft Edge not found');
if (!existsSync(join(ROOT, 'dist', 'index.html'))) throw new Error('Run "npm run build" first');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = mkdtempSync(join(tmpdir(), 'design-clock-shots-'));
mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- processes
const server = spawn(process.execPath, ['server/index.ts'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), DESIGN_CLOCK_DATA: join(tmp, 'data'), DESIGN_CLOCK_SEED: '1' },
  stdio: 'ignore',
});
const edge = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${join(tmp, 'edge')}`,
  '--no-first-run', '--hide-scrollbars', '--force-color-profile=srgb', `--window-size=${W},${H}`, 'about:blank',
], { stdio: 'ignore' });

async function waitFor(fn, what, timeout = 15000) {
  const t0 = Date.now();
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch { /* retry */ }
    if (Date.now() - t0 > timeout) throw new Error(`Timed out waiting for ${what}`);
    await sleep(200);
  }
}

const api = async (method, path, body) => {
  const r = await fetch(`${BASE}/api${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  return r.json();
};

// ---------------------------------------------------------------- CDP
let ws, seq = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''));
  return r.result.value;
}
const exists = (sel) => evaluate(`!!document.querySelector(${JSON.stringify(sel)})`);
const waitSel = (sel) => waitFor(() => exists(sel), sel);
async function settle(ms = 700) { await evaluate('document.fonts.ready.then(() => true)'); await sleep(ms); }
async function viewport(width, height, dpr = DPR) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile: false });
}
async function shot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, name), Buffer.from(data, 'base64'));
  console.log('  ✓', name);
}
async function open(url) {
  await send('Page.navigate', { url });
  await waitFor(() => evaluate('document.readyState === "complete"'), `load ${url}`);
}
async function route(hash, sel) {
  await evaluate(`location.hash = ${JSON.stringify(hash)}; true`);
  if (sel) await waitSel(sel);
  await settle();
}
async function reload(sel = '.timerbar') {
  await send('Page.reload');
  await sleep(300);
  await waitSel(sel);
  await settle();
}
// Set a React-controlled input's value
const typeInto = (sel, value) => evaluate(`(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
const click = (sel) => evaluate(`(document.querySelector(${JSON.stringify(sel)}).click(), true)`);
const key = (k, extra = {}) => evaluate(`(window.dispatchEvent(new KeyboardEvent('keydown', ${JSON.stringify({ key: k, bubbles: true, ...extra })})), true)`);

// ---------------------------------------------------------------- run
try {
  await waitFor(() => fetch(`${BASE}/api/health`).then((r) => r.ok), 'app server');
  const targets = await waitFor(() => fetch(`http://127.0.0.1:${CDP_PORT}/json/list`).then((r) => r.json()), 'Edge');
  const page = targets.find((t) => t.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  ws.onmessage = (e) => { const m = JSON.parse(e.data); pending.get(m.id)?.(m); pending.delete(m.id); };
  await new Promise((r) => (ws.onopen = r));
  await send('Page.enable');
  await send('Runtime.enable');
  await viewport(W, H);

  const jobs = await api('GET', '/jobs');
  const job = (n) => jobs.find((j) => j.job_number === n).id;
  const startAgo = async (jobNumber, sec) => {
    const r = await api('POST', '/timer/start', { job_id: job(jobNumber), force: true });
    await api('PATCH', `/sessions/${r.running.id}`, { start_at: Date.now() - sec * 1000 });
    if (r.stopped) await api('DELETE', `/sessions/${r.stopped.id}`);
  };
  await api('PUT', '/settings', { rounding: 'nearest15', theme: 'dark' });

  console.log('Capturing screens…');
  // 1. Label prompt right after STOP
  await startAgo('2928', 37 * 60 + 12);
  await open(`${BASE}/#/dashboard`);
  await waitSel('.big-btn.stop');
  await settle();
  await click('.big-btn.stop');
  await waitSel('.cat-grid');
  await settle(900);
  await typeInto('.modal-body input.input', 'Adjusted van side layout for sliding door seam');
  await settle(300);
  await shot('label-prompt.png');
  await click('.modal-foot .btn.primary');
  await sleep(600);

  // 2. Dashboard with a live timer
  await startAgo('2847', 42 * 60 + 17);
  await reload();
  await shot('dashboard.png');

  // 3. Search palette
  await key('k', { ctrlKey: true });
  await waitSel('.palette-input input');
  await typeInto('.palette-input input', '29');
  await settle(400);
  await shot('search.png');
  await reload();

  // 4. Switch confirmation
  await evaluate(`[...document.querySelectorAll('.recent-job')].find(r => r.textContent.includes('#2911')).querySelector('.start-pill').click(), true`);
  await waitSel('.modal');
  await settle(400);
  await shot('switch-job.png');
  await reload();

  // 5. Job detail
  await route(`#/jobs/${job('2847')}`, '.breakdown-row');
  await shot('job-detail.png');

  // 6. New job
  await key('n');
  await waitSel('#jf-num');
  await typeInto('#jf-num', '2952');
  await typeInto('#jf-client', 'Harbor View Marina');
  await typeInto('#jf-project', 'Dock Wayfinding Refresh');
  await settle(300);
  await shot('new-job.png');
  await reload();

  // 7. Manual entry
  await key('m');
  await waitSel('#sm-job');
  await settle(300);
  await shot('manual-entry.png');
  await reload();

  // 8. Reports, Analytics, Settings, Jobs
  await route('#/reports', '.table tbody tr');
  await shot('reports.png');
  await route('#/analytics', '.table tbody tr');
  await shot('analytics.png');
  await route('#/jobs', '.table tbody tr');
  await shot('jobs.png');
  await route('#/settings', '.switch');
  await shot('settings.png');

  // 9. Light theme
  await api('PUT', '/settings', { theme: 'light' });
  await route('#/dashboard');
  await reload();
  await shot('dashboard-light.png');

  // 10. Banner + framed hero (rendered from HTML)
  console.log('Rendering banner & hero…');
  const icon = pathToFileURL(join(ROOT, 'assets', 'design-clock-256.png')).href;
  const font = pathToFileURL(join(ROOT, 'node_modules', '@fontsource-variable', 'inter', 'files', 'inter-latin-wght-normal.woff2')).href;
  const css = `@font-face{font-family:Inter;src:url('${font}') format('woff2');font-weight:100 900}
    *{box-sizing:border-box;margin:0}body{font-family:Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased}`;

  writeFileSync(join(tmp, 'banner.html'), `<!doctype html><html><head><style>${css}
    body{width:1280px;height:400px;background:#0c0c0f;color:#ececf1;display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative}
    .grid{position:absolute;inset:0;background-image:linear-gradient(#ffffff08 1px,transparent 1px),linear-gradient(90deg,#ffffff08 1px,transparent 1px);background-size:40px 40px;mask-image:radial-gradient(ellipse at center,#000 30%,transparent 75%)}
    .glow{position:absolute;width:720px;height:420px;left:50%;top:50%;transform:translate(-50%,-50%);background:radial-gradient(closest-side,rgba(255,122,69,.28),transparent);filter:blur(10px)}
    .wrap{position:relative;display:flex;align-items:center;gap:36px}
    img{width:148px;height:148px;filter:drop-shadow(0 18px 40px rgba(255,122,69,.35))}
    h1{font-size:76px;font-weight:750;letter-spacing:-.035em;line-height:1}
    h1 span{background:linear-gradient(90deg,#ff9466,#ff6a33);-webkit-background-clip:text;color:transparent}
    p{margin-top:14px;font-size:23px;color:#a3a3b0;letter-spacing:-.01em}
    .pills{display:flex;gap:10px;margin-top:22px}
    .pill{font-size:14px;font-weight:600;color:#d9d9e0;padding:7px 14px;border-radius:99px;background:#ffffff0d;border:1px solid #ffffff14}
    </style></head><body><div class="grid"></div><div class="glow"></div>
    <div class="wrap"><img src="${icon}"><div><h1>Design <span>Clock</span></h1>
    <p>One-click design time tracking for sign &amp; graphics shops.</p>
    <div class="pills"><span class="pill">⏱ One-click timers</span><span class="pill">💵 Design-fee math</span><span class="pill">🔒 100% local · SQLite</span></div></div></div>
    </body></html>`);
  await viewport(1280, 400);
  await open(pathToFileURL(join(tmp, 'banner.html')).href);
  await settle(500);
  await shot('banner.png');

  const dash = pathToFileURL(join(OUT, 'dashboard.png')).href;
  writeFileSync(join(tmp, 'hero.html'), `<!doctype html><html><head><style>${css}
    body{width:1600px;height:1080px;display:flex;align-items:center;justify-content:center;
      background:radial-gradient(1200px 700px at 20% 0%,#ff7a4533,transparent 60%),radial-gradient(900px 600px at 100% 100%,#6aa7ff22,transparent 60%),#0b0b0e}
    .win{width:1440px;border-radius:14px;overflow:hidden;background:#18181d;box-shadow:0 40px 120px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.08)}
    .bar{height:36px;display:flex;align-items:center;padding:0 14px;gap:10px;background:#141418;border-bottom:1px solid #2a2a32;color:#a3a3b0;font-size:13px;font-weight:550}
    .bar{padding-right:0}.bar img{width:18px;height:18px}.bar .sp{flex:1}.bar svg{width:46px;height:36px;padding:12px 17px;stroke:#8d8d9a;stroke-width:1.2;fill:none}
    .shot{display:block;width:1440px;height:900px}
    </style></head><body><div class="win"><div class="bar"><img src="${icon}">Design Clock<span class="sp"></span><svg viewBox="0 0 12 12"><path d="M1 6h10"/></svg><svg viewBox="0 0 12 12"><rect x="1.5" y="1.5" width="9" height="9" rx="1.5"/></svg><svg viewBox="0 0 12 12"><path d="M1.5 1.5l9 9M10.5 1.5l-9 9"/></svg></div>
    <img class="shot" src="${dash}"></div></body></html>`);
  await viewport(1600, 1080, 1.5);
  await open(pathToFileURL(join(tmp, 'hero.html')).href);
  await settle(500);
  await shot('hero.png');

  console.log(`Done → ${OUT}`);
} finally {
  try { ws?.close(); } catch { /* ignore */ }
  // Ask Edge to quit, then make sure nothing using our temporary profile is left behind.
  try {
    const { webSocketDebuggerUrl } = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`).then((r) => r.json());
    const b = new WebSocket(webSocketDebuggerUrl);
    await new Promise((r) => { b.onopen = r; setTimeout(r, 1000); });
    b.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
  } catch { /* already gone */ }
  server.kill();
  await sleep(1000);
  try {
    execFileSync('powershell', ['-NoProfile', '-Command',
      `Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -like '*${basename(tmp)}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
    ], { stdio: 'ignore', windowsHide: true });
  } catch { /* ignore */ }
  await sleep(1500);
  // Edge can hold its profile folder briefly after exit; leftovers in %TEMP% are harmless.
  try { rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }); } catch { /* ignore */ }
}
