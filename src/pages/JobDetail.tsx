import { useEffect, useMemo } from 'react';
import { ArrowLeft, ListPlus, Pencil, Play, Square, Trash2 } from 'lucide-react';
import { api } from '../api';
import { go, useData, useNow, useStore } from '../store';
import { billableSec, fmtDate, fmtDur, hours, laborCost, money, timeAgo } from '../lib/time';
import { SessionList } from '../components/SessionList';
import { ROUNDING_LABEL, STATUS_LABEL, type JobStatus } from '../types';

export function JobDetail({ id }: { id: number }) {
  const { jobs, running, startJob, stopTimer, openJobForm, openSession, settings, setFocusJobId, refresh, fail, toast } = useStore();
  const job = jobs.find((j) => j.id === id);
  const [sessions, loading] = useData(() => api.sessions({ jobId: id }), [id]);
  const now = useNow(1000);

  // Space / Alt+S on this page starts *this* job.
  useEffect(() => { setFocusJobId(id); return () => setFocusJobId(null); }, [id, setFocusJobId]);

  const isRunning = running?.job_id === id;
  const liveSec = isRunning ? Math.max(0, (now - running!.start_at) / 1000 - running!.idle_sec) : 0;
  const list = sessions ?? [];
  const rawSec = list.reduce((a, s) => a + (s.duration_sec ?? 0), 0) + liveSec;
  const billSec = billableSec(list, settings.rounding) + liveSec; // live timer counts raw until stopped
  const cost = laborCost(billSec, settings.hourlyRate);

  const breakdown = useMemo(() => {
    const m = new Map<string, { sec: number; n: number }>();
    for (const s of list) {
      const k = s.category ?? 'Unlabeled';
      const cur = m.get(k) ?? { sec: 0, n: 0 };
      cur.sec += s.duration_sec ?? 0;
      cur.n++;
      m.set(k, cur);
    }
    return [...m.entries()].sort((a, b) => b[1].sec - a[1].sec);
  }, [list]);
  const maxCat = Math.max(1, ...breakdown.map(([, v]) => v.sec));

  if (!job) {
    return (
      <div className="page">
        <div className="empty">{loading ? 'Loading…' : 'Job not found.'} <button className="btn sm" onClick={() => go('jobs')}>Back to jobs</button></div>
      </div>
    );
  }

  const setStatus = async (status: JobStatus) => {
    try { await api.updateJob(job.id, { status }); await refresh(); toast(`Marked ${STATUS_LABEL[status]}`); } catch (e) { fail(e); }
  };
  const del = async () => {
    const answer = prompt(`Delete job #${job.job_number} and all ${job.session_count} of its sessions? This cannot be undone.\n\nType the job number to confirm:`);
    if (answer?.replace('#', '').trim() !== job.job_number) return;
    try { await api.deleteJob(job.id); go('jobs'); await refresh(); toast('Job deleted'); } catch (e) { fail(e); }
  };

  return (
    <div className="page">
      <div className="page-head" style={{ alignItems: 'flex-start' }}>
        <button className="btn ghost icon" onClick={() => history.length > 1 ? history.back() : go('jobs')} title="Back"><ArrowLeft size={16} /></button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <h1><span className="mono jobnum">#{job.job_number}</span> {job.client}</h1>
            <select className="select" style={{ width: 130, height: 28 }} value={job.status} onChange={(e) => void setStatus(e.target.value as JobStatus)} aria-label="Status">
              {(Object.keys(STATUS_LABEL) as JobStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </div>
          <div className="muted" style={{ fontSize: 15, marginTop: 2 }}>{job.project_name}</div>
        </div>
        <button className="btn" onClick={() => openJobForm(job)}><Pencil size={14} /> Edit</button>
        <button className="btn" onClick={() => openSession({ jobId: job.id })}><ListPlus size={15} /> Add time</button>
        {isRunning ? (
          <button className="big-btn stop" style={{ height: 40, minWidth: 110, fontSize: 14 }} onClick={() => void stopTimer()}><Square size={14} fill="currentColor" /> STOP</button>
        ) : (
          <button className="big-btn start" style={{ height: 40, minWidth: 110, fontSize: 14 }} onClick={() => startJob(job.id)}><Play size={14} fill="currentColor" /> START</button>
        )}
      </div>

      <div className="stat-row" style={{ marginBottom: 16 }}>
        <div className="card stat">
          <div className="label">Total design time</div>
          <div className="value mono" style={{ fontSize: 30 }}>{fmtDur(rawSec)}</div>
          <div className="sub">{hours(rawSec).toFixed(2)} hrs · {list.length + (isRunning ? 1 : 0)} sessions</div>
        </div>
        <div className="card stat">
          <div className="label">Billable design time</div>
          <div className="value mono">{fmtDur(billSec)}</div>
          <div className="sub">{ROUNDING_LABEL[settings.rounding]}{settings.rounding !== 'exact' ? ' (per session)' : ''}</div>
        </div>
        <div className="card stat">
          <div className="label">Estimated design labor</div>
          <div className="value money">{money(cost, settings)}</div>
          <div className="sub">{hours(billSec).toFixed(2)} hrs × {money(settings.hourlyRate, settings)}/hr</div>
        </div>
      </div>

      <div className="grid dash-grid">
        <section className="card">
          <div className="card-head"><h2>Sessions</h2><div className="spacer" /><span className="faint" style={{ fontSize: 12 }}>Double-click a session to edit</span></div>
          <div className="card-body">
            {isRunning && (
              <div className="session-row" style={{ background: 'var(--go-soft)' }}>
                <div className="when">Running now</div>
                <div className="muted">Label it when you stop</div>
                <span className="mono dur">{fmtDur(liveSec, true)}</span>
              </div>
            )}
            <SessionList sessions={list} showJob={false} showBillable empty={loading ? 'Loading…' : 'No time tracked yet. Hit START when you begin.'} />
          </div>
        </section>

        <div className="grid" style={{ gap: 16 }}>
          <section className="card">
            <div className="card-head"><h2>Time by category</h2></div>
            <div className="card-body">
              {breakdown.map(([name, v]) => (
                <div key={name} className="breakdown-row">
                  <span style={{ fontWeight: 520, color: name === 'Unlabeled' ? 'var(--warn)' : undefined }}>{name} <span className="faint">×{v.n}</span></span>
                  <div className="bar"><span style={{ width: `${(v.sec / maxCat) * 100}%` }} /></div>
                  <span className="mono dur" style={{ textAlign: 'right' }}>{fmtDur(v.sec)}</span>
                </div>
              ))}
              {!breakdown.length && <div className="empty">No sessions yet</div>}
            </div>
          </section>

          <section className="card">
            <div className="card-head"><h2>Job info</h2></div>
            <div className="card-body">
              <dl className="kv">
                <dt>Job #</dt><dd className="mono">{job.job_number}</dd>
                <dt>Client</dt><dd>{job.client}</dd>
                <dt>Project</dt><dd>{job.project_name}</dd>
                <dt>Status</dt><dd><span className={`status ${job.status}`}>{STATUS_LABEL[job.status]}</span></dd>
                <dt>Created</dt><dd>{fmtDate(job.created_at, { month: 'short', day: 'numeric', year: 'numeric' })}</dd>
                <dt>Last worked</dt><dd>{isRunning ? 'Now' : timeAgo(job.last_worked_at)}</dd>
                <dt>Notes</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{job.notes || <span className="faint">—</span>}</dd>
              </dl>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
                <button className="btn ghost sm danger" onClick={() => void del()}><Trash2 size={13} /> Delete job</button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
