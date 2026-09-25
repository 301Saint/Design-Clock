import { useMemo, useState } from 'react';
import { api } from '../api';
import { useStore, type SessionDraft } from '../store';
import { fmtDur, fromInputs, toDateInput, toTimeInput } from '../lib/time';
import { Kbd, Modal } from './Modal';

type Mode = 'range' | 'duration';

/** Edit an existing session, or add time manually ("forgot to start the timer"). */
export function SessionModal() {
  const { sessionDraft } = useStore();
  // Remount per opened draft so every field starts from the right values.
  const key = useMemo(() => Math.random(), [sessionDraft]);
  if (!sessionDraft) return null;
  return <SessionForm key={key} draft={sessionDraft} />;
}

function initial(draft: SessionDraft) {
  const s = draft.session;
  const now = Date.now();
  if (s) {
    const d = s.duration_sec ?? 0;
    return {
      mode: (s.source === 'manual_duration' ? 'duration' : 'range') as Mode,
      jobId: s.job_id as number | '', catId: (s.category_id ?? '') as number | '',
      date: toDateInput(s.start_at), start: toTimeInput(s.start_at), end: s.end_at ? toTimeInput(s.end_at) : '',
      h: String(Math.floor(d / 3600)), m: String(Math.round((d % 3600) / 60)), notes: s.notes, idleSec: s.idle_sec,
    };
  }
  return {
    mode: 'range' as Mode, jobId: (draft.jobId ?? '') as number | '', catId: '' as number | '',
    date: toDateInput(now), start: toTimeInput(now - 3600_000), end: toTimeInput(now), h: '', m: '', notes: '', idleSec: 0,
  };
}

