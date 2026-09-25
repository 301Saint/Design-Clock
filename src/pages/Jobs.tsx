import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Play, Plus, Search, Square } from 'lucide-react';
import { go, useNow, useStore } from '../store';
import { fmtDate, fmtDur, timeAgo } from '../lib/time';
import { searchJobs } from '../components/SearchPalette';
import { STATUS_LABEL, type Job, type JobStatus } from '../types';

type Filter = JobStatus | 'open' | 'all';
type SortKey = 'job_number' | 'client' | 'project_name' | 'total_sec' | 'last_worked_at' | 'created_at';

export function Jobs() {
  const { jobs, running, startJob, stopTimer, openJobForm } = useStore();
  const [filter, setFilter] = useState<Filter>('open');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'last_worked_at', dir: -1 });
  const now = useNow(30_000);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: jobs.length, open: 0 };
    for (const j of jobs) {
      c[j.status] = (c[j.status] ?? 0) + 1;
      if (j.status === 'active' || j.status === 'on_hold') c.open++;
    }
    return c;
  }, [jobs]);

  const rows = useMemo(() => {
    let list = jobs.filter((j) => filter === 'all' || (filter === 'open' ? j.status === 'active' || j.status === 'on_hold' : j.status === filter));
    if (q.trim()) return searchJobs(list, q);
    list = [...list].sort((a, b) => {
      const av = a[sort.key] ?? 0;
      const bv = b[sort.key] ?? 0;
      const cmp = typeof av === 'string' ? av.localeCompare(bv as string, undefined, { numeric: true }) : (av as number) - (bv as number);
      return cmp * sort.dir;
    });
    return list;
  }, [jobs, filter, q, sort]);

  const th = (key: SortKey, label: string, cls = '') => (
    <th className={`sortable ${cls}`} onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === 'client' || key === 'project_name' ? 1 : -1 }))}>
      {label} {sort.key === key && !q && (sort.dir === 1 ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
    </th>
  );

  const FILTERS: [Filter, string][] = [['open', 'Open'], ['active', 'Active'], ['on_hold', 'On Hold'], ['completed', 'Completed'], ['archived', 'Archived'], ['all', 'All']];

  return (
    <div className="page">
      <div className="page-head">
        <h1>Jobs</h1>
        <div className="seg">
          {FILTERS.map(([k, label]) => (
            <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>
              {label} <span className="faint">{counts[k] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="spacer" />
        <div style={{ position: 'relative' }}>
          <Search size={14} className="faint" style={{ position: 'absolute', left: 10, top: 10 }} />
          <input className="input" style={{ paddingLeft: 30, width: 240 }} placeholder="Filter jobs…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <button className="btn primary" onClick={() => openJobForm()}><Plus size={15} /> New Job</button>
      </div>

      <div className="card" style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              {th('job_number', 'Job #')}
              {th('client', 'Client')}
              {th('project_name', 'Project')}
              <th>Status</th>
              {th('total_sec', 'Design time', 'r')}
              {th('last_worked_at', 'Last worked', 'hide-sm')}
              {th('created_at', 'Created', 'hide-sm')}
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((j: Job) => {
              const isRunning = running?.job_id === j.id;
              const live = isRunning ? Math.max(0, (now - running!.start_at) / 1000 - running!.idle_sec) : 0;
              return (
                <tr key={j.id} className="click" onClick={() => go(`jobs/${j.id}`)} style={isRunning ? { background: 'var(--go-soft)' } : undefined}>
                  <td className="mono jobnum">#{j.job_number}</td>
                  <td style={{ fontWeight: 560 }}>{j.client}</td>
                  <td className="muted">{j.project_name}</td>
                  <td><span className={`status ${j.status}`}>{STATUS_LABEL[j.status]}</span></td>
                  <td className="r mono dur">{fmtDur(j.total_sec + live)}</td>
                  <td className="muted hide-sm">{isRunning ? <span style={{ color: 'var(--go)' }}>Running</span> : timeAgo(j.last_worked_at, now)}</td>
                  <td className="faint hide-sm">{fmtDate(j.created_at)}</td>
                  <td className="r" style={{ width: 90 }}>
                    {isRunning ? (
                      <button className="start-pill stop" onClick={(e) => { e.stopPropagation(); void stopTimer(); }}><Square size={11} fill="currentColor" /> STOP</button>
                    ) : (
                      <button className="start-pill" onClick={(e) => { e.stopPropagation(); startJob(j.id); }}><Play size={11} fill="currentColor" /> START</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!rows.length && <div className="empty">{q ? 'No matching jobs.' : 'No jobs in this view.'}</div>}
      </div>
    </div>
  );
}
