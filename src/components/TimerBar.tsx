import { useEffect } from 'react';
import { Play, Plus, Search, Square, Trash2, ListPlus } from 'lucide-react';
import { go, useNow, useStore } from '../store';
import { fmtClock } from '../lib/time';
import { Kbd } from './Modal';

export function TimerBar() {
  const { running, jobs, startJob, stopTimer, discardTimer, openSearch, openJobForm, openSession, focusJobId } = useStore();
  const now = useNow(1000);
  const elapsed = running ? (now - running.start_at) / 1000 - running.idle_sec : 0;

  // Elapsed time in the window/taskbar title so it's visible from other apps.
  useEffect(() => {
    document.title = running ? `● ${fmtClock(elapsed)} · #${running.job_number} ${running.client}` : 'Design Clock';
  }, [running, Math.floor(elapsed)]); // eslint-disable-line react-hooks/exhaustive-deps

  const next = jobs.find((j) => j.id === focusJobId) ?? jobs.find((j) => j.last_worked_at && j.status !== 'archived');

  return (
    <header className={`timerbar ${running ? 'running' : ''}`}>
      {running ? (
        <>
          <span className="live-dot" aria-hidden />
          <div className="tb-job" onClick={() => go(`jobs/${running.job_id}`)} style={{ cursor: 'pointer' }} title="Open job">
            <div className="tb-line1">
              <span className="tb-num mono">#{running.job_number}</span>
              <span className="tb-client">{running.client}</span>
            </div>
            <div className="tb-project">{running.project_name}</div>
          </div>
          <div className="tb-elapsed mono num" aria-live="off">{fmtClock(elapsed)}</div>
          <button className="big-btn stop" onClick={() => void stopTimer()} title="Stop (Space / Alt+S)">
            <Square size={17} fill="currentColor" /> STOP
          </button>
          <button
            className="btn ghost icon"
            title="Discard this timer (started by mistake)"
            onClick={() => { if (confirm('Discard the running timer? This time will not be recorded.')) void discardTimer(); }}
          >
            <Trash2 size={16} />
          </button>
        </>
      ) : (
        <>
          <div className="tb-job">
            <div className="tb-idle-title">No timer running</div>
            <div className="tb-project">
              {next ? <>Next: <span className="mono jobnum">#{next.job_number}</span> {next.client} — {next.project_name}</> : 'Create a job to start tracking'}
            </div>
          </div>
          <div className="tb-elapsed mono num">00:00</div>
          <button
            className="big-btn start"
            onClick={() => (next ? startJob(next.id) : openSearch('start'))}
            title={next ? `Start #${next.job_number} (Space / Alt+S)` : 'Pick a job'}
          >
            <Play size={17} fill="currentColor" /> START
          </button>
          <button className="btn" onClick={() => openSearch('start')} title="Start a different job">Pick job…</button>
        </>
      )}
      <div className="tb-actions">
        <button className="search-trigger" onClick={() => openSearch('open')}>
          <Search size={15} /> <span className="label">Search jobs</span> <Kbd>Ctrl K</Kbd>
        </button>
        <button className="btn icon" onClick={() => openSession({ jobId: running?.job_id ?? focusJobId ?? undefined })} title="Add time manually (M)">
          <ListPlus size={16} />
        </button>
        <button className="btn primary" onClick={() => openJobForm()} title="New job (N)">
          <Plus size={16} /> <span className="label">New Job</span>
        </button>
      </div>
    </header>
  );
}
