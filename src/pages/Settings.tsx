import { useEffect, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Database, Download, Eye, EyeOff, FileJson, FileSpreadsheet, Plus, Trash2 } from 'lucide-react';
import { api } from '../api';
import { useStore } from '../store';
import { download, sessionsToCsv, stamp } from '../lib/csv';
import { money } from '../lib/time';
import { ROUNDING_LABEL, type Category, type Rounding, type Settings } from '../types';
import { Kbd, Modal, Switch } from '../components/Modal';

const CURRENCIES = ['USD', 'CAD', 'EUR', 'GBP', 'AUD', 'NZD', 'MXN'];

function Section({ title, desc, children }: { title: string; desc?: ReactNode; children: ReactNode }) {
  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <div className="card-head"><h2>{title}</h2></div>
      <div className="card-body">
        {desc && <p className="muted" style={{ margin: '0 0 12px', fontSize: 12.5 }}>{desc}</p>}
        {children}
      </div>
    </section>
  );
}

function Line({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '8px 0', borderTop: '1px solid var(--border)' }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 560 }}>{label}</div>
        {hint && <div className="faint" style={{ fontSize: 12.5 }}>{hint}</div>}
      </div>
      {children}
    </div>
  );
}

export function SettingsPage() {
  const { settings, saveSettings, categories, reloadCategories, refresh, fail, toast } = useStore();
  const [rate, setRate] = useState(String(settings.hourlyRate));
  const [newCat, setNewCat] = useState('');
  const [info, setInfo] = useState<{ dbPath: string; sampleJobIds: number[] } | null>(null);
  const [idleSupported, setIdleSupported] = useState(true);
  const [deleting, setDeleting] = useState<Category | null>(null);

  useEffect(() => { setRate(String(settings.hourlyRate)); }, [settings.hourlyRate]);
  useEffect(() => {
    api.info().then(setInfo).catch(() => {});
    api.idle().then((r) => setIdleSupported(r.supported)).catch(() => {});
  }, []);

  const set = (s: Partial<Settings>) => void saveSettings(s);
  const commitRate = () => {
    const n = Number(rate);
    if (Number.isFinite(n) && n >= 0) set({ hourlyRate: Math.round(n * 100) / 100 });
    else setRate(String(settings.hourlyRate));
  };

  const sorted = [...categories].sort((a, b) => a.archived - b.archived || a.sort_order - b.sort_order);
  const visible = sorted.filter((c) => !c.archived);

  const move = async (id: number, dir: -1 | 1) => {
    const i = visible.findIndex((c) => c.id === id);
    const j = i + dir;
    if (j < 0 || j >= visible.length) return;
    const order = [...visible];
    [order[i], order[j]] = [order[j], order[i]];
    try {
      await Promise.all(order.map((c, idx) => (c.sort_order !== idx ? api.updateCategory(c.id, { sort_order: idx }) : null)));
      await reloadCategories();
    } catch (e) { fail(e); }
  };
  const rename = async (id: number, name: string) => {
    const cur = categories.find((c) => c.id === id);
    if (!name.trim() || name.trim() === cur?.name) return;
    try { await api.updateCategory(id, { name: name.trim() }); await reloadCategories(); await refresh(); } catch (e) { fail(e); await reloadCategories(); }
  };
  const toggleHidden = async (id: number, archived: boolean) => {
    try { await api.updateCategory(id, { archived: archived ? 1 : 0 }); await reloadCategories(); } catch (e) { fail(e); }
  };
  const add = async () => {
    if (!newCat.trim()) return;
    try { await api.addCategory(newCat.trim()); setNewCat(''); await reloadCategories(); } catch (e) { fail(e); }
  };

  const exportCsv = async () => {
    try {
      const all = await api.sessions();
      download(`design-time-all-sessions-${stamp()}.csv`, sessionsToCsv(all, settings));
    } catch (e) { fail(e); }
  };
  const exportJson = async () => {
    try {
      const data = await api.backupJson();
      download(`design-clock-export-${stamp()}.json`, JSON.stringify(data, null, 2), 'application/json');
    } catch (e) { fail(e); }
  };
  const removeSample = async () => {
    if (!info?.sampleJobIds.length) return;
    if (!confirm(`Remove the ${info.sampleJobIds.length} sample jobs and all of their sessions? Your own jobs are not touched.`)) return;
    try {
      const r = await api.removeSample();
      toast(`Removed ${r.removed} sample jobs`);
      setInfo(await api.info());
      await refresh();
    } catch (e) { fail(e); }
  };

  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <div className="page-head"><h1>Settings</h1></div>
      {deleting && (
        <DeleteCategory
          category={deleting}
          others={visible.filter((c) => c.id !== deleting.id)}
          onClose={() => setDeleting(null)}
          onDone={async (moved, targetName) => {
            setDeleting(null);
            await reloadCategories();
            await refresh();
            toast(`Deleted “${deleting.name}”${moved ? ` · ${moved} session${moved === 1 ? '' : 's'} ${targetName ? `moved to ${targetName}` : 'now unlabeled'}` : ''}`);
          }}
        />
      )}

      <Section title="Design fee" desc="Tracked time is never altered. Billable time and labor estimates are calculated from your raw sessions whenever they are displayed or exported.">
        <Line label="Design hourly rate" hint={`Currently ${money(settings.hourlyRate, settings)} per hour`}>
          <input className="input mono" style={{ width: 120, textAlign: 'right' }} type="number" min={0} step={5} value={rate}
            onChange={(e) => setRate(e.target.value)} onBlur={commitRate} onKeyDown={(e) => { if (e.key === 'Enter') commitRate(); }} />
        </Line>
        <Line label="Currency">
          <select className="select" style={{ width: 120 }} value={settings.currency} onChange={(e) => set({ currency: e.target.value })}>
            {[...new Set([...CURRENCIES, settings.currency])].map((c) => <option key={c}>{c}</option>)}
          </select>
        </Line>
        <Line label="Default rounding" hint="Applied to each session when calculating billable time">
          <select className="select" style={{ width: 250 }} value={settings.rounding} onChange={(e) => set({ rounding: e.target.value as Rounding })}>
            {(Object.keys(ROUNDING_LABEL) as Rounding[]).map((r) => <option key={r} value={r}>{ROUNDING_LABEL[r]}</option>)}
          </select>
        </Line>
      </Section>

      <Section title="Timer">
        <Line label="Ask before switching jobs" hint="“Stop the current timer and start this job?”">
          <Switch on={settings.confirmSwitch} onChange={(v) => set({ confirmSwitch: v })} label="Ask before switching jobs" />
        </Line>
        <Line
          label="Idle detection"
          hint={idleSupported
            ? 'When you come back after being away, offer to remove the idle time. Only checks how long since the last keyboard/mouse input — nothing is recorded.'
            : 'Not available on this operating system.'}
        >
          <Switch on={settings.idleDetection} onChange={(v) => set({ idleDetection: v })} label="Idle detection" />
        </Line>
        {settings.idleDetection && (
          <Line label="Consider me idle after">
            <select className="select" style={{ width: 140 }} value={settings.idleThresholdMin} onChange={(e) => set({ idleThresholdMin: Number(e.target.value) })}>
              {[3, 5, 10, 15, 20, 30, 45, 60].map((m) => <option key={m} value={m}>{m} minutes</option>)}
            </select>
          </Line>
        )}
      </Section>

      <Section title="Appearance">
        <Line label="Theme">
          <div className="seg">
            {(['dark', 'light', 'system'] as const).map((t) => (
              <button key={t} className={settings.theme === t ? 'on' : ''} onClick={() => set({ theme: t })}>{t[0].toUpperCase() + t.slice(1)}</button>
            ))}
          </div>
        </Line>
      </Section>

      <Section title="Session categories" desc="Shown in this order in the “What did you work on?” prompt (the first ten get number keys). Hide a category to retire it but keep it on old sessions; delete it to remove it completely.">
        <div className="list">
          {sorted.map((c) => {
            const vi = visible.findIndex((v) => v.id === c.id);
            return (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', opacity: c.archived ? 0.5 : 1 }}>
                <span className="kbd" style={{ width: 22 }}>{c.archived ? '–' : vi < 9 ? vi + 1 : vi === 9 ? 0 : '·'}</span>
                <input className="input" style={{ height: 30 }} defaultValue={c.name} key={c.name}
                  onBlur={(e) => void rename(c.id, e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
                <button className="btn ghost sm icon" disabled={!!c.archived || vi === 0} onClick={() => void move(c.id, -1)} title="Move up"><ArrowUp size={13} /></button>
                <button className="btn ghost sm icon" disabled={!!c.archived || vi === visible.length - 1} onClick={() => void move(c.id, 1)} title="Move down"><ArrowDown size={13} /></button>
                <button className="btn ghost sm icon" onClick={() => void toggleHidden(c.id, !c.archived)} title={c.archived ? 'Show' : 'Hide'}>
                  {c.archived ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
                <button className="btn ghost sm icon danger" onClick={() => setDeleting(c)} title="Delete category">
                  <Trash2 size={13} />
                </button>
              </div>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <input className="input" placeholder="New category, e.g. Vehicle Template Setup" value={newCat} onChange={(e) => setNewCat(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void add(); }} />
          <button className="btn" onClick={() => void add()}><Plus size={14} /> Add</button>
        </div>
      </Section>

      <Section title="Data & backup" desc={<>Everything is stored locally in a single SQLite file on this computer{info ? <>: <code className="mono" style={{ fontSize: 12 }}>{info.dbPath}</code></> : ''}. Nothing is sent anywhere.</>}>
        <div className="toolbar">
          <a className="btn" href="/api/backup/db" download><Database size={14} /> Download database backup (.db)</a>
          <button className="btn" onClick={() => void exportCsv()}><FileSpreadsheet size={14} /> Export all sessions (CSV)</button>
          <button className="btn" onClick={() => void exportJson()}><FileJson size={14} /> Full export (JSON)</button>
        </div>
        <p className="faint" style={{ fontSize: 12.5, marginBottom: 0 }}>
          <Download size={12} style={{ verticalAlign: -2 }} /> To restore a .db backup, close Design Clock and copy it over the file above (keep the name <span className="mono">design-clock.db</span>).
        </p>
        {!!info?.sampleJobIds.length && (
          <Line label="Sample data" hint={`${info.sampleJobIds.length} example jobs were added so you could try the app. Remove them when you’re ready to use it for real.`}>
            <button className="btn danger" onClick={() => void removeSample()}><Trash2 size={14} /> Remove sample jobs</button>
          </Line>
        )}
      </Section>
    </div>
  );
}

function DeleteCategory({ category, others, onClose, onDone }: {
  category: Category;
  others: Category[];
  onClose: () => void;
  onDone: (moved: number, targetName: string | null) => void;
}) {
  const { fail } = useStore();
  const used = category.session_count ?? 0;
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);

  const confirmDelete = async () => {
    setBusy(true);
    try {
      const reassign = target ? Number(target) : null;
      const r = await api.deleteCategory(category.id, reassign);
      onDone(r.moved, others.find((c) => c.id === reassign)?.name ?? null);
    } catch (e) { fail(e); setBusy(false); }
  };

  return (
    <Modal
      title={`Delete “${category.name}”?`}
      onClose={onClose}
      footer={
        <>
          <div className="spacer" />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" data-autofocus={used ? undefined : true} disabled={busy} onClick={() => void confirmDelete()}>
            <Trash2 size={14} /> Delete category <Kbd>↵</Kbd>
          </button>
        </>
      }
    >
      <div className="modal-body" onKeyDown={(e) => { if (e.key === 'Enter' && !(e.target instanceof HTMLSelectElement)) { e.preventDefault(); void confirmDelete(); } }}>
        {used ? (
          <>
            <p style={{ marginTop: 0 }}>
              <b>{used} session{used === 1 ? '' : 's'}</b> {used === 1 ? 'is' : 'are'} labeled “{category.name}”. No time will be deleted — choose where {used === 1 ? 'it goes' : 'they go'}:
            </p>
            <div className="field">
              <label htmlFor="del-target">Move sessions to</label>
              <select id="del-target" className="select" data-autofocus value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">Unlabeled (label them later)</option>
                {others.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </>
        ) : (
          <p style={{ margin: 0 }} className="muted">No sessions use this category, so nothing else changes.</p>
        )}
      </div>
    </Modal>
  );
}
