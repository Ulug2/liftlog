import { useRef, useState } from 'react';
import { Check, Copy, Trash2, Trophy } from 'lucide-react';
import type { ExerciseType, WeightUnit, WorkoutSet } from '../types/models';
import { NumberField } from './NumberField';
import { ActionSheet } from './ui';
import { fmtNum, fromDisplay, toDisplay } from '../utils/units';
import { unlockAudio } from '../utils/audio';

type Col = 'weight' | 'reps' | 'time' | 'distance';

export function columnsFor(type: ExerciseType): Col[] {
  switch (type) {
    case 'bodyweight':
      return ['reps'];
    case 'time':
      return ['time'];
    case 'distance':
      return ['distance', 'time'];
    default:
      return ['weight', 'reps'];
  }
}

function requiredFor(type: ExerciseType): Col[] {
  return type === 'distance' ? ['distance'] : columnsFor(type);
}

export function fmtSet(s: Pick<WorkoutSet, 'weight_kg' | 'reps' | 'duration_seconds' | 'distance_m'>, type: ExerciseType, unit: WeightUnit): string {
  switch (type) {
    case 'bodyweight':
      return s.reps != null ? `${s.reps} reps` : '–';
    case 'weighted_bodyweight':
      return `+${fmtNum(toDisplay(s.weight_kg ?? 0, unit), 2)} × ${s.reps ?? '–'}`;
    case 'time':
      return s.duration_seconds != null ? `${s.duration_seconds}s` : '–';
    case 'distance':
      return [s.distance_m != null ? `${fmtNum(s.distance_m, 0)} m` : null, s.duration_seconds != null ? `${s.duration_seconds}s` : null].filter(Boolean).join(' · ') || '–';
    default:
      return s.weight_kg == null && s.reps == null ? '–' : `${fmtNum(toDisplay(s.weight_kg, unit), 2)} × ${s.reps ?? '–'}`;
  }
}

const header = (c: Col, type: ExerciseType, unit: WeightUnit) =>
  c === 'weight' ? (type === 'weighted_bodyweight' ? `+${unit}` : unit) : c === 'reps' ? 'Reps' : c === 'time' ? 'Sec' : 'Meters';

export function SetTable({
  sets,
  type,
  unit,
  previous,
  prSetIds = new Set(),
  mode,
  onUpdate,
  onToggle,
  onRemove,
  onApplyRemaining,
  repPlaceholder,
}: {
  sets: WorkoutSet[];
  type: ExerciseType;
  unit: WeightUnit;
  previous?: WorkoutSet[];
  prSetIds?: Set<string>;
  mode: 'live' | 'edit';
  onUpdate: (id: string, patch: Partial<WorkoutSet>) => void;
  onToggle: (set: WorkoutSet) => void;
  onRemove: (set: WorkoutSet) => void;
  onApplyRemaining?: (set: WorkoutSet) => void;
  repPlaceholder?: string;
}) {
  const cols = columnsFor(type);
  const showPrev = mode === 'live';
  const [menuSet, setMenuSet] = useState<WorkoutSet | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const grid = `${showPrev ? '36px minmax(0,1fr)' : '36px'} ${cols.map(() => 'minmax(0,1fr)').join(' ')} 48px`;

  const tryToggle = (s: WorkoutSet) => {
    unlockAudio();
    if (!s.completed) {
      // Don't record an empty set — jump to the first missing value instead.
      const missing = requiredFor(type).find((c) => valueOf(s, c) == null);
      if (missing) {
        const el = tableRef.current?.querySelector<HTMLInputElement>(`#f-${missing}-${s.id}`);
        el?.focus();
        return;
      }
    }
    onToggle(s);
  };

  return (
    <div className="set-table" ref={tableRef}>
      <div className="set-row set-row--head" style={{ gridTemplateColumns: grid }}>
        <span>Set</span>
        {showPrev && <span>Previous</span>}
        {cols.map((c) => (
          <span key={c} className="center">
            {header(c, type, unit)}
          </span>
        ))}
        <span className="center">{mode === 'live' ? '' : 'Done'}</span>
      </div>
      {sets.map((s, i) => {
        const prev = previous?.[i];
        return (
          <div key={s.id} className={`set-row${s.completed ? ' is-done' : ''}`} style={{ gridTemplateColumns: grid }}>
            <button
              className="set-num"
              onClick={() => {
                const canApply = !!onApplyRemaining && sets.some((x) => x.set_number > s.set_number && !x.completed);
                const canRemove = !(mode === 'live' && s.completed);
                if (canApply || canRemove) setMenuSet(s);
              }}
              aria-label={`Set ${s.set_number} options`}
            >
              {prSetIds.has(s.id) ? <Trophy size={14} className="accent" /> : s.set_number}
            </button>
            {showPrev && <span className="set-prev num">{prev ? fmtSet(prev, type, unit) : '–'}</span>}
            {cols.map((c) => (
              <NumberField
                key={c}
                id={`f-${c}-${s.id}`}
                className="set-input num"
                label={`Set ${s.set_number} ${header(c, type, unit)}`}
                decimal={c === 'weight' || c === 'distance'}
                value={c === 'weight' ? toDisplay(s.weight_kg, unit) : valueOf(s, c)}
                placeholder={c === 'reps' ? repPlaceholder ?? '0' : c === 'weight' ? '0' : '–'}
                onChange={(v) => onUpdate(s.id, patchFor(c, v, unit))}
              />
            ))}
            <button
              className={`set-check${s.completed ? ' is-done' : ''}`}
              onClick={() => tryToggle(s)}
              aria-label={s.completed ? `Undo set ${s.set_number}` : `Complete set ${s.set_number}`}
              aria-pressed={s.completed}
            >
              <Check size={20} strokeWidth={3} />
            </button>
          </div>
        );
      })}
      <ActionSheet
        open={!!menuSet}
        onClose={() => setMenuSet(null)}
        title={menuSet ? `Set ${menuSet.set_number}` : ''}
        actions={
          menuSet
            ? [
                {
                  label: 'Apply to remaining sets',
                  icon: <Copy size={20} />,
                  hidden: !onApplyRemaining || !sets.some((x) => x.set_number > menuSet.set_number && !x.completed),
                  onClick: () => onApplyRemaining?.(menuSet),
                },
                {
                  label: 'Remove set',
                  icon: <Trash2 size={20} />,
                  danger: true,
                  hidden: mode === 'live' && menuSet.completed,
                  onClick: () => onRemove(menuSet),
                },
              ]
            : []
        }
      />
    </div>
  );
}

function valueOf(s: WorkoutSet, c: Col): number | null {
  if (c === 'weight') return s.weight_kg;
  if (c === 'reps') return s.reps;
  if (c === 'time') return s.duration_seconds;
  return s.distance_m;
}

function patchFor(c: Col, v: number | null, unit: WeightUnit): Partial<WorkoutSet> {
  if (c === 'weight') return { weight_kg: fromDisplay(v, unit) };
  if (c === 'reps') return { reps: v == null ? null : Math.round(v) };
  if (c === 'time') return { duration_seconds: v == null ? null : Math.round(v) };
  return { distance_m: v };
}