function SessionForm({ draft }: { draft: SessionDraft }) {
  const { closeSession, jobs, activeCategories, categories, refresh, fail, toast } = useStore();
  const existing = draft.session;
  const [init] = useState(() => initial(draft));
  const [mode, setMode] = useState<Mode>(init.mode);
  const [jobId, setJobId] = useState<number | ''>(init.jobId);
  const [catId, setCatId] = useState<number | ''>(init.catId);
  const [date, setDate] = useState(init.date);
  const [start, setStart] = useState(init.start);
  const [end, setEnd] = useState(init.end);
  const [h, setH] = useState(init.h);
  const [m, setM] = useState(init.m);
  const [notes, setNotes] = useState(init.notes);
  const [idleSec, setIdleSec] = useState(init.idleSec);
  const [error, setError] = useState('');

  const jobOptions = useMemo(
    () => jobs.filter((j) => j.status !== 'archived' || j.id === jobId).sort((a, b) => b.job_number.localeCompare(a.job_number, undefined, { numeric: true })),
    [jobs, jobId],
  );
  const catOptions = useMemo(
    () => categories.filter((c) => !c.archived || c.id === catId),
    [categories, catId],
  );

  const computed = useMemo(() => {
    if (mode === 'range') {
      if (!date || !start || !end) return null;
      const s = fromInputs(date, start);
      let e = fromInputs(date, end);
      if (e <= s) e += 86400_000; // crossed midnight
      return { start_at: s, end_at: e };
    }
    const secs = (Number(h) || 0) * 3600 + (Number(m) || 0) * 60;
    if (!date || secs <= 0) return null;
    // Duration-only entries have no real clock times: anchor them at noon, or ending "now" for today.
    let s = existing?.source === 'manual_duration' && toDateInput(existing.start_at) === date ? existing.start_at : fromInputs(date, '12:00');
    if (s + secs * 1000 > Date.now() && date === toDateInput(Date.now())) s = Date.now() - secs * 1000;
    return { start_at: s, end_at: s + secs * 1000 };
  }, [mode, date, start, end, h, m, existing]);

  const rawSec = computed ? (computed.end_at - computed.start_at) / 1000 : 0;
  const netSec = Math.max(0, rawSec - (mode === 'range' ? idleSec : 0));

  const save = async () => {
    if (!jobId) return setError('Choose a job');
    if (!computed) return setError(mode === 'range' ? 'Enter a start and end time' : 'Enter a duration');
    if (computed.end_at > Date.now() + 60_000) return setError('That session ends in the future');
    if (rawSec > 16 * 3600) return setError('Sessions longer than 16 hours look like a mistake — check the times');
    const payload = {
      job_id: Number(jobId),
      category_id: catId === '' ? null : Number(catId),
      ...computed,
      notes: notes.trim(),
      source: mode === 'duration' ? 'manual_duration' : existing?.source === 'timer' ? 'timer' : 'manual',
    } as const;
    try {
      if (existing) {
        await api.updateSession(existing.id, { ...payload, idle_sec: mode === 'range' ? idleSec : 0 });
        toast('Session updated');
      } else {
        await api.createSession(payload);
        toast(`Added ${fmtDur(rawSec)}`);
      }
      closeSession();
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save'); }
  };

  const remove = async () => {
    if (!existing || !confirm('Delete this session permanently?')) return;
    try {
      await api.deleteSession(existing.id);
      closeSession();
      await refresh();
      toast('Session deleted');
    } catch (e) { fail(e); }
  };

  return (
    <Modal
      title={existing ? 'Edit session' : 'Add time manually'}
      sub={existing ? undefined : 'For when you forgot to start the timer.'}
      onClose={closeSession}
      footer={
        <>
          {existing && <button className="btn ghost danger" onClick={remove}>Delete</button>}
          {error && <span className="error-text">{error}</span>}
          <div className="spacer" />
          <button className="btn" onClick={closeSession}>Cancel</button>
          <button className="btn primary" onClick={() => void save()}>{existing ? 'Save' : 'Add session'} <Kbd>↵</Kbd></button>
        </>
      }
    >
      <div
        className="modal-body"
        onKeyDown={(e) => { if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement)) { e.preventDefault(); void save(); } }}
        style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        <div className="field">
          <label htmlFor="sm-job">Job</label>
          <select id="sm-job" className="select" value={jobId} onChange={(e) => setJobId(e.target.value ? Number(e.target.value) : '')} data-autofocus={!init.jobId || undefined}>
            <option value="">Choose a job…</option>
            {jobOptions.map((j) => <option key={j.id} value={j.id}>#{j.job_number} — {j.client} — {j.project_name}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="sm-cat">Category</label>
          <select id="sm-cat" className="select" value={catId} onChange={(e) => setCatId(e.target.value ? Number(e.target.value) : '')} data-autofocus={init.jobId ? true : undefined}>
            <option value="">Unlabeled</option>
            {(catOptions.length ? catOptions : activeCategories).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="seg" role="tablist">
            <button type="button" className={mode === 'range' ? 'on' : ''} onClick={() => setMode('range')}>Start & end time</button>
            <button type="button" className={mode === 'duration' ? 'on' : ''} onClick={() => setMode('duration')}>Duration only</button>
          </div>
          <div className="spacer" style={{ flex: 1 }} />
          <span className="muted">Total: <b className="mono" style={{ color: 'var(--text)' }}>{fmtDur(netSec)}</b></span>
        </div>
        <div className="form-row">
          <div className="field">
            <label htmlFor="sm-date">Date</label>
            <input id="sm-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          {mode === 'range' ? (
            <>
              <div className="field">
                <label htmlFor="sm-start">Start</label>
                <input id="sm-start" type="time" className="input" value={start} onChange={(e) => setStart(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="sm-end">End</label>
                <input id="sm-end" type="time" className="input" value={end} onChange={(e) => setEnd(e.target.value)} />
              </div>
            </>
          ) : (
            <>
              <div className="field">
                <label htmlFor="sm-h">Hours</label>
                <input id="sm-h" type="number" min={0} max={16} className="input" value={h} onChange={(e) => setH(e.target.value)} placeholder="0" />
              </div>
              <div className="field">
                <label htmlFor="sm-m">Minutes</label>
                <input id="sm-m" type="number" min={0} max={59} step={5} className="input" value={m} onChange={(e) => setM(e.target.value)} placeholder="45" />
              </div>
            </>
          )}
        </div>
        {mode === 'range' && idleSec > 0 && (
          <div className="chip warn" style={{ alignSelf: 'flex-start' }}>
            {fmtDur(idleSec)} idle time removed ·
            <button className="btn ghost sm" style={{ height: 18, padding: '0 4px', color: 'inherit' }} onClick={() => setIdleSec(0)}>restore</button>
          </div>
        )}
        <div className="field">
          <label htmlFor="sm-notes">Notes <span className="faint">(optional)</span></label>
          <input id="sm-notes" className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What did you work on?" />
        </div>
      </div>
    </Modal>
  );
}
