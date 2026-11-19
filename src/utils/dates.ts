/** Local calendar date as YYYY-MM-DD (not UTC — a 9pm workout stays on the right day). */
export function localDateKey(d: Date | string | number = new Date()): string {
  const x = new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, '0');
  const day = String(x.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function dateFromKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Monday-based start of week */
export function startOfWeek(d = new Date()): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (x.getDay() + 6) % 7; // Mon=0
  x.setDate(x.getDate() - dow);
  return x;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function fmtDuration(totalSeconds: number | null | undefined, alwaysHours = true): string {
  if (totalSeconds == null || totalSeconds < 0) return '–';
  const s = Math.floor(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  if (h > 0 || alwaysHours) return `${String(h).padStart(2, '0')}:${mm}:${ss}`;
  return `${m}:${ss}`;
}

/** 1h 12m / 48m */
export function fmtDurationShort(totalSeconds: number | null | undefined): string {
  if (totalSeconds == null) return '–';
  const m = Math.round(totalSeconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, '0')}m`;
}

export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function fmtRest(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  return s === 0 ? `${m}:00` : `${m}:${String(s).padStart(2, '0')}`;
}

export function fmtDate(d: Date | string, opts: Intl.DateTimeFormatOptions = { month: 'long', day: 'numeric' }) {
  return new Date(d).toLocaleDateString(undefined, opts);
}

export function fmtRelativeDay(d: Date | string): string {
  const key = localDateKey(d);
  const today = localDateKey();
  const yesterday = localDateKey(addDays(new Date(), -1));
  if (key === today) return 'Today';
  if (key === yesterday) return 'Yesterday';
  const x = new Date(d);
  const sameYear = x.getFullYear() === new Date().getFullYear();
  return x.toLocaleDateString(undefined, sameYear ? { month: 'long', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
}

export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const WEEKDAY_LETTER = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
/** Display order Monday → Sunday */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

export function greeting(d = new Date()): string {
  const h = d.getHours();
  if (h < 5) return 'Good evening';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

/** Today / Yesterday / Nov 16 — compact for list trailing text */
export function fmtShortDay(d: Date | string): string {
  const r = fmtRelativeDay(d);
  if (r === 'Today' || r === 'Yesterday') return r;
  return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** "Good evening, Sir!" */
export function greetSir(d = new Date()): string {
  return `${greeting(d)}, Sir!`;
}
