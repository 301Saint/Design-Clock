import { Pencil, Play, Tag, Trash2 } from 'lucide-react';
import { api } from '../api';
import { go, useStore } from '../store';
import { fmtDate, fmtDay, fmtDur, fmtDurLong, fmtTime, startOfDay, roundSec } from '../lib/time';
import type { Session } from '../types';

/** Sessions grouped by day, newest first, with inline edit/delete. */
export function SessionList({ sessions, showJob = true, showBillable = false, empty = 'No sessions yet' }: {
  sessions: Session[];
  showJob?: boolean;
  showBillable?: boolean;
  empty?: string;
}) {
  const { openSession, openLabel, startJob, refresh, fail, toast, settings } = useStore();
  if (!sessions.length) return <div className="empty">{empty}</div>;

  const groups: { day: number; items: Session[] }[] = [];
  for (const s of sessions) {
    const day = startOfDay(s.start_at);
    const g = groups[groups.length - 1];
    if (g && g.day === day) g.items.push(s);
    else groups.push({ day, items: [s] });
  }

  const del = async (s: Session) => {
    if (!confirm(`Delete this ${fmtDurLong(s.duration_sec ?? 0)} session?`)) return;
    try {
      await api.deleteSession(s.id);
      await refresh();
      toast('Session deleted', {
        label: 'Undo',
        run: () => {
          api.createSession({ job_id: s.job_id, category_id: s.category_id, start_at: s.start_at, end_at: s.end_at!, notes: s.notes, source: s.source === 'manual_duration' ? 'manual_duration' : 'manual' })
            .then(async (n) => { if (s.idle_sec || s.source === 'timer') await api.updateSession(n.id, { idle_sec: s.idle_sec, source: s.source }); await refresh(); })
            .catch(fail);
        },
      });
    } catch (e) { fail(e); }
  };

  return (
    <div className="list">
      {groups.map((g) => {
        const total = g.items.reduce((a, s) => a + (s.duration_sec ?? 0), 0);
        return (
          <div key={g.day}>
            <div className="day-head">
              <span>{fmtDay(g.day)} <span className="faint" style={{ fontWeight: 500 }}>· {fmtDate(g.day)}</span></span>
              <span className="mono">{fmtDur(total)}</span>
            </div>
            {g.items.map((s) => (
              <div key={s.id} className="session-row" onDoubleClick={() => openSession({ session: s })}>
                <div className="when num">
                  {s.source === 'manual_duration' ? <span className="faint">Duration entry</span> : <>{fmtTime(s.start_at)} – {fmtTime(s.end_at!)}</>}
                  <div className="faint" style={{ fontSize: 12 }}>{fmtDurLong(s.duration_sec ?? 0)}</div>
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    {s.category ? <span style={{ fontWeight: 580 }}>{s.category}</span> : (
                      <button className="chip warn" style={{ cursor: 'pointer' }} onClick={() => openLabel(s)}><Tag size={11} /> Needs label</button>
                    )}
                    {showJob && (
                      <a className="muted" href={`#/jobs/${s.job_id}`} onClick={(e) => { e.preventDefault(); go(`jobs/${s.job_id}`); }} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        <span className="mono jobnum">#{s.job_number}</span> {s.client} — {s.project_name}
                      </a>
                    )}
                    {s.source !== 'timer' && <span className="chip" style={{ height: 18, fontSize: 11 }}>manual</span>}
                    {s.idle_sec > 0 && <span className="chip" style={{ height: 18, fontSize: 11 }} title="Idle time removed">−{fmtDur(s.idle_sec)} idle</span>}
                  </div>
                  {s.notes && <div className="session-note">“{s.notes}”</div>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {showBillable && settings.rounding !== 'exact' && (
                    <span className="faint mono" title="Billable (rounded)" style={{ fontSize: 12 }}>{fmtDur(roundSec(s.duration_sec ?? 0, settings.rounding))} bill.</span>
                  )}
                  <span className="mono dur">{fmtDur(s.duration_sec ?? 0)}</span>
                  <div className="actions">
                    {showJob && <button className="btn ghost sm icon" title="Resume this job" onClick={() => startJob(s.job_id)}><Play size={13} /></button>}
                    <button className="btn ghost sm icon" title="Edit" onClick={() => openSession({ session: s })}><Pencil size={13} /></button>
                    <button className="btn ghost sm icon" title="Delete" onClick={() => void del(s)}><Trash2 size={13} /></button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
