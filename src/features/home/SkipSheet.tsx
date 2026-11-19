import { useState } from 'react';
import { Check } from 'lucide-react';
import { Sheet } from '../../components/ui';
import { SKIP_REASONS, skipDay } from '../../lib/actions';
import type { RoutineDay, SkipReason } from '../../types/models';

/** Record a skipped scheduled workout. Never creates a workout or moves the schedule. */
export function SkipSheet({ open, onClose, dateKey, day }: { open: boolean; onClose: () => void; dateKey: string; day: RoutineDay | null }) {
  const [reason, setReason] = useState<SkipReason | null>(null);
  const [note, setNote] = useState('');
  const close = () => {
    setReason(null);
    setNote('');
    onClose();
  };
  return (
    <Sheet
      open={open}
      onClose={close}
      title={`Skip ${day?.name ?? 'workout'}`}
      actions={
        <button
          className="btn btn--primary btn--lg"
          onClick={() => {
            skipDay(dateKey, day?.id ?? null, reason, note);
            close();
          }}
        >
          Mark as skipped
        </button>
      }
    >
      <p className="muted" style={{ marginBottom: 12, fontSize: 14 }}>
        Your schedule stays the same. Reason is optional.
      </p>
      <div className="list" style={{ marginBottom: 12 }}>
        {SKIP_REASONS.map((r) => (
          <button key={r.value} className="list-row" style={{ minHeight: 50 }} onClick={() => setReason(reason === r.value ? null : r.value)}>
            <span className="list-row__main">{r.label}</span>
            {reason === r.value && <Check size={18} className="accent" />}
          </button>
        ))}
      </div>
      <textarea className="textarea" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
    </Sheet>
  );
}
