import { useMemo, useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import { api } from '../api';
import { go, useData, useStore } from '../store';
import {
  addDays, addMonths, fmtDate, fmtDur, fromInputs, hours, laborCost, money, roundSec,
  startOfDay, startOfMonth, startOfWeek, toDateInput,
} from '../lib/time';
import { download, sessionsToCsv, stamp } from '../lib/csv';
import { ROUNDING_LABEL, STATUS_LABEL, type JobStatus, type Session } from '../types';

type Preset = 'today' | 'week' | 'lastweek' | 'month' | 'lastmonth' | 'year' | 'all' | 'custom';
type GroupBy = 'job' | 'client' | 'category' | 'day' | 'week' | 'month';

const PRESETS: [Preset, string][] = [
  ['today', 'Today'], ['week', 'This week'], ['lastweek', 'Last week'], ['month', 'This month'],
  ['lastmonth', 'Last month'], ['year', 'This year'], ['all', 'All time'], ['custom', 'Custom…'],
];
const GROUPS: [GroupBy, string][] = [['job', 'Job'], ['client', 'Client'], ['category', 'Category'], ['day', 'Day'], ['week', 'Week'], ['month', 'Month']];

function rangeFor(p: Preset, from: string, to: string): [number | undefined, number | undefined] {
  const now = Date.now();
  switch (p) {
    case 'today': return [startOfDay(now), undefined];
    case 'week': return [startOfWeek(now), undefined];
    case 'lastweek': return [addDays(startOfWeek(now), -7), startOfWeek(now)];
    case 'month': return [startOfMonth(now), undefined];
    case 'lastmonth': return [addMonths(startOfMonth(now), -1), startOfMonth(now)];
    case 'year': { const d = new Date(now); return [new Date(d.getFullYear(), 0, 1).getTime(), undefined]; }
    case 'all': return [undefined, undefined];
    case 'custom': return [from ? fromInputs(from) : undefined, to ? addDays(fromInputs(to), 1) : undefined];
  }
}

export function Reports() {
  const { settings, jobs, categories } = useStore();
  const [preset, setPreset] = useState<Preset>('month');
  const [from, setFrom] = useState(toDateInput(addDays(Date.now(), -30)));
  const [to, setTo] = useState(toDateInput(Date.now()));
  const [jobId, setJobId] = useState('');
  const [client, setClient] = useState('');
  const [catId, setCatId] = useState('');
  const [status, setStatus] = useState('');
  const [groupBy, setGroupBy] = useState<GroupBy>('job');

  const [rFrom, rTo] = rangeFor(preset, from, to);
  const [raw, loading] = useData(() => api.sessions({ from: rFrom, to: rTo }), [rFrom, rTo]);

  const clients = useMemo(() => [...new Set(jobs.map((j) => j.client))].sort((a, b) => a.localeCompare(b)), [jobs]);

  const sessions = useMemo(() => (raw ?? []).filter((s) =>
    (!jobId || s.job_id === Number(jobId)) &&
    (!client || s.client === client) &&
    (!catId || (catId === 'none' ? s.category_id == null : s.category_id === Number(catId))) &&
    (!status || s.job_status === status)), [raw, jobId, client, catId, status]);

  const totals = useMemo(() => {
    let sec = 0, bill = 0;
    const jobSet = new Set<number>();
    for (const s of sessions) {
      sec += s.duration_sec ?? 0;
      bill += roundSec(s.duration_sec ?? 0, settings.rounding);
      jobSet.add(s.job_id);
    }
    return { sec, bill, jobs: jobSet.size, revenue: laborCost(bill, settings.hourlyRate) };
  }, [sessions, settings]);

  const groups = useMemo(() => {
    const m = new Map<string, { key: string; label: string; sub?: string; sort: number | string; sec: number; bill: number; n: number; link?: string }>();
    for (const s of sessions) {
      let key: string, label: string, sub: string | undefined, sort: number | string, link: string | undefined;
      switch (groupBy) {
        case 'job': key = `j${s.job_id}`; label = `#${s.job_number} ${s.client}`; sub = s.project_name; sort = 0; link = `jobs/${s.job_id}`; break;
        case 'client': key = `c${s.client_id}`; label = s.client; sort = 0; break;
        case 'category': key = `k${s.category_id ?? 'none'}`; label = s.category ?? 'Unlabeled'; sort = 0; break;
        case 'day': { const d = startOfDay(s.start_at); key = `d${d}`; label = fmtDate(d, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }); sort = -d; break; }
        case 'week': { const d = startOfWeek(s.start_at); key = `w${d}`; label = `Week of ${fmtDate(d, { month: 'short', day: 'numeric', year: 'numeric' })}`; sort = -d; break; }
        case 'month': { const d = startOfMonth(s.start_at); key = `m${d}`; label = fmtDate(d, { month: 'long', year: 'numeric' }); sort = -d; break; }
      }
      const g = m.get(key) ?? { key, label, sub, sort, sec: 0, bill: 0, n: 0, link };
      g.sec += s.duration_sec ?? 0;
      g.bill += roundSec(s.duration_sec ?? 0, settings.rounding);
      g.n++;
      m.set(key, g);
    }
    const list = [...m.values()];
    const byTime = ['job', 'client', 'category'].includes(groupBy);
    return list.sort((a, b) => (byTime ? b.sec - a.sec : (a.sort as number) - (b.sort as number)));
  }, [sessions, groupBy, settings.rounding]);
  const maxSec = Math.max(1, ...groups.map((g) => g.sec));

  const exportCsv = () => {
    const name = `design-time-report-${preset === 'custom' ? `${from}_to_${to}` : preset}-${stamp()}.csv`;
    download(name, sessionsToCsv(sessions as Session[], settings));
  };

  const filtersActive = jobId || client || catId || status;

  return (
    <div className="page">
      <div className="page-head">
        <h1>Reports</h1>
        <div className="spacer" />
        <button className="btn" onClick={exportCsv} disabled={!sessions.length}><FileSpreadsheet size={15} /> Export CSV ({sessions.length})</button>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 14 }}>
          <div className="toolbar">
            <div className="seg" style={{ flexWrap: 'wrap' }}>
              {PRESETS.map(([k, l]) => <button key={k} className={preset === k ? 'on' : ''} onClick={() => setPreset(k)}>{l}</button>)}
            </div>
            {preset === 'custom' && (
              <>
                <input type="date" className="input" style={{ width: 150 }} value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
                <span className="faint">to</span>
                <input type="date" className="input" style={{ width: 150 }} value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
              </>
            )}
          </div>
          <div className="form-grid">
            <select className="select" value={jobId} onChange={(e) => setJobId(e.target.value)} aria-label="Job">
              <option value="">All jobs</option>
              {[...jobs].sort((a, b) => b.job_number.localeCompare(a.job_number, undefined, { numeric: true }))
                .map((j) => <option key={j.id} value={j.id}>#{j.job_number} {j.client}</option>)}
            </select>
            <select className="select" value={client} onChange={(e) => setClient(e.target.value)} aria-label="Client">
              <option value="">All clients</option>
              {clients.map((c) => <option key={c}>{c}</option>)}
            </select>
            <select className="select" value={catId} onChange={(e) => setCatId(e.target.value)} aria-label="Category">
              <option value="">All categories</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              <option value="none">Unlabeled</option>
            </select>
            <select className="select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Job status">
              <option value="">Any job status</option>
              {(Object.keys(STATUS_LABEL) as JobStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </div>
          {filtersActive && (
            <div><button className="btn ghost sm" onClick={() => { setJobId(''); setClient(''); setCatId(''); setStatus(''); }}>Clear filters</button></div>
          )}
        </div>
      </div>

      <div className="stat-row" style={{ marginBottom: 16 }}>
        <div className="card stat"><div className="label">Total hours</div><div className="value mono">{hours(totals.sec).toFixed(2)}</div><div className="sub">{fmtDur(totals.sec)} · {sessions.length} sessions</div></div>
        <div className="card stat"><div className="label">Billable design hours</div><div className="value mono">{hours(totals.bill).toFixed(2)}</div><div className="sub">{ROUNDING_LABEL[settings.rounding]}</div></div>
        <div className="card stat"><div className="label">Estimated design revenue</div><div className="value">{money(totals.revenue, settings)}</div><div className="sub">@ {money(settings.hourlyRate, settings)}/hr</div></div>
        <div className="card stat"><div className="label">Average time per job</div><div className="value mono">{fmtDur(totals.jobs ? totals.sec / totals.jobs : 0)}</div><div className="sub">across {totals.jobs} job{totals.jobs === 1 ? '' : 's'}</div></div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Grouped by</h2>
          <div className="seg">
            {GROUPS.map(([k, l]) => <button key={k} className={groupBy === k ? 'on' : ''} onClick={() => setGroupBy(k)}>{l}</button>)}
          </div>
        </div>
        <div className="card-body" style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>{GROUPS.find((g) => g[0] === groupBy)![1]}</th>
                <th className="hide-sm" style={{ width: '28%' }} />
                <th className="r">Sessions</th>
                <th className="r">Hours</th>
                <th className="r">Billable</th>
                <th className="r">Est. revenue</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.key} className={g.link ? 'click' : ''} onClick={() => g.link && go(g.link)}>
                  <td>
                    <div style={{ fontWeight: 560 }}>{g.label}</div>
                    {g.sub && <div className="faint" style={{ fontSize: 12.5 }}>{g.sub}</div>}
                  </td>
                  <td className="hide-sm"><div className="bar"><span style={{ width: `${(g.sec / maxSec) * 100}%` }} /></div></td>
                  <td className="r muted">{g.n}</td>
                  <td className="r mono">{fmtDur(g.sec)}</td>
                  <td className="r mono">{hours(g.bill).toFixed(2)}h</td>
                  <td className="r">{money(laborCost(g.bill, settings.hourlyRate), settings)}</td>
                </tr>
              ))}
            </tbody>
            {groups.length > 1 && (
              <tfoot>
                <tr>
                  <td>Total</td><td className="hide-sm" />
                  <td className="r">{sessions.length}</td>
                  <td className="r mono">{fmtDur(totals.sec)}</td>
                  <td className="r mono">{hours(totals.bill).toFixed(2)}h</td>
                  <td className="r">{money(totals.revenue, settings)}</td>
                </tr>
              </tfoot>
            )}
          </table>
          {!groups.length && <div className="empty">{loading ? 'Loading…' : 'No sessions match these filters.'}</div>}
        </div>
      </div>
    </div>
  );
}
