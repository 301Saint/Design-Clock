import type { Rounding, Settings } from '../types';

/** "4h 37m", "48m", "0m". Seconds are dropped except under a minute when `showSeconds`. */
export function fmtDur(sec: number, showSeconds = false): string {
  const s = Math.max(0, Math.round(sec));
  if (showSeconds && s < 60) return `${s}s`;
  const total = Math.round(s / 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Long form for session rows: "37 minutes", "1 hr 12 min". */
export function fmtDurLong(sec: number): string {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'}`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} hr ${r} min` : `${h} hr${h === 1 ? '' : 's'}`;
}

/** Stopwatch display: "1:04:09" / "04:09". */
export function fmtClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(r).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Decimal hours for CSV / reports: 1.25 */
export const hours = (sec: number) => Math.round((sec / 3600) * 100) / 100;

export function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function fmtDate(ms: number, opts: Intl.DateTimeFormatOptions = { month: 'numeric', day: 'numeric', year: '2-digit' }): string {
  return new Date(ms).toLocaleDateString([], opts);
}

export function fmtDay(ms: number): string {
  const d = new Date(ms);
  const today = startOfDay(Date.now());
  const day = startOfDay(ms);
  if (day === today) return 'Today';
  if (day === startOfDay(addDays(today, -1))) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

export function timeAgo(ms: number | null, now = Date.now()): string {
  if (!ms) return 'Never';
  const diff = Math.max(0, now - ms) / 1000;
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) {
    const h = Math.floor(diff / 3600);
    return `${h} hr${h === 1 ? '' : 's'} ago`;
  }
  const d = Math.floor(diff / 86400);
  if (d === 1) return 'Yesterday';
  if (d < 14) return `${d} days ago`;
  return fmtDate(ms, { month: 'short', day: 'numeric' });
}

// ------------------------------------------------------------- dates
export function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
export function addDays(ms: number, n: number): number {
  const d = new Date(ms);
  d.setDate(d.getDate() + n);
  return d.getTime();
}
/** Weeks start on Monday. */
export function startOfWeek(ms: number): number {
  const d = new Date(startOfDay(ms));
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow);
  return d.getTime();
}
export function startOfMonth(ms: number): number {
  const d = new Date(startOfDay(ms));
  d.setDate(1);
  return d.getTime();
}
export function addMonths(ms: number, n: number): number {
  const d = new Date(ms);
  d.setMonth(d.getMonth() + n);
  return d.getTime();
}

/** yyyy-mm-dd in local time, for <input type="date"> */
export function toDateInput(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** hh:mm in local time, for <input type="time"> */
export function toTimeInput(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
export function fromInputs(date: string, time = '00:00'): number {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  return new Date(y, mo - 1, d, h || 0, mi || 0, 0, 0).getTime();
}

// ------------------------------------------------------------- billing
/**
 * Billable time is ALWAYS derived from raw seconds; raw records are never changed.
 * Rounding is applied per session (each work session is a billable entry).
 */
export function roundSec(sec: number, rule: Rounding): number {
  if (sec <= 0) return 0;
  const min = sec / 60;
  switch (rule) {
    case 'nearest15': return Math.round(min / 15) * 15 * 60;
    case 'nearest30': return Math.round(min / 30) * 30 * 60;
    case 'up15': return Math.ceil(min / 15) * 15 * 60;
    case 'up30': return Math.ceil(min / 30) * 30 * 60;
    default: return sec;
  }
}

export function billableSec(sessions: { duration_sec: number | null }[], rule: Rounding): number {
  return sessions.reduce((a, s) => a + roundSec(s.duration_sec ?? 0, rule), 0);
}

export function laborCost(sec: number, rate: number): number {
  return Math.round((sec / 3600) * rate * 100) / 100;
}

export function money(amount: number, settings: Pick<Settings, 'currency'>): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: settings.currency || 'USD' }).format(amount);
  } catch {
    return `${settings.currency} ${amount.toFixed(2)}`;
  }
}
