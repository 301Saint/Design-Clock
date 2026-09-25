import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { openDb, DB_PATH, DEFAULT_SETTINGS } from './db.ts';
import { seed } from './seed.ts';
import { IdleMonitor } from './idle.ts';

const here = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(here, '..', 'dist');
const PORT = Number(process.env.PORT ?? 5178);
const HOST = '127.0.0.1'; // never listen on the network
const OPEN = process.argv.includes('--open');

const { db, created } = openDb();
// Sample jobs only for development (npm run dev); real installs start empty.
if (created && process.env.DESIGN_CLOCK_SEED === '1') {
  const ids = seed(db);
  console.log(`New database created at ${DB_PATH} (seeded ${ids.length} sample jobs)`);
}

// ---------------------------------------------------------------- helpers
class HttpError extends Error {
  status: number;
  body?: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

type Row = Record<string, unknown>;
type Handler = (ctx: { params: string[]; body: Row; query: URLSearchParams; res: ServerResponse }) => unknown;

function tx<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function str(v: unknown, field: string, required = true): string {
  const s = typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
  if (required && !s) throw new HttpError(400, `${field} is required`);
  return s;
}

function num(v: unknown, field: string): number {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new HttpError(400, `${field} must be a number`);
  return n;
}

// ---------------------------------------------------------------- settings
function getSettings(): Row {
  const out: Row = { ...DEFAULT_SETTINGS };
  for (const r of db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]) {
    try { out[r.key] = JSON.parse(r.value); } catch { /* ignore corrupt value */ }
  }
  return out;
}

// ---------------------------------------------------------------- idle
const idle = new IdleMonitor();
function syncIdle() {
  const s = getSettings();
  idle.thresholdSec = Math.max(1, Number(s.idleThresholdMin) || 10) * 60;
  if (s.idleDetection) idle.start(); else idle.stop();
}
syncIdle();

// ---------------------------------------------------------------- queries
const SESSION_SELECT = `
  SELECT s.id, s.job_id, s.category_id, s.start_at, s.end_at, s.idle_sec, s.duration_sec,
         s.notes, s.source, s.created_at, s.updated_at,
         j.job_number, j.project_name, j.status AS job_status,
         c.id AS client_id, c.name AS client, cat.name AS category
  FROM sessions s
  JOIN jobs j ON j.id = s.job_id
  JOIN clients c ON c.id = j.client_id
  LEFT JOIN categories cat ON cat.id = s.category_id`;

const JOB_SELECT = `
  SELECT j.id, j.job_number, j.project_name, j.notes, j.status, j.created_at, j.updated_at,
         c.id AS client_id, c.name AS client,
         COALESCE(SUM(s.duration_sec), 0) AS total_sec,
         COUNT(s.id) AS session_count,
         MAX(COALESCE(s.end_at, s.start_at)) AS last_worked_at
  FROM jobs j
  JOIN clients c ON c.id = j.client_id
  LEFT JOIN sessions s ON s.job_id = j.id`;

const getSession = (id: number | bigint) =>
  db.prepare(`${SESSION_SELECT} WHERE s.id = ?`).get(id) as Row | undefined;
const getRunning = () =>
  db.prepare(`${SESSION_SELECT} WHERE s.end_at IS NULL AND s.user_id = 1`).get() as Row | undefined ?? null;
const getJob = (id: number | bigint) =>
  db.prepare(`${JOB_SELECT} WHERE j.id = ? GROUP BY j.id`).get(id) as Row | undefined;

function upsertClient(name: string): number {
  const row = db.prepare(`INSERT INTO clients (name, created_at) VALUES (?, ?)
    ON CONFLICT(name) DO UPDATE SET name = name RETURNING id`).get(name, Date.now()) as { id: number };
  return row.id;
}

function stopRunning(at = Date.now()): Row | null {
  const running = getRunning();
  if (!running) return null;
  const end = Math.max(at, running.start_at as number);
  db.prepare('UPDATE sessions SET end_at = ?, updated_at = ? WHERE id = ?').run(end, end, running.id as number);
  return getSession(running.id as number)!;
}

