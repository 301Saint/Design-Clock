import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.DESIGN_CLOCK_DATA ?? resolve(here, '..', 'data');
export const DB_PATH = resolve(DATA_DIR, 'design-clock.db');

export const DEFAULT_CATEGORIES = [
  'Initial Design', 'Design Concepts', 'Revisions', 'Client Revisions', 'Internal Revisions',
  'Mockup', 'Photo Mockup', 'Logo Recreation', 'Vector Cleanup', 'Preflight',
  'Production Setup', 'File Preparation', 'Research', 'Other',
];

export const DEFAULT_SETTINGS: Record<string, unknown> = {
  hourlyRate: 75,
  currency: 'USD',
  rounding: 'exact',
  theme: 'dark',
  idleDetection: false,
  idleThresholdMin: 10,
  confirmSwitch: true,
};

/**
 * Migrations are append-only. PRAGMA user_version records how many have run,
 * so future additions (quotes, invoice links, sync ids) are just new entries.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE clients (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE jobs (
    id            INTEGER PRIMARY KEY,
    job_number    TEXT NOT NULL UNIQUE COLLATE NOCASE,
    client_id     INTEGER NOT NULL REFERENCES clients(id),
    project_name  TEXT NOT NULL,
    notes         TEXT NOT NULL DEFAULT '',
    status        TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','on_hold','completed','archived')),
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
  );
  CREATE INDEX jobs_client ON jobs(client_id);

  CREATE TABLE categories (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    archived    INTEGER NOT NULL DEFAULT 0
  );

  -- Raw time records. start_at / end_at are epoch milliseconds (UTC).
  -- end_at IS NULL means the timer is running. Billable (rounded) time is
  -- never stored: it is always derived from these rows at read time.
  CREATE TABLE sessions (
    id            INTEGER PRIMARY KEY,
    job_id        INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    user_id       INTEGER NOT NULL DEFAULT 1 REFERENCES users(id),
    category_id   INTEGER REFERENCES categories(id),
    start_at      INTEGER NOT NULL,
    end_at        INTEGER,
    idle_sec      INTEGER NOT NULL DEFAULT 0,
    notes         TEXT NOT NULL DEFAULT '',
    source        TEXT NOT NULL DEFAULT 'timer'
                  CHECK (source IN ('timer','manual','manual_duration')),
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL,
    duration_sec  INTEGER GENERATED ALWAYS AS
                  (CASE WHEN end_at IS NULL THEN NULL
                        ELSE MAX(0, (end_at - start_at) / 1000 - idle_sec) END) VIRTUAL,
    CHECK (end_at IS NULL OR end_at >= start_at)
  );
  CREATE INDEX sessions_job ON sessions(job_id, start_at);
  CREATE INDEX sessions_start ON sessions(start_at);
  -- The database itself guarantees at most one running timer (per user).
  CREATE UNIQUE INDEX sessions_one_running ON sessions(user_id) WHERE end_at IS NULL;

  CREATE TABLE settings (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
  );
  `,
];

export function openDb(path = DB_PATH): { db: DatabaseSync; created: boolean } {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL;');
  const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  const created = version === 0;
  for (let i = version; i < MIGRATIONS.length; i++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[i]);
      db.exec(`PRAGMA user_version = ${i + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  if (created) initDefaults(db);
  return { db, created };
}

function initDefaults(db: DatabaseSync) {
  const now = Date.now();
  db.prepare('INSERT OR IGNORE INTO users (id, name, created_at) VALUES (1, ?, ?)').run('Designer', now);
  const insCat = db.prepare('INSERT OR IGNORE INTO categories (name, sort_order) VALUES (?, ?)');
  DEFAULT_CATEGORIES.forEach((name, i) => insCat.run(name, i));
  const insSet = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insSet.run(k, JSON.stringify(v));
}
