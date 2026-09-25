import type { Category, IdleInfo, Job, Session, Settings } from './types';

export class ApiError extends Error {
  status: number;
  data: Record<string, unknown>;
  constructor(status: number, data: Record<string, unknown>) {
    super(String(data.error ?? `Request failed (${status})`));
    this.status = status;
    this.data = data;
  }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}

const qs = (o: Record<string, string | number | boolean | undefined | null>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export interface StartResult { running: Session; stopped: Session | null; idle: IdleInfo | null }

export const api = {
  bootstrap: () => req<{ settings: Settings; categories: Category[]; running: Session | null; now: number }>('GET', '/bootstrap'),

  jobs: () => req<Job[]>('GET', '/jobs'),
  job: (id: number) => req<Job>('GET', `/jobs/${id}`),
  createJob: (j: { job_number: string; client: string; project_name: string; notes?: string; status?: string }) =>
    req<Job>('POST', '/jobs', j),
  updateJob: (id: number, j: Partial<{ job_number: string; client: string; project_name: string; notes: string; status: string }>) =>
    req<Job>('PATCH', `/jobs/${id}`, j),
  deleteJob: (id: number) => req('DELETE', `/jobs/${id}`),
  clients: () => req<{ id: number; name: string }[]>('GET', '/clients'),

  sessions: (f: { from?: number; to?: number; jobId?: number; unlabeled?: boolean; limit?: number } = {}) =>
    req<Session[]>('GET', `/sessions${qs(f)}`),
  createSession: (s: { job_id: number; category_id: number | null; start_at: number; end_at: number; notes: string; source: string }) =>
    req<Session>('POST', '/sessions', s),
  updateSession: (id: number, s: Partial<Pick<Session, 'job_id' | 'category_id' | 'start_at' | 'end_at' | 'notes' | 'idle_sec' | 'source'>>) =>
    req<Session>('PATCH', `/sessions/${id}`, s),
  deleteSession: (id: number) => req('DELETE', `/sessions/${id}`),

  start: (jobId: number, force = false) => req<StartResult>('POST', '/timer/start', { job_id: jobId, force }),
  stop: () => req<{ stopped: Session | null; idle: IdleInfo | null }>('POST', '/timer/stop'),
  discard: () => req('POST', '/timer/discard'),

  idle: () => req<{ enabled: boolean; supported: boolean; idleSec: number; prompt: (IdleInfo & { sessionId: number }) | null }>('GET', '/idle'),
  resolveIdle: (sessionId: number, action: 'keep' | 'remove', seconds?: number) =>
    req<{ session: Session | null }>('POST', '/idle/resolve', { session_id: sessionId, action, seconds }),

  saveSettings: (s: Partial<Settings>) => req<Settings>('PUT', '/settings', s),
  addCategory: (name: string) => req<Category>('POST', '/categories', { name }),
  updateCategory: (id: number, c: Partial<Pick<Category, 'name' | 'archived' | 'sort_order'>>) => req<Category>('PATCH', `/categories/${id}`, c),

  deleteCategory: (id: number, reassignTo: number | null) =>
    req<{ ok: true; moved: number }>('DELETE', `/categories/${id}${qs({ reassign_to: reassignTo })}`),

  info: () => req<{ dbPath: string; sampleJobIds: number[] }>('GET', '/info'),
  removeSample: () => req<{ removed: number }>('POST', '/sample/remove'),
  backupJson: () => req<unknown>('GET', '/backup/json'),
};
