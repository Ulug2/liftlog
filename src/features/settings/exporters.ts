import type { AppState } from '../../lib/db';
import { alive, workoutIndex } from '../../lib/queries';
import { TABLES } from '../../types/models';
import { localDateKey } from '../../utils/dates';
import { toDisplay } from '../../utils/units';

async function deliver(filename: string, content: string, type: string) {
  const file = new File([content], filename, { type });
  // On iPhone the share sheet is the friendliest way to save a file.
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: filename });
      return;
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') return;
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function exportJson(s: AppState) {
  const data: Record<string, unknown> = { app: 'LiftLog', format: 1, exported_at: new Date().toISOString(), profile: s.profile };
  for (const t of TABLES) data[t] = Object.values(s.tables[t]);
  return deliver(`liftlog-backup-${localDateKey()}.json`, JSON.stringify(data, null, 2), 'application/json');
}

const csvCell = (v: unknown) => {
  if (v == null) return '';
  const str = String(v);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
};

export function exportCsv(s: AppState) {
  const idx = workoutIndex(s.tables);
  const unit = s.profile.weight_unit;
  const rows: unknown[][] = [
    ['date', 'workout', 'exercise', 'equipment', 'set', `weight_${unit}`, 'reps', 'duration_seconds', 'distance_m', 'completed', 'exercise_notes', 'workout_duration_seconds'],
  ];
  for (const session of [...idx.completed].reverse()) {
    for (const we of idx.weBySession.get(session.id) ?? []) {
      for (const set of alive(Object.fromEntries((idx.setsByWe.get(we.id) ?? []).map((x) => [x.id, x])))) {
        rows.push([
          localDateKey(session.started_at),
          session.workout_name_snapshot,
          we.exercise_name_snapshot,
          we.equipment_snapshot,
          set.set_number,
          toDisplay(set.weight_kg, unit),
          set.reps,
          set.duration_seconds,
          set.distance_m,
          set.completed ? 'yes' : 'no',
          we.notes,
          session.duration_seconds,
        ]);
      }
    }
  }
  return deliver(`liftlog-sets-${localDateKey()}.csv`, rows.map((r) => r.map(csvCell).join(',')).join('\n'), 'text/csv');
}
