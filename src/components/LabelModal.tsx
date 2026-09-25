import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { useStore } from '../store';
import { api } from '../api';
import { fmtDur, fmtDurLong, fmtTime } from '../lib/time';
import { Kbd, Modal } from './Modal';

/**
 * "What did you work on?" — shown right after STOP (or after switching jobs).
 * Fast path: press a number (or click a category), then Enter.
 */
export function LabelModal() {
  const { labelQueue, closeLabel, activeCategories, reloadCategories, refresh, fail, toast } = useStore();
  const item = labelQueue[0];
  const session = item?.session;
  const [catId, setCatId] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [idle, setIdle] = useState(item?.idle ?? null);
  const [idleRemoved, setIdleRemoved] = useState(0);
  const [adding, setAdding] = useState(false);
  const [newCat, setNewCat] = useState('');
  const [saving, setSaving] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const notesRef = useRef<HTMLInputElement>(null);

  // Reset per session; preselect the category last used on this job.
  useEffect(() => {
    if (!session) return;
    setCatId(session.category_id);
    setNotes(session.notes ?? '');
    setIdle(item.idle);
    setIdleRemoved(0);
    setAdding(false);
    if (session.category_id == null) {
      api.sessions({ jobId: session.job_id, limit: 6 }).then((list) => {
        const last = list.find((s) => s.id !== session.id && s.category_id != null);
        if (last) setCatId((cur) => cur ?? last.category_id);
      }).catch(() => {});
    }
  }, [session?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard focus follows the selected category (unless you're typing notes).
  useEffect(() => {
    if (!session) return;
    requestAnimationFrame(() => {
      const grid = gridRef.current;
      const active = document.activeElement;
      if (!grid || (active && active !== document.body && !grid.contains(active) && !active.matches('[role=dialog]'))) return;
      grid.querySelector<HTMLElement>('.cat-btn.on, .cat-btn')?.focus();
    });
  }, [catId, session?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const cats = activeCategories;
  const duration = useMemo(() => (session ? (session.duration_sec ?? 0) - idleRemoved : 0), [session, idleRemoved]);
  if (!session) return null;

  const save = async (overrideCat?: number) => {
    const category_id = overrideCat ?? catId;
    if (category_id == null) { toast('Pick a category (or press Esc to label later)'); return; }
    setSaving(true);
    try {
      await api.updateSession(session.id, { category_id, notes: notes.trim() });
      closeLabel();
      await refresh();
    } catch (e) { fail(e); } finally { setSaving(false); }
  };

  const later = () => {
    closeLabel();
    toast('Saved without a label — it’s listed under “Needs label” on the Dashboard');
    void refresh();
  };

  const discard = async () => {
    if (!confirm('Delete this session? The time will not be recorded.')) return;
    try { await api.deleteSession(session.id); closeLabel(); await refresh(); toast('Session deleted'); } catch (e) { fail(e); }
  };

  const resolveIdle = async (action: 'keep' | 'remove') => {
    if (!idle) return;
    try {
      await api.resolveIdle(session.id, action, idle.seconds);
      if (action === 'remove') setIdleRemoved(idle.seconds);
      setIdle(null);
    } catch (e) { fail(e); }
  };

  const addCategory = async () => {
    const name = newCat.trim();
    if (!name) { setAdding(false); return; }
    try {
      const c = await api.addCategory(name);
      await reloadCategories();
      setCatId(c.id);
      setNewCat('');
      setAdding(false);
      notesRef.current?.focus();
    } catch (e) { fail(e); }
  };

  const onGridKey = (e: React.KeyboardEvent) => {
    const idx = cats.findIndex((c) => c.id === catId);
    if (/^[1-9]$/.test(e.key) && !e.ctrlKey && !e.altKey) {
      const c = cats[Number(e.key) - 1];
      if (c) { setCatId(c.id); e.preventDefault(); focusBtn(Number(e.key) - 1); }
    } else if (e.key === '0' && cats[9]) {
      setCatId(cats[9].id); focusBtn(9); e.preventDefault();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      void save();
    } else if (['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
      e.preventDefault();
      const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' ? 2 : -2;
      const n = Math.min(cats.length - 1, Math.max(0, (idx < 0 ? 0 : idx + step)));
      setCatId(cats[n].id);
      focusBtn(n);
    } else if (e.key.length === 1 && /[a-z]/i.test(e.key) && !e.ctrlKey && !e.altKey) {
      // type-ahead: jump to the next category starting with that letter
      const start = idx + 1;
      const order = [...cats.slice(start), ...cats.slice(0, start)];
      const hit = order.find((c) => c.name.toLowerCase().startsWith(e.key.toLowerCase()));
      if (hit) { setCatId(hit.id); focusBtn(cats.indexOf(hit)); e.preventDefault(); }
    }
  };
  const focusBtn = (i: number) => gridRef.current?.querySelectorAll<HTMLElement>('.cat-btn')[i]?.focus();

  return (
    <Modal
      title="What did you work on?"
      sub={
        <>
          <span className="mono jobnum">#{session.job_number}</span> {session.client} · {session.project_name}
          <br />
          <b style={{ color: 'var(--text)' }}>{fmtDurLong(duration)}</b>
          {' '}· {fmtTime(session.start_at)} – {session.end_at ? fmtTime(session.end_at) : ''}
          {labelQueue.length > 1 && <> · {labelQueue.length - 1} more to label</>}
        </>
      }
      onClose={later}
      closeOnBackdrop={false}
      footer={
        <>
          <button className="btn ghost sm danger" onClick={discard} tabIndex={-1}>Delete session</button>
          <div className="spacer" />
          <button className="btn" onClick={later}>Later <Kbd>Esc</Kbd></button>
          <button className="btn primary" onClick={() => void save()} disabled={saving || catId == null}>Save <Kbd>↵</Kbd></button>
        </>
      }
    >
      <div className="modal-body">
        {idle && (
          <div className="idle-box">
            <div className="grow">You appear to have been inactive for {fmtDur(idle.seconds)} during this session.</div>
            <button className="btn sm" onClick={() => void resolveIdle('keep')}>Keep idle time</button>
            <button className="btn sm primary" onClick={() => void resolveIdle('remove')}>Remove idle time</button>
          </div>
        )}
        <div className="cat-grid" ref={gridRef} onKeyDown={onGridKey}>
          {cats.map((c, i) => (
            <button
              key={c.id}
              type="button"
              className={`cat-btn ${catId === c.id ? 'on' : ''}`}
              onClick={() => { setCatId(c.id); notesRef.current?.focus(); }}
              onDoubleClick={() => void save(c.id)}
              title="Click to select · double-click to save"
            >
              <Kbd>{i < 9 ? i + 1 : i === 9 ? 0 : '·'}</Kbd>
              <span className="name">{c.name}</span>
            </button>
          ))}
          {adding ? (
            <input
              className="input"
              autoFocus
              placeholder="New category name"
              value={newCat}
              onChange={(e) => setNewCat(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') void addCategory();
                if (e.key === 'Escape') { e.preventDefault(); setAdding(false); }
              }}
              onBlur={() => void addCategory()}
            />
          ) : (
            <button type="button" className="cat-btn" onClick={() => setAdding(true)} style={{ color: 'var(--text-3)' }}>
              <Plus size={14} /> <span className="name">New category…</span>
            </button>
          )}
        </div>
        <div className="field" style={{ marginTop: 12 }}>
          <input
            ref={notesRef}
            className="input"
            placeholder="Notes (optional) — e.g. “Started passenger side layout”"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void save(); } }}
          />
        </div>
      </div>
    </Modal>
  );
}
