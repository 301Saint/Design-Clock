import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiError } from './api';
import type { Category, IdleInfo, Job, Session, Settings } from './types';

// ------------------------------------------------------------------ routing
export function useHashRoute(): string[] {
  const read = () => (window.location.hash.replace(/^#\/?/, '') || 'dashboard').split('/');
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => setRoute(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
export const go = (path: string) => { window.location.hash = '/' + path.replace(/^\//, ''); };

// ------------------------------------------------------------------ store
export type LabelItem = { session: Session; idle: IdleInfo | null };
export type SessionDraft = { session?: Session; jobId?: number };
type Toast = { id: number; text: string; action?: { label: string; run: () => void } };

interface Store {
  ready: boolean;
  settings: Settings;
  categories: Category[]; // all, including archived
  activeCategories: Category[];
  jobs: Job[];
  running: Session | null;
  version: number;
  refresh: () => Promise<void>;

  startJob: (jobId: number) => void;
  stopTimer: () => Promise<void>;
  toggleTimer: () => void;
  discardTimer: () => Promise<void>;
  focusJobId: number | null;
  setFocusJobId: (id: number | null) => void;

  switchPrompt: Job | null;
  confirmSwitch: (ok: boolean) => void;

  labelQueue: LabelItem[];
  openLabel: (s: Session) => void;
  closeLabel: () => void;

  jobForm: { open: boolean; job?: Job; prefill?: string };
  openJobForm: (job?: Job, prefill?: string) => void;
  closeJobForm: () => void;

  search: { open: boolean; mode: 'open' | 'start' };
  openSearch: (mode?: 'open' | 'start') => void;
  closeSearch: () => void;

  sessionDraft: SessionDraft | null;
  openSession: (d: SessionDraft) => void;
  closeSession: () => void;

  helpOpen: boolean;
  setHelpOpen: (b: boolean) => void;

  saveSettings: (s: Partial<Settings>) => Promise<void>;
  reloadCategories: () => Promise<void>;

  toasts: Toast[];
  toast: (text: string, action?: Toast['action']) => void;
  fail: (e: unknown) => void;
}

const DEFAULT_SETTINGS: Settings = {
  hourlyRate: 75, currency: 'USD', rounding: 'exact', theme: 'dark',
  idleDetection: false, idleThresholdMin: 10, confirmSwitch: true,
};

const Ctx = createContext<Store | null>(null);
export const useStore = () => {
  const s = useContext(Ctx);
  if (!s) throw new Error('Store missing');
  return s;
};

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [categories, setCategories] = useState<Category[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [running, setRunning] = useState<Session | null>(null);
  const [version, setVersion] = useState(0);
  const [focusJobId, setFocusJobId] = useState<number | null>(null);
  const [switchPrompt, setSwitchPrompt] = useState<Job | null>(null);
  const [labelQueue, setLabelQueue] = useState<LabelItem[]>([]);
  const [jobForm, setJobForm] = useState<Store['jobForm']>({ open: false });
  const [search, setSearch] = useState<Store['search']>({ open: false, mode: 'open' });
  const [sessionDraft, setSessionDraft] = useState<SessionDraft | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const busy = useRef(false);

  const toast = useCallback((text: string, action?: Toast['action']) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, text, action }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), action ? 6000 : 3200);
  }, []);
  const fail = useCallback((e: unknown) => {
    toast(e instanceof Error ? e.message : 'Something went wrong');
    console.error(e);
  }, [toast]);

  const refresh = useCallback(async () => {
    const [j, t] = await Promise.all([api.jobs(), fetch('/api/timer').then((r) => r.json())]);
    setJobs(j);
    setRunning(t.running);
    setVersion((v) => v + 1);
  }, []);

  const reloadCategories = useCallback(async () => {
    const b = await api.bootstrap();
    setCategories(b.categories);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const b = await api.bootstrap();
        setSettings(b.settings);
        setCategories(b.categories);
        setRunning(b.running); // restores a timer that was running when the app closed
        setJobs(await api.jobs());
        setReady(true);
      } catch (e) {
        fail(e);
        setTimeout(() => window.location.reload(), 3000);
      }
    })();
  }, [fail]);

  // Keep in sync if the app is open in two windows, or after sleep.
  useEffect(() => {
    const on = () => { if (document.visibilityState === 'visible') refresh().catch(() => {}); };
    document.addEventListener('visibilitychange', on);
    window.addEventListener('focus', on);
    return () => { document.removeEventListener('visibilitychange', on); window.removeEventListener('focus', on); };
  }, [refresh]);

  // Theme
  useEffect(() => {
    const apply = () => {
      const dark = settings.theme === 'dark' || (settings.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    };
    apply();
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [settings.theme]);

  const pushLabel = useCallback((session: Session | null, idle: IdleInfo | null) => {
    if (session) setLabelQueue((q) => [...q.filter((x) => x.session.id !== session.id), { session, idle }]);
  }, []);

  const doStart = useCallback(async (jobId: number) => {
    if (busy.current) return;
    busy.current = true;
    try {
      const r = await api.start(jobId, true);
      setRunning(r.running);
      pushLabel(r.stopped, r.idle);
      await refresh();
    } catch (e) {
      fail(e);
    } finally {
      busy.current = false;
    }
  }, [fail, pushLabel, refresh]);

  const startJob = useCallback((jobId: number) => {
    if (running && running.job_id === jobId) return;
    if (running && settings.confirmSwitch) {
      const job = jobs.find((j) => j.id === jobId);
      if (job) { setSwitchPrompt(job); return; }
    }
    void doStart(jobId);
  }, [running, settings.confirmSwitch, jobs, doStart]);

  const confirmSwitch = useCallback((ok: boolean) => {
    const job = switchPrompt;
    setSwitchPrompt(null);
    if (ok && job) void doStart(job.id);
  }, [switchPrompt, doStart]);

  const stopTimer = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const r = await api.stop();
      setRunning(null);
      pushLabel(r.stopped, r.idle);
      await refresh();
    } catch (e) {
      fail(e);
    } finally {
      busy.current = false;
    }
  }, [fail, pushLabel, refresh]);

  const toggleTimer = useCallback(() => {
    if (running) { void stopTimer(); return; }
    const target = focusJobId ?? jobs.find((j) => j.last_worked_at && j.status !== 'archived')?.id;
    if (target) startJob(target);
    else setSearch({ open: true, mode: 'start' });
  }, [running, stopTimer, focusJobId, jobs, startJob]);

  const discardTimer = useCallback(async () => {
    try {
      await api.discard();
      setRunning(null);
      await refresh();
      toast('Timer discarded');
    } catch (e) { fail(e); }
  }, [refresh, toast, fail]);

  const saveSettings = useCallback(async (s: Partial<Settings>) => {
    setSettings((cur) => ({ ...cur, ...s }));
    try { setSettings(await api.saveSettings(s)); } catch (e) { fail(e); }
  }, [fail]);

  const activeCategories = useMemo(
    () => categories.filter((c) => !c.archived).sort((a, b) => a.sort_order - b.sort_order),
    [categories],
  );

  const value: Store = {
    ready, settings, categories, activeCategories, jobs, running, version, refresh,
    startJob, stopTimer, toggleTimer, discardTimer, focusJobId, setFocusJobId,
    switchPrompt, confirmSwitch,
    labelQueue,
    openLabel: (s) => pushLabel(s, null),
    closeLabel: () => setLabelQueue((q) => q.slice(1)),
    jobForm,
    openJobForm: (job, prefill) => setJobForm({ open: true, job, prefill }),
    closeJobForm: () => setJobForm({ open: false }),
    search,
    openSearch: (mode = 'open') => setSearch({ open: true, mode }),
    closeSearch: () => setSearch((s) => ({ ...s, open: false })),
    sessionDraft,
    openSession: setSessionDraft,
    closeSession: () => setSessionDraft(null),
    helpOpen, setHelpOpen,
    saveSettings, reloadCategories,
    toasts, toast, fail,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Re-runs `load` whenever deps or the global data version change. */
export function useData<T>(load: () => Promise<T>, deps: unknown[]): [T | undefined, boolean] {
  const { version, fail } = useStore();
  const [data, setData] = useState<T>();
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    load().then((d) => { if (alive) { setData(d); setLoading(false); } })
      .catch((e) => { if (alive && !(e instanceof ApiError && e.status === 404)) fail(e); setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version]);
  return [data, loading];
}

/** Ticking clock for live timers. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
