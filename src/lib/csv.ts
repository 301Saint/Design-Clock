import type { Session, Settings } from '../types';
import { hours, laborCost, roundSec, toDateInput } from './time';

const esc = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const hmm = (sec: number) => {
  const m = Math.round(sec / 60);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
};
const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export function sessionsToCsv(sessions: Session[], settings: Settings): string {
  const header = [
    'Job Number', 'Client', 'Project', 'Job Status', 'Session Date', 'Start Time', 'End Time',
    'Duration', 'Duration (hrs)', 'Category', 'Notes', 'Billable Duration', 'Billable (hrs)',
    'Rounding', 'Design Rate', 'Currency', 'Estimated Design Cost', 'Entry Type',
  ];
  const rows = [...sessions]
    .sort((a, b) => a.start_at - b.start_at)
    .map((s) => {
      const raw = s.duration_sec ?? 0;
      const bill = roundSec(raw, settings.rounding);
      const durationOnly = s.source === 'manual_duration';
      return [
        s.job_number, s.client, s.project_name, s.job_status, toDateInput(s.start_at),
        durationOnly ? '' : clock(s.start_at), durationOnly || !s.end_at ? '' : clock(s.end_at),
        hmm(raw), hours(raw).toFixed(2), s.category ?? 'Unlabeled', s.notes,
        hmm(bill), hours(bill).toFixed(2), settings.rounding, settings.hourlyRate.toFixed(2), settings.currency,
        laborCost(bill, settings.hourlyRate).toFixed(2),
        s.source === 'timer' ? 'Timer' : durationOnly ? 'Manual (duration)' : 'Manual',
      ].map(esc).join(',');
    });
  // BOM so Excel opens UTF-8 correctly
  return String.fromCharCode(0xfeff) + [header.join(','), ...rows].join('\r\n');
}

export function download(filename: string, content: BlobPart, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const stamp = () => toDateInput(Date.now());