function idleFor(session: Row | null) {
  if (!session || !idle.episode) return null;
  const sec = idle.overlap(session.start_at as number, (session.end_at as number | null) ?? Date.now());
  return sec >= 60 ? { seconds: sec, startAt: idle.episode.startAt, endAt: idle.episode.endAt } : null;
}

function startTimer(jobId: number, force: boolean) {
  return tx(() => {
    const job = getJob(jobId);
    if (!job) throw new HttpError(404, 'Job not found');
    const running = getRunning();
    if (running && running.job_id === jobId) return { running, stopped: null, idle: null };
    if (running && !force) throw new HttpError(409, 'Another timer is running', { running });
    const now = Date.now();
    const stopped = stopRunning(now);
    const stoppedIdle = idleFor(stopped);
    idle.clear();
    const r = db.prepare(`INSERT INTO sessions (job_id, start_at, source, created_at, updated_at)
      VALUES (?, ?, 'timer', ?, ?)`).run(jobId, now, now, now);
    if (job.status !== 'active') {
      db.prepare(`UPDATE jobs SET status = 'active', updated_at = ? WHERE id = ?`).run(now, jobId);
    }
    return { running: getSession(r.lastInsertRowid), stopped, idle: stoppedIdle };
  });
}

// ---------------------------------------------------------------- routes
const routes: [method: string, pattern: RegExp, handler: Handler][] = [];
const route = (method: string, path: string, handler: Handler) =>
  routes.push([method, new RegExp('^' + path.replace(/:\w+/g, '(\\d+)') + '$'), handler]);

route('GET', '/api/health', () => ({ ok: true, app: 'design-clock' }));

route('GET', '/api/bootstrap', () => ({
  settings: getSettings(),
  categories: listCategories(),
  running: getRunning(),
  now: Date.now(),
}));

// settings
route('GET', '/api/settings', () => getSettings());
route('PUT', '/api/settings', ({ body }) => {
  const allowed = new Set([...Object.keys(DEFAULT_SETTINGS)]);
  const up = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  tx(() => {
    for (const [k, v] of Object.entries(body)) if (allowed.has(k)) up.run(k, JSON.stringify(v));
  });
  syncIdle();
  return getSettings();
});

// categories
const listCategories = () => db.prepare(`
  SELECT c.*, (SELECT COUNT(*) FROM sessions s WHERE s.category_id = c.id) AS session_count
  FROM categories c ORDER BY c.archived, c.sort_order, c.name`).all();
