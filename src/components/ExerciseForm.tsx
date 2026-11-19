import { useState } from 'react';
import type { Exercise, ExerciseType, WeightUnit } from '../types/models';
import { Field, Segmented } from './ui';

export const EQUIPMENT = [
  'Barbell',
  'Dumbbell',
  'Machine',
  'Cable',
  'Smith machine',
  'EZ bar',
  'Trap bar',
  'Kettlebell',
  'Bodyweight',
  'Band',
  'Other',
];

export const EXERCISE_TYPES: { value: ExerciseType; label: string; hint: string }[] = [
  { value: 'weight', label: 'Weight × reps', hint: 'Bench press, rows, curls' },
  { value: 'bodyweight', label: 'Bodyweight reps', hint: 'Push-ups, pull-ups' },
  { value: 'weighted_bodyweight', label: 'Weighted bodyweight', hint: 'Weighted dips — log the added load' },
  { value: 'time', label: 'Time', hint: 'Plank, dead hang' },
  { value: 'distance', label: 'Distance + time', hint: 'Sled push, carries, run' },
];

export const typeLabel = (t: ExerciseType) => EXERCISE_TYPES.find((x) => x.value === t)?.label ?? t;

export interface ExerciseDraft {
  name: string;
  equipment: string | null;
  category: string | null;
  exercise_type: ExerciseType;
  weight_unit: WeightUnit | null;
  notes: string | null;
}

export function ExerciseForm({
  initial,
  onSubmit,
  submitLabel = 'Save',
  extra,
}: {
  initial?: Partial<Exercise>;
  onSubmit: (d: ExerciseDraft) => void;
  submitLabel?: string;
  extra?: React.ReactNode;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [equipment, setEquipment] = useState<string>(initial?.equipment ?? '');
  const [category, setCategory] = useState(initial?.category ?? '');
  const [type, setType] = useState<ExerciseType>(initial?.exercise_type ?? 'weight');
  const [unit, setUnit] = useState<'default' | WeightUnit>(initial?.weight_unit ?? 'default');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const hint = EXERCISE_TYPES.find((t) => t.value === type)?.hint;

  return (
    <form
      className="stack"
      style={{ gap: 14 }}
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        onSubmit({
          name: name.trim(),
          equipment: equipment || null,
          category: category.trim() || null,
          exercise_type: type,
          weight_unit: unit === 'default' ? null : unit,
          notes: notes.trim() || null,
        });
      }}
    >
      <Field label="Name">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Incline Bench Press" required />
      </Field>
      <div className="field-grid">
        <Field label="Equipment">
          <select className="select" value={equipment} onChange={(e) => setEquipment(e.target.value)}>
            <option value="">None</option>
            {EQUIPMENT.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Type">
          <select className="select" value={type} onChange={(e) => setType(e.target.value as ExerciseType)}>
            {EXERCISE_TYPES.map((x) => (
              <option key={x.value} value={x.value}>
                {x.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {hint && <p className="faint" style={{ fontSize: 13, marginTop: -6 }}>{hint}</p>}
      <Field label="Category (optional grouping)">
        <input className="input" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Chest fly" />
      </Field>
      {(type === 'weight' || type === 'weighted_bodyweight') && (
        <Field label="Weight unit for this exercise">
          <Segmented
            value={unit}
            onChange={setUnit}
            options={[
              { value: 'default', label: 'Default' },
              { value: 'lb', label: 'lb' },
              { value: 'kg', label: 'kg' },
            ]}
          />
        </Field>
      )}
      <Field label="Notes">
        <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Form cues, seat height…" rows={2} />
      </Field>
      <p className="faint" style={{ fontSize: 13 }}>
        Different machines, grips or equipment should be separate exercises — their weights are never compared.
      </p>
      <button className="btn btn--primary btn--lg btn--block" type="submit" disabled={!name.trim()}>
        {submitLabel}
      </button>
      {extra}
    </form>
  );
}
