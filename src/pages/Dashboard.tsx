import { useMemo } from 'react';
import { Play, Square, Tag } from 'lucide-react';
import { api } from '../api';
import { go, useData, useNow, useStore } from '../store';
import { billableSec, fmtDur, laborCost, money, startOfDay, startOfWeek, timeAgo } from '../lib/time';
import { SessionList } from '../components/SessionList';
import type { Job, Session } from '../types';

export function Dashboard() {
  const { jobs, running, startJob, stopTimer, settings, labelQueue, openLabel } = useStore();
  const now = useNow(1000);
  const dayStart = startOfDay(now);
  const weekStart = startOfWeek(now);
  const [week] = useData(() => api.sessions({ from: weekStart }), [weekStart]);
  const [unlabeled] = useData(() => api.sessions({ unlabeled: true, limit: 50 }), []);

  const runningSec = running ? Math.max(0, (now - running.start_at) / 1000 - running.idle_sec) : 0;
  const today = useMemo(() => (week ?? []).filter((s) => s.start_at >= dayStart), [week, dayStart]);
  const todaySec = today.reduce((a, s) => a + (s.duration_sec ?? 0), 0) + (running && running.start_at >= dayStart ? runningSec : 0);
  const weekSec = (week ?? []).reduce((a, s) => a + (s.duration_sec ?? 0), 0) + (running ? runningSec : 0);
  const todayBillable = billableSec(today, settings.rounding);

  // Per-job totals for today (including the live timer)
  const byJob = useMemo(() => {
    const m = new Map<number, { job_id: number; job_number: string; client: string; project: string; sec: number }>();
    const add = (s: Session, sec: number) => {
      const cur = m.get(s.job_id) ?? { job_id: s.job_id, job_number: s.job_number, client: s.client, project: s.project_name, sec: 0 };
      cur.sec += sec;
      m.set(s.job_id, cur);
    };
    for (const s of today) add(s, s.duration_sec ?? 0);
    if (running && running.start_at >= dayStart) add(running, runningSec);
    return [...m.values()].sort((a, b) => b.sec - a.sec);
  }, [today, running, runningSec, dayStart]);
  const maxJob = Math.max(1, ...byJob.map((j) => j.sec));

  const recent = useMemo(() => {
    const worked = jobs.filter((j) => j.status !== 'archived' && j.status !== 'completed' && j.last_worked_at);
    const fresh = jobs.filter((j) => j.status === 'active' && !j.last_worked_at);
    return [...fresh.slice(0, 3), ...worked].slice(0, 9);
  }, [jobs]);

  const pending = (unlabeled ?? []).filter((s) => !labelQueue.some((q) => q.session.id === s.id));

  return (
    <div className="page">
      {pending.length > 0 && (
        <div className="notice">
          <Tag size={16} />
          <div className="grow">{pending.length} session{pending.length === 1 ? '' : 's'} still need{pending.length === 1 ? 's' : ''} a label</div>
          <button className="btn sm" onClick={() => pending.forEach(openLabel)}>Label now</button>
        </div>
      )}

      <div className="stat-row" style={{ marginBottom: 16 }}>
        <div className="card stat">
          <div className="label">Today</div>
          <div className="value mono">{fmtDur(todaySec)}</div>
          <div className="sub">{today.length + (running ? 1 : 0)} session{today.length + (running ? 1 : 0) === 1 ? '' : 's'} · {byJob.length} job{byJob.length === 1 ? '' : 's'}</div>
        </div>
        <div className="card stat">
          <div className="label">This week</div>
          <div className="value mono">{fmtDur(weekSec)}</div>
          <div className="sub">since Monday</div>
        </div>
        <div className="card stat">
          <div className="label">Today’s design labor</div>
          <div className="value">{money(laborCost(todayBillable, settings.hourlyRate), settings)}</div>
          <div className="sub">{fmtDur(todayBillable)} billable @ {money(settings.hourlyRate, settings)}/hr</div>
        </div>
      </div>

      <div className="grid dash-grid">
        <section className="card">
          <div className="card-head"><h2>Recent jobs</h2><div className="spacer" /><button className="btn ghost sm" onClick={() => go('jobs')}>All jobs →</button></div>
          <div className="card-body list">
            {recent.map((j) => <RecentJob key={j.id} job={j} isRunning={running?.job_id === j.id} liveSec={running?.job_id === j.id ? runningSec : 0}
              onStart={() => startJob(j.id)} onStop={() => void stopTimer()} />)}
            {!recent.length && <div className="empty">No jobs yet — press <b>N</b> to create one.</div>}
          </div>
        </section>

        <section className="card">
          <div className="card-head"><h2>Today’s time</h2></div>
          <div className="card-body">
            <div className="today-hero"><span className="big mono">{fmtDur(todaySec)}</span><span className="muted">tracked today</span></div>
            <div style={{ marginTop: 10 }}>
              {byJob.map((j) => (
                <div key={j.job_id} className="row" onClick={() => go(`jobs/${j.job_id}`)} style={{ padding: '6px 10px' }}>
                  <div className="grow">
                    <div className="title" style={{ fontWeight: 520 }}><span className="mono jobnum">#{j.job_number}</span> {j.client} <span className="faint">— {j.project}</span></div>
                    <div className="bar" style={{ marginTop: 5 }}><span style={{ width: `${(j.sec / maxJob) * 100}%` }} /></div>
                  </div>
                  <span className="mono dur">{fmtDur(j.sec)}</span>
                </div>
              ))}
              {!byJob.length && <div className="empty">Nothing tracked yet today.</div>}
            </div>
          </div>
        </section>
      </div>

      <section className="card" style={{ marginTop: 16 }}>
        <div className="card-head"><h2>Today’s sessions</h2></div>
        <div className="card-body">
          {running && running.start_at >= dayStart && (
            <div className="session-row is-running" style={{ background: 'var(--go-soft)' }}>
              <div className="when">Running now</div>
              <div><span className="mono jobnum">#{running.job_number}</span> {running.client} <span className="faint">— {running.project_name}</span></div>
              <span className="mono dur">{fmtDur(runningSec, true)}</span>
            </div>
          )}
          <SessionList sessions={today} empty={running ? '' : 'No sessions yet today. Pick a job and hit START.'} />
        </div>
      </section>
    </div>
  );
}

function RecentJob({ job, isRunning, liveSec, onStart, onStop }: { job: Job; isRunning: boolean; liveSec: number; onStart: () => void; onStop: () => void }) {
  return (
    <div className={`row recent-job ${isRunning ? 'is-running' : ''}`} onClick={() => go(`jobs/${job.id}`)}>
      <div className="grow">
        <div className="title"><span className="mono jobnum">#{job.job_number}</span> {job.client}</div>
        <div className="sub">{job.project_name}</div>
      </div>
      <div className="meta">
        <div className="mono dur">{fmtDur(job.total_sec + liveSec)}</div>
        <div className="faint" style={{ fontSize: 12 }}>{isRunning ? <span style={{ color: 'var(--go)' }}>Running</span> : timeAgo(job.last_worked_at)}</div>
      </div>
      {isRunning ? (
        <button className="start-pill stop" onClick={(e) => { e.stopPropagation(); onStop(); }}><Square size={11} fill="currentColor" /> STOP</button>
      ) : (
        <button className="start-pill" onClick={(e) => { e.stopPropagation(); onStart(); }}><Play size={11} fill="currentColor" /> START</button>
      )}
    </div>
  );
}
