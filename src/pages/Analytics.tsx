import { useMemo, useState } from 'react';
import { api } from '../api';
import { go, useData, useStore } from '../store';
import { addDays, addMonths, fmtDate, fmtDur, laborCost, money, roundSec, startOfWeek } from '../lib/time';
import type { Session } from '../types';

type Scope = '90' | '365' | 'all';

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const isRevision = (name: string | null) => !!name && /revision/i.test(name);

export function Analytics() {
  const { settings, jobs } = useStore();
  const [scope, setScope] = useState<Scope>('365');
  const from = scope === 'all' ? undefined : scope === '90' ? addDays(Date.now(), -90) : addMonths(Date.now(), -12);
  const fromKey = from ? Math.floor(from / 3600_000) : 0; // stable within the hour
  const [data, loading] = useData(() => api.sessions({ from }), [fromKey]);
  const sessions = data ?? [];

  const a = useMemo(() => {
    const byJob = new Map<number, Session[]>();
    for (const s of sessions) byJob.set(s.job_id, [...(byJob.get(s.job_id) ?? []), s]);
    const jobTotal = (list: Session[]) => list.reduce((t, s) => t + (s.duration_sec ?? 0), 0);

    const completedIds = new Set(jobs.filter((j) => j.status === 'completed' || j.status === 'archived').map((j) => j.id));
    const completedTotals = [...byJob.entries()].filter(([id]) => completedIds.has(id)).map(([, l]) => jobTotal(l));
    const allTotals = [...byJob.values()].map(jobTotal);

    // Per category: session lengths, and total per job that used it
    const cat = new Map<string, { sessions: number[]; perJob: Map<number, number> }>();
    for (const s of sessions) {
      const k = s.category ?? 'Unlabeled';
      const c = cat.get(k) ?? { sessions: [] as number[], perJob: new Map<number, number>() };
      c.sessions.push(s.duration_sec ?? 0);
      c.perJob.set(s.job_id, (c.perJob.get(s.job_id) ?? 0) + (s.duration_sec ?? 0));
      cat.set(k, c);
    }
    const grand = sessions.reduce((t, s) => t + (s.duration_sec ?? 0), 0);
    const categories = [...cat.entries()].map(([name, c]) => ({
      name,
      nSessions: c.sessions.length,
      nJobs: c.perJob.size,
      avgSession: avg(c.sessions),
      avgPerJob: avg([...c.perJob.values()]),
      medianPerJob: median([...c.perJob.values()]),
      total: c.sessions.reduce((x, y) => x + y, 0),
      share: grand ? c.sessions.reduce((x, y) => x + y, 0) / grand : 0,
    })).sort((x, y) => y.total - x.total);

    const revisionSessions = sessions.filter((s) => isRevision(s.category));
    const revisionRounds = [...byJob.entries()].filter(([id]) => completedIds.has(id)).map(([, l]) => l.filter((s) => isRevision(s.category)).length);
    const revisionSec = revisionSessions.reduce((t, s) => t + (s.duration_sec ?? 0), 0);

    // Weekly hours, last 12 weeks
    const weeks: { start: number; sec: number }[] = [];
    const thisWeek = startOfWeek(Date.now());
    for (let i = 11; i >= 0; i--) weeks.push({ start: addDays(thisWeek, -7 * i), sec: 0 });
    for (const s of sessions) {
      const w = weeks.find((x) => startOfWeek(s.start_at) === x.start);
      if (w) w.sec += s.duration_sec ?? 0;
    }

    const completedJobs = jobs
      .filter((j) => completedIds.has(j.id) && byJob.has(j.id))
      .map((j) => {
        const list = byJob.get(j.id)!;
        const sec = jobTotal(list);
        const bill = list.reduce((t, s) => t + roundSec(s.duration_sec ?? 0, settings.rounding), 0);
        return { job: j, sec, bill, revisions: list.filter((s) => isRevision(s.category)).length, sessions: list.length };
      })
      .sort((x, y) => (y.job.updated_at ?? 0) - (x.job.updated_at ?? 0));

    return {
      avgCompleted: avg(completedTotals), medianCompleted: median(completedTotals), nCompleted: completedTotals.length,
      avgAllJobs: avg(allTotals), nJobs: allTotals.length,
      avgRevisionSession: avg(revisionSessions.map((s) => s.duration_sec ?? 0)),
      avgRevisionRounds: avg(revisionRounds),
      revisionShare: grand ? revisionSec / grand : 0,
      categories, weeks, completedJobs,
    };
  }, [sessions, jobs, settings.rounding]);

  const maxWeek = Math.max(1, ...a.weeks.map((w) => w.sec));
  const initial = a.categories.find((c) => c.name === 'Initial Design');

  return (
    <div className="page">
      <div className="page-head">
        <h1>Analytics</h1>
        <span className="muted">How long design work actually takes — use it to quote design fees.</span>
        <div className="spacer" />
        <div className="seg">
          {([['90', 'Last 90 days'], ['365', 'Last 12 months'], ['all', 'All time']] as [Scope, string][]).map(([k, l]) => (
            <button key={k} className={scope === k ? 'on' : ''} onClick={() => setScope(k)}>{l}</button>
          ))}
        </div>
      </div>

      <div className="stat-row" style={{ marginBottom: 16 }}>
        <div className="card stat">
          <div className="label">Avg total design time per completed job</div>
          <div className="value mono">{fmtDur(a.avgCompleted)}</div>
          <div className="sub">median {fmtDur(a.medianCompleted)} · {a.nCompleted} completed job{a.nCompleted === 1 ? '' : 's'} · ≈ {money(laborCost(a.avgCompleted, settings.hourlyRate), settings)}</div>
        </div>
        <div className="card stat">
          <div className="label">Average Initial Design (per job)</div>
          <div className="value mono">{fmtDur(initial?.avgPerJob ?? 0)}</div>
          <div className="sub">{initial ? `${initial.nJobs} jobs · avg session ${fmtDur(initial.avgSession)}` : 'No Initial Design sessions yet'}</div>
        </div>
        <div className="card stat">
          <div className="label">Average revision session</div>
          <div className="value mono">{fmtDur(a.avgRevisionSession)}</div>
          <div className="sub">{a.avgRevisionRounds.toFixed(1)} revision sessions per completed job · {Math.round(a.revisionShare * 100)}% of all time</div>
        </div>
        <div className="card stat">
          <div className="label">Avg design time per job (all)</div>
          <div className="value mono">{fmtDur(a.avgAllJobs)}</div>
          <div className="sub">{a.nJobs} jobs with tracked time</div>
        </div>
      </div>

      <div className="grid dash-grid" style={{ marginBottom: 16 }}>
        <section className="card">
          <div className="card-head"><h2>Typical time by type of work</h2></div>
          <div className="card-body" style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th className="r" title="Average total of this category per job that used it">Avg per job</th>
                  <th className="r">Median per job</th>
                  <th className="r">Avg session</th>
                  <th className="r">Jobs</th>
                  <th className="r">Share</th>
                </tr>
              </thead>
              <tbody>
                {a.categories.map((c) => (
                  <tr key={c.name}>
                    <td style={{ fontWeight: 560, color: c.name === 'Unlabeled' ? 'var(--warn)' : undefined }}>{c.name}</td>
                    <td className="r mono">{fmtDur(c.avgPerJob)}</td>
                    <td className="r mono muted">{fmtDur(c.medianPerJob)}</td>
                    <td className="r mono muted">{fmtDur(c.avgSession)}</td>
                    <td className="r muted">{c.nJobs}</td>
                    <td className="r muted">{Math.round(c.share * 100)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!a.categories.length && <div className="empty">{loading ? 'Loading…' : 'No sessions in this period.'}</div>}
          </div>
        </section>

        <section className="card">
          <div className="card-head"><h2>Hours per week</h2></div>
          <div className="card-body">
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 150 }}>
              {a.weeks.map((w) => (
                <div key={w.start} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, height: '100%', justifyContent: 'flex-end' }} title={`Week of ${fmtDate(w.start)}: ${fmtDur(w.sec)}`}>
                  <span className="faint mono" style={{ fontSize: 10 }}>{w.sec ? Math.round(w.sec / 3600) : ''}</span>
                  <div style={{ width: '100%', height: `${(w.sec / maxWeek) * 110}px`, minHeight: w.sec ? 3 : 0, background: 'var(--accent)', borderRadius: 4, opacity: 0.85 }} />
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              {a.weeks.map((w, i) => (
                <span key={w.start} className="faint" style={{ flex: 1, fontSize: 10, textAlign: 'center' }}>{i % 3 === 0 ? fmtDate(w.start, { month: 'numeric', day: 'numeric' }) : ''}</span>
              ))}
            </div>
          </div>
        </section>
      </div>

      <section className="card">
        <div className="card-head"><h2>Completed jobs — actual design time</h2></div>
        <div className="card-body" style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr><th>Job</th><th>Project</th><th className="r">Sessions</th><th className="r">Revision sessions</th><th className="r">Design time</th><th className="r">Design labor</th></tr>
            </thead>
            <tbody>
              {a.completedJobs.map((c) => (
                <tr key={c.job.id} className="click" onClick={() => go(`jobs/${c.job.id}`)}>
                  <td><span className="mono jobnum">#{c.job.job_number}</span> {c.job.client}</td>
                  <td className="muted">{c.job.project_name}</td>
                  <td className="r muted">{c.sessions}</td>
                  <td className="r muted">{c.revisions}</td>
                  <td className="r mono">{fmtDur(c.sec)}</td>
                  <td className="r">{money(laborCost(c.bill, settings.hourlyRate), settings)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!a.completedJobs.length && <div className="empty">Mark jobs as Completed to build up quoting history.</div>}
        </div>
      </section>
    </div>
  );
}
