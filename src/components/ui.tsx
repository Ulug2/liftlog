import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Minus, Plus, X } from 'lucide-react';
import { WEEKDAY_LETTER, WEEK_ORDER } from '../utils/dates';

/* ---------------------------------- Sheet ---------------------------------- */

export function Sheet({
  open,
  onClose,
  title,
  children,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true">
        <div className="sheet__grip" />
        {title != null && (
          <div className="sheet__head">
            <div className="sheet__title">{title}</div>
            <button className="icon-btn" onClick={onClose} aria-label="Close">
              <X size={20} />
            </button>
          </div>
        )}
        <div className="sheet__body">{children}</div>
        {actions && <div className="sheet__actions">{actions}</div>}
      </div>
    </>,
    document.body,
  );
}

/** A sheet with a list of tappable actions (iOS action-sheet style). */
export function ActionSheet({
  open,
  onClose,
  title,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  actions: { label: string; icon?: ReactNode; onClick: () => void; danger?: boolean; hidden?: boolean }[];
}) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div className="action-list" style={{ margin: '0 -8px' }}>
        {actions
          .filter((a) => !a.hidden)
          .map((a) => (
            <button
              key={a.label}
              className={a.danger ? 'danger' : undefined}
              onClick={() => {
                onClose();
                a.onClick();
              }}
            >
              {a.icon}
              {a.label}
            </button>
          ))}
      </div>
    </Sheet>
  );
}

/* --------------------------------- Stepper --------------------------------- */

export function Stepper({
  value,
  onChange,
  step = 1,
  min = 0,
  max = 999,
  format = (v: number) => String(v),
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  format?: (v: number) => string;
  label?: string;
}) {
  return (
    <div className="stepper" aria-label={label}>
      <button type="button" aria-label={`Decrease ${label ?? ''}`} onClick={() => onChange(Math.max(min, value - step))}>
        <Minus size={18} />
      </button>
      <span className="stepper__value num">{format(value)}</span>
      <button type="button" aria-label={`Increase ${label ?? ''}`} onClick={() => onChange(Math.min(max, value + step))}>
        <Plus size={18} />
      </button>
    </div>
  );
}

/* -------------------------------- Segmented -------------------------------- */

export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="segmented" role="group">
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ----------------------------- Weekday picker ----------------------------- */

export function WeekdayPicker({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  return (
    <div className="weekday-picker">
      {WEEK_ORDER.map((d) => {
        const on = value.includes(d);
        return (
          <button
            key={d}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== d) : [...value, d].sort())}
          >
            {WEEKDAY_LETTER[d]}
          </button>
        );
      })}
    </div>
  );
}

/* ---------------------------------- Field ---------------------------------- */

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      {children}
    </label>
  );
}

/* ---------------------------------- Empty ---------------------------------- */

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty__icon">{icon}</div>
      <div className="empty__title">{title}</div>
      {children}
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="stat">
      <div className="stat__label">{label}</div>
      <div className="stat__value num">{value}</div>
      {sub != null && <div className="stat__sub">{sub}</div>}
    </div>
  );
}

/* ---------------------------------- Toast ---------------------------------- */

type ToastData = { id: number; message: string; action?: { label: string; onClick: () => void } } | null;
let toast: ToastData = null;
const toastListeners = new Set<() => void>();
let toastTimer: ReturnType<typeof setTimeout> | undefined;

export function showToast(message: string, action?: { label: string; onClick: () => void }) {
  toast = { id: Date.now(), message, action };
  toastListeners.forEach((l) => l());
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast = null;
    toastListeners.forEach((l) => l());
  }, 4000);
}

export function ToastHost() {
  const t = useSyncExternalStore(
    (fn) => {
      toastListeners.add(fn);
      return () => toastListeners.delete(fn);
    },
    () => toast,
  );
  if (!t) return null;
  return (
    <div className="toast" key={t.id} role="status">
      <span>{t.message}</span>
      {t.action && (
        <button
          className="text-btn"
          style={{ minHeight: 32 }}
          onClick={() => {
            t.action!.onClick();
            toast = null;
            toastListeners.forEach((l) => l());
          }}
        >
          {t.action.label}
        </button>
      )}
    </div>
  );
}

/** Re-render on an interval (for clocks). Values are always derived from timestamps. */
export function useNow(intervalMs = 1000, enabled = true) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const tick = () => setNow(Date.now());
    const id = setInterval(tick, intervalMs);
    const onVis = () => document.visibilityState === 'visible' && tick();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', tick);
    window.addEventListener('pageshow', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', tick);
      window.removeEventListener('pageshow', tick);
    };
  }, [intervalMs, enabled]);
  return now;
}
