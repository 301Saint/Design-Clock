import { useEffect, useMemo, useRef, useState } from 'react';
import { Play, Plus, Search, Square } from 'lucide-react';
import { go, useStore } from '../store';
import { fmtDur, timeAgo } from '../lib/time';
import { STATUS_LABEL, type Job } from '../types';
import { Kbd } from './Modal';

/** Rank: exact job # > job # prefix > job # contains > client/project word match. */
export function searchJobs(jobs: Job[], q: string): Job[] {
  const query = q.trim().toLowerCase().replace(/^#/, '');
  if (!query) return jobs;
  const scored: [number, Job][] = [];
  for (const j of jobs) {
    const num = j.job_number.toLowerCase();
    const text = `${j.client} ${j.project_name}`.toLowerCase();
    let score = 0;
    if (num === query) score = 100;
    else if (num.startsWith(query)) score = 80;
    else if (num.includes(query)) score = 60;
    else {
      const terms = query.split(/\s+/);
      const hay = `${num} ${text}`;
      if (terms.every((t) => hay.includes(t))) {
        score = 30 + (j.client.toLowerCase().startsWith(terms[0]) ? 10 : 0) + (text.split(/\s+/).some((w) => w.startsWith(terms[0])) ? 5 : 0);
      }
    }
    if (j.status === 'archived') score -= 5;
    if (score > 0) scored.push([score, j]);
  }
  return scored.sort((a, b) => b[0] - a[0] || (b[1].last_worked_at ?? 0) - (a[1].last_worked_at ?? 0)).map((x) => x[1]);
}

export function SearchPalette() {
  const { search, closeSearch, jobs, startJob, stopTimer, running, openJobForm } = useStore();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (search.open) { setQ(''); setSel(0); requestAnimationFrame(() => inputRef.current?.focus()); }
  }, [search.open]);

  const results = useMemo(() => {
    const base = q.trim() ? jobs : jobs.filter((j) => j.status !== 'archived');
    return searchJobs(base, q).slice(0, 30);
  }, [jobs, q]);
  const showCreate = q.trim() && !results.some((j) => j.job_number.toLowerCase() === q.trim().replace(/^#/, '').toLowerCase());
  const count = results.length + (showCreate ? 1 : 0);

  useEffect(() => { setSel(0); }, [q]);
  useEffect(() => {
    listRef.current?.querySelector('.palette-item.on')?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  if (!search.open) return null;
  const startMode = search.mode === 'start';

  const act = (i: number, alt: boolean) => {
    if (i >= results.length) {
      closeSearch();
      const text = q.trim().replace(/^#/, '');
      openJobForm(undefined, /^\d[\w-]*$/.test(text) ? text : '');
      return;
    }
    const job = results[i];
    closeSearch();
    const doStart = startMode !== alt;
    if (doStart) startJob(job.id);
    else go(`jobs/${job.id}`);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => (s + 1) % Math.max(1, count)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => (s - 1 + count) % Math.max(1, count)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (count) act(sel, e.ctrlKey || e.shiftKey); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSearch(); }
  };

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) closeSearch(); }}>
      <div className="modal palette" role="dialog" aria-modal="true" aria-label="Search jobs">
        <div className="palette-input">
          <Search size={17} className="faint" />
          <input
            ref={inputRef}
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder={startMode ? 'Start a job — type job #, client or project…' : 'Search job #, client or project…'}
            aria-label="Search"
          />
          {startMode && <span className="chip" style={{ color: 'var(--go)' }}>Start mode</span>}
        </div>
        <div className="palette-list" ref={listRef}>
          {results.map((j, i) => {
            const isRunning = running?.job_id === j.id;
            return (
              <div
                key={j.id}
                className={`palette-item ${i === sel ? 'on' : ''}`}
                onMouseMove={() => setSel(i)}
                onClick={() => act(i, false)}
              >
                <span className="mono jobnum" style={{ minWidth: 52 }}>#{j.job_number}</span>
                <div className="grow">
                  <div className="title" style={{ fontWeight: 560 }}>{j.client}</div>
                  <div className="faint" style={{ fontSize: 12.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {j.project_name} · {STATUS_LABEL[j.status]} · {timeAgo(j.last_worked_at)}
                  </div>
                </div>
                <span className="mono dur faint">{fmtDur(j.total_sec)}</span>
                {isRunning ? (
                  <button className="start-pill stop" onClick={(e) => { e.stopPropagation(); closeSearch(); void stopTimer(); }}>
                    <Square size={11} fill="currentColor" /> STOP
                  </button>
                ) : (
                  <button className="start-pill" onClick={(e) => { e.stopPropagation(); closeSearch(); startJob(j.id); }}>
                    <Play size={11} fill="currentColor" /> START
                  </button>
                )}
              </div>
            );
          })}
          {showCreate && (
            <div className={`palette-item ${sel === results.length ? 'on' : ''}`} onMouseMove={() => setSel(results.length)} onClick={() => act(results.length, false)}>
              <Plus size={16} className="faint" />
              <div className="grow">Create new job “{q.trim()}”</div>
            </div>
          )}
          {!count && <div className="empty">No jobs yet</div>}
        </div>
        <div className="palette-foot">
          <span><Kbd>↑</Kbd><Kbd>↓</Kbd> navigate</span>
          <span><Kbd>↵</Kbd> {startMode ? 'start timer' : 'open job'}</span>
          <span><Kbd>Ctrl ↵</Kbd> {startMode ? 'open job' : 'start timer'}</span>
          <span><Kbd>Esc</Kbd> close</span>
        </div>
      </div>
    </div>
  );
}