route('GET', '/api/categories', () => listCategories());
route('POST', '/api/categories', ({ body }) => {
  const name = str(body.name, 'Name');
  const max = (db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM categories').get() as { m: number }).m;
  const existing = db.prepare('SELECT * FROM categories WHERE name = ?').get(name) as Row | undefined;
  if (existing) {
    db.prepare('UPDATE categories SET archived = 0 WHERE id = ?').run(existing.id as number);
    return db.prepare('SELECT * FROM categories WHERE id = ?').get(existing.id as number);
  }
  const r = db.prepare('INSERT INTO categories (name, sort_order) VALUES (?, ?)').run(name, max + 1);
  return db.prepare('SELECT * FROM categories WHERE id = ?').get(r.lastInsertRowid);
});
route('PATCH', '/api/categories/:id', ({ params, body }) => {
  const id = Number(params[0]);
  if (body.name !== undefined) db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(str(body.name, 'Name'), id);
  if (body.archived !== undefined) db.prepare('UPDATE categories SET archived = ? WHERE id = ?').run(body.archived ? 1 : 0, id);
  if (body.sort_order !== undefined) db.prepare('UPDATE categories SET sort_order = ? WHERE id = ?').run(num(body.sort_order, 'sort_order'), id);
  return db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
});
// Deleting a category never deletes time: its sessions move to `reassign_to`, or become unlabeled.
route('DELETE', '/api/categories/:id', ({ params, query }) => {
  const id = Number(params[0]);
  const target = query.get('reassign_to') ? Number(query.get('reassign_to')) : null;
  if (target === id) throw new HttpError(400, 'Choose a different category to move sessions to');
  if (target !== null && !db.prepare('SELECT 1 FROM categories WHERE id = ?').get(target)) {
    throw new HttpError(400, 'Category to move sessions to was not found');
  }
  const moved = tx(() => {
    const r = db.prepare('UPDATE sessions SET category_id = ?, updated_at = ? WHERE category_id = ?').run(target, Date.now(), id);
    db.prepare('DELETE FROM categories WHERE id = ?').run(id);
    return Number(r.changes);
  });
  return { ok: true, moved };
});

// clients
route('GET', '/api/clients', () => db.prepare('SELECT id, name FROM clients ORDER BY name').all());

// jobs
route('GET', '/api/jobs', () => db.prepare(`${JOB_SELECT} GROUP BY j.id ORDER BY last_worked_at IS NULL, last_worked_at DESC, j.created_at DESC`).all());
route('GET', '/api/jobs/:id', ({ params }) => {
  const job = getJob(Number(params[0]));
  if (!job) throw new HttpError(404, 'Job not found');
  return job;
});
route('POST', '/api/jobs', ({ body }) => {
  const jobNumber = str(body.job_number, 'Job number').replace(/^#/, '');
  const client = str(body.client, 'Client');
  const project = str(body.project_name, 'Project name');
  const status = str(body.status ?? 'active', 'Status');
  const now = Date.now();
  const id = tx(() => {
    if (db.prepare('SELECT 1 FROM jobs WHERE job_number = ?').get(jobNumber)) {
      throw new HttpError(400, `Job #${jobNumber} already exists`);
    }
    const r = db.prepare(`INSERT INTO jobs (job_number, client_id, project_name, notes, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(jobNumber, upsertClient(client), project, str(body.notes, 'Notes', false), status, now, now);
    return r.lastInsertRowid;
  });
  return getJob(id);
});
route('PATCH', '/api/jobs/:id', ({ params, body }) => {
  const id = Number(params[0]);
  tx(() => {
    const job = getJob(id);
    if (!job) throw new HttpError(404, 'Job not found');
    const jobNumber = body.job_number !== undefined ? str(body.job_number, 'Job number').replace(/^#/, '') : job.job_number;
    const dup = db.prepare('SELECT id FROM jobs WHERE job_number = ? AND id != ?').get(jobNumber as string, id);
    if (dup) throw new HttpError(400, `Job #${jobNumber} already exists`);
    const clientId = body.client !== undefined ? upsertClient(str(body.client, 'Client')) : job.client_id;
    db.prepare(`UPDATE jobs SET job_number = ?, client_id = ?, project_name = ?, notes = ?, status = ?, updated_at = ? WHERE id = ?`).run(
      jobNumber as string,
      clientId as number,
      body.project_name !== undefined ? str(body.project_name, 'Project name') : job.project_name as string,
      body.notes !== undefined ? str(body.notes, 'Notes', false) : job.notes as string,
      body.status !== undefined ? str(body.status, 'Status') : job.status as string,
      Date.now(), id,
    );
  });
  return getJob(id);
});
route('DELETE', '/api/jobs/:id', ({ params }) => {
  db.prepare('DELETE FROM jobs WHERE id = ?').run(Number(params[0]));
  return { ok: true };
});

// sessions (completed ones; the running timer is exposed via /api/timer)
route('GET', '/api/sessions', ({ query }) => {
  const where = ['s.end_at IS NOT NULL'];
  const args: (number | string)[] = [];
  if (query.get('from')) { where.push('s.start_at >= ?'); args.push(Number(query.get('from'))); }
  if (query.get('to')) { where.push('s.start_at < ?'); args.push(Number(query.get('to'))); }
  if (query.get('jobId')) { where.push('s.job_id = ?'); args.push(Number(query.get('jobId'))); }
  if (query.get('unlabeled')) where.push('s.category_id IS NULL');
  const limit = Number(query.get('limit')) || -1;
  return db.prepare(`${SESSION_SELECT} WHERE ${where.join(' AND ')} ORDER BY s.start_at DESC LIMIT ${limit}`).all(...args);
});
route('POST', '/api/sessions', ({ body }) => {
  const jobId = num(body.job_id, 'Job');
  const start = num(body.start_at, 'Start');
  const end = num(body.end_at, 'End');
  if (end <= start) throw new HttpError(400, 'End time must be after start time');
  if (!getJob(jobId)) throw new HttpError(400, 'Choose a job');
  const source = body.source === 'manual_duration' ? 'manual_duration' : 'manual';
  const now = Date.now();
  const r = db.prepare(`INSERT INTO sessions (job_id, category_id, start_at, end_at, notes, source, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(jobId, body.category_id == null ? null : num(body.category_id, 'Category'),
    start, end, str(body.notes, 'Notes', false), source, now, now);
  return getSession(r.lastInsertRowid);
});
route('PATCH', '/api/sessions/:id', ({ params, body }) => {
  const id = Number(params[0]);
  const cur = getSession(id);
  if (!cur) throw new HttpError(404, 'Session not found');
  const start = body.start_at !== undefined ? num(body.start_at, 'Start') : cur.start_at as number;
  const end = body.end_at !== undefined ? (body.end_at === null ? null : num(body.end_at, 'End')) : cur.end_at as number | null;
  if (end !== null && end <= start) throw new HttpError(400, 'End time must be after start time');
  const idleSec = body.idle_sec !== undefined ? Math.max(0, num(body.idle_sec, 'Idle')) : cur.idle_sec as number;
  db.prepare(`UPDATE sessions SET job_id = ?, category_id = ?, start_at = ?, end_at = ?, idle_sec = ?, notes = ?, source = ?, updated_at = ? WHERE id = ?`).run(
    body.job_id !== undefined ? num(body.job_id, 'Job') : cur.job_id as number,
    body.category_id !== undefined ? (body.category_id === null ? null : num(body.category_id, 'Category')) : cur.category_id as number | null,
    start, end, idleSec,
    body.notes !== undefined ? str(body.notes, 'Notes', false) : cur.notes as string,
    body.source !== undefined && ['timer', 'manual', 'manual_duration'].includes(body.source as string) ? body.source as string : cur.source as string,
    Date.now(), id,
  );
  return getSession(id);
});
route('DELETE', '/api/sessions/:id', ({ params }) => {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(Number(params[0]));
  return { ok: true };
});

// timer
route('GET', '/api/timer', () => ({ running: getRunning(), now: Date.now() }));
route('POST', '/api/timer/start', ({ body }) => startTimer(num(body.job_id, 'Job'), !!body.force));
route('POST', '/api/timer/stop', () => {
  const stopped = tx(() => stopRunning());
  const idleInfo = idleFor(stopped);
  return { stopped, idle: idleInfo };
});
route('POST', '/api/timer/discard', () => {
  db.prepare('DELETE FROM sessions WHERE end_at IS NULL AND user_id = 1').run();
  idle.clear();
  return { ok: true };
});

// idle detection
route('GET', '/api/idle', () => {
  const running = getRunning();
  const info = idleFor(running);
  return {
    enabled: !!getSettings().idleDetection,
    supported: idle.supported,
    idleSec: idle.idleSec,
    // Only surface a prompt once the person is back (episode closed).
    prompt: info && idle.episode?.endAt != null ? { ...info, sessionId: running!.id } : null,
  };
});
route('POST', '/api/idle/resolve', ({ body }) => {
  const sessionId = num(body.session_id, 'Session');
  const session = getSession(sessionId);
  if (session && body.action === 'remove') {
    const sec = body.seconds != null ? Math.max(0, num(body.seconds, 'Seconds'))
      : idle.overlap(session.start_at as number, (session.end_at as number | null) ?? Date.now());
    db.prepare('UPDATE sessions SET idle_sec = idle_sec + ?, updated_at = ? WHERE id = ?').run(Math.floor(sec), Date.now(), sessionId);
  }
  idle.clear();
  return { session: getSession(sessionId) ?? null };
});

// backup / export
route('GET', '/api/backup/db', ({ res }) => {
  const tmp = join(tmpdir(), `design-clock-backup-${Date.now()}.db`);
  db.prepare('VACUUM INTO ?').run(tmp);
  const stamp = new Date().toISOString().slice(0, 10);
  res.writeHead(200, {
    'Content-Type': 'application/vnd.sqlite3',
    'Content-Length': statSync(tmp).size,
    'Content-Disposition': `attachment; filename="design-clock-backup-${stamp}.db"`,
  });
  const stream = createReadStream(tmp);
  stream.pipe(res);
  stream.on('close', () => rmSync(tmp, { force: true }));
  return RAW;
});
route('GET', '/api/backup/json', () => ({
  exported_at: new Date().toISOString(),
  schema_version: (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
  settings: getSettings(),
  users: db.prepare('SELECT * FROM users').all(),
  clients: db.prepare('SELECT * FROM clients').all(),
  categories: db.prepare('SELECT * FROM categories').all(),
  jobs: db.prepare('SELECT * FROM jobs').all(),
  sessions: db.prepare('SELECT * FROM sessions').all(),
}));
route('GET', '/api/info', () => ({ dbPath: DB_PATH, sampleJobIds: getSettings().sampleJobIds ?? [] }));
route('POST', '/api/sample/remove', () => {
  const ids = (getSettings().sampleJobIds as number[] | undefined) ?? [];
  tx(() => {
    const del = db.prepare('DELETE FROM jobs WHERE id = ?');
    for (const id of ids) del.run(id);
    db.prepare('DELETE FROM clients WHERE id NOT IN (SELECT client_id FROM jobs)').run();
    db.prepare(`DELETE FROM settings WHERE key = 'sampleJobIds'`).run();
  });
  return { removed: ids.length };
});

const RAW = Symbol('raw');

// ---------------------------------------------------------------- server
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json',
};

async function readBody(req: IncomingMessage): Promise<Row> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'Invalid JSON'); }
}

function send(res: ServerResponse, status: number, data: unknown) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(body);
}

function serveStatic(pathname: string, res: ServerResponse) {
  let file = resolve(DIST, '.' + decodeURIComponent(pathname));
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(503, { 'Content-Type': 'text/plain' });
    res.end('The interface has not been built yet. Run "npm run build" (or use "npm run dev" during development).');
    return;
  }
  const isAsset = file.includes(`${join(DIST, 'assets')}`);
  res.writeHead(200, {
    'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
    'Cache-Control': isAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  res.end(readFileSync(file));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${HOST}`);
  if (!url.pathname.startsWith('/api/')) return serveStatic(url.pathname, res);
  const match = routes.find(([m, re]) => m === req.method && re.test(url.pathname));
  if (!match) return send(res, 404, { error: 'Not found' });
  try {
    const params = url.pathname.match(match[1])!.slice(1);
    const body = req.method === 'GET' ? {} : await readBody(req);
    const out = await match[2]({ params, body, query: url.searchParams, res });
    if (out !== RAW) send(res, 200, out ?? { ok: true });
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { error: e.message, ...(e.body as object) });
    const msg = (e as Error).message ?? String(e);
    console.error(e);
    send(res, msg.includes('constraint') ? 400 : 500, { error: msg });
  }
});

function findEdge(): string | null {
  const candidates = [
    `${process.env['ProgramFiles(x86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${process.env.ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${process.env.LOCALAPPDATA}\\Microsoft\\Edge\\Application\\msedge.exe`,
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

function openWindow() {
  const url = `http://${HOST}:${PORT}/`;
  const edge = findEdge();
  if (edge) {
    spawn(edge, [`--app=${url}`, '--window-size=1440,920'], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  }
}

server.on('error', async (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    // Already running (e.g. launched twice): just open another window onto it.
    try {
      const r = await fetch(`http://${HOST}:${PORT}/api/health`);
      if (r.ok && OPEN) openWindow();
      console.log(`Design Clock is already running on port ${PORT}.`);
      process.exit(0);
    } catch { /* fall through */ }
  }
  console.error(err);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`Design Clock running at http://${HOST}:${PORT}  (database: ${DB_PATH})`);
  if (OPEN) openWindow();
});

function shutdown() {
  idle.stop();
  try { db.close(); } catch { /* already closed */ }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
