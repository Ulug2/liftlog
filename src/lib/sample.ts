/**
 * Optional demo data so the app can be explored before real use.
 * Creates a 5-day routine plus ~6 weeks of realistic history.
 */
import type { ExerciseType } from '../types/models';
import { batch, insert, setProfile } from './db';
import { addDays, localDateKey } from '../utils/dates';
import { KG_PER_LB } from '../utils/units';

type Spec = [name: string, equipment: string | null, type: ExerciseType, sets: number, min: number, max: number, rest: number, startLb: number, stepLb: number, notes?: string];

const DAYS: { name: string; focus: string; weekdays: number[]; exercises: Spec[] }[] = [
  {
    name: 'Push',
    focus: 'Chest · Shoulders · Triceps',
    weekdays: [1],
    exercises: [
      ['Barbell Bench Press', 'Barbell', 'weight', 4, 6, 8, 180, 145, 5, 'Keep shoulder blades retracted'],
      ['Incline Dumbbell Press', 'Dumbbell', 'weight', 3, 8, 10, 120, 50, 2.5],
      ['Seated Shoulder Press', 'Machine', 'weight', 3, 8, 10, 120, 90, 5],
      ['Cable Fly', 'Cable', 'weight', 3, 10, 12, 90, 30, 2.5],
      ['Lateral Raise', 'Dumbbell', 'weight', 3, 12, 15, 60, 17.5, 0],
      ['Triceps Pushdown', 'Cable', 'weight', 3, 10, 12, 90, 50, 2.5],
    ],
  },
  {
    name: 'Pull',
    focus: 'Back · Biceps · Rear delts',
    weekdays: [2],
    exercises: [
      ['Pull-Up', 'Bodyweight', 'bodyweight', 3, 6, 10, 150, 0, 0],
      ['Barbell Row', 'Barbell', 'weight', 4, 6, 8, 150, 135, 5],
      ['Lat Pulldown', 'Cable', 'weight', 3, 8, 10, 120, 120, 5],
      ['Seated Cable Row', 'Cable', 'weight', 3, 10, 12, 90, 110, 5],
      ['Barbell Curl', 'EZ bar', 'weight', 3, 8, 12, 90, 55, 2.5],
    ],
  },
  {
    name: 'Legs',
    focus: 'Quads · Hamstrings · Calves',
    weekdays: [3],
    exercises: [
      ['Back Squat', 'Barbell', 'weight', 4, 5, 8, 210, 185, 5],
      ['Romanian Deadlift', 'Barbell', 'weight', 3, 8, 10, 150, 155, 5],
      ['Leg Press', 'Machine', 'weight', 3, 10, 12, 120, 270, 10],
      ['Leg Curl', 'Machine', 'weight', 3, 10, 12, 90, 80, 5],
      ['Plank', null, 'time', 3, 0, 0, 60, 0, 0],
    ],
  },
  {
    name: 'Upper Body',
    focus: 'Chest · Back · Arms',
    weekdays: [5],
    exercises: [
      ['Incline Bench Press', 'Barbell', 'weight', 3, 6, 8, 150, 125, 5],
      ['Chest-Supported Row', 'Machine', 'weight', 3, 8, 10, 120, 100, 5],
      ['Machine Fly', 'Machine', 'weight', 3, 10, 12, 90, 90, 5],
      ['Weighted Dip', 'Bodyweight', 'weighted_bodyweight', 3, 6, 10, 120, 25, 2.5],
      ['Hammer Curl', 'Dumbbell', 'weight', 3, 10, 12, 60, 30, 2.5],
    ],
  },
  {
    name: 'Lower Body',
    focus: 'Posterior chain',
    weekdays: [6],
    exercises: [
      ['Deadlift', 'Barbell', 'weight', 3, 3, 5, 240, 245, 10],
      ['Bulgarian Split Squat', 'Dumbbell', 'weight', 3, 8, 10, 120, 35, 2.5],
      ['Leg Extension', 'Machine', 'weight', 3, 12, 15, 90, 100, 5],
      ['Standing Calf Raise', 'Machine', 'weight', 4, 10, 15, 60, 140, 10],
    ],
  },
];

const lb = (v: number) => v * KG_PER_LB;

export function loadSampleData() {
  batch(() => {
    setProfile({ weight_unit: 'lb', default_rest_seconds: 120 });
    const routine = insert('routines', { name: 'My Split', description: null, archived_at: null });
    setProfile({ active_routine_id: routine.id });
    const exIds = new Map<string, string>();
    const dayRows = DAYS.map((d, i) => {
      const day = insert('routine_days', {
        routine_id: routine.id,
        name: d.name,
        description: d.focus,
        sort_order: i,
        scheduled_weekdays: d.weekdays,
        archived_at: null,
      });
      d.exercises.forEach(([name, equipment, type, sets, min, max, rest, , , notes], j) => {
        let id = exIds.get(name);
        if (!id) {
          id = insert('exercises', { name, equipment, category: null, exercise_type: type, weight_unit: null, notes: null, archived_at: null }).id;
          exIds.set(name, id);
        }
        insert('routine_exercises', {
          routine_day_id: day.id,
          exercise_id: id,
          sort_order: j,
          target_sets: sets,
          min_reps: type === 'time' ? null : min,
          max_reps: type === 'time' ? null : max,
          target_seconds: type === 'time' ? 45 : null,
          rest_seconds: rest,
          notes: notes ?? null,
        });
      });
      return { day, spec: d };
    });

    // ~6 weeks of history, ending yesterday
    const today = new Date();
    let week = 0;
    for (let back = 42; back >= 1; back--) {
      const date = addDays(today, -back);
      const dow = date.getDay();
      const entry = dayRows.find((r) => r.spec.weekdays.includes(dow));
      week = Math.floor((42 - back) / 7);
      if (!entry) {
        if (dow === 0 && back % 14 === 0) {
          insert('day_logs', { log_date: localDateKey(date), status: 'rest', routine_day_id: null, skip_reason: null, notes: null });
        }
        continue;
      }
      // Skip a couple of days for realism
      if (back === 31 || back === 17) {
        insert('day_logs', {
          log_date: localDateKey(date),
          status: 'skipped',
          routine_day_id: entry.day.id,
          skip_reason: back === 31 ? 'futsal' : 'busy',
          notes: back === 31 ? 'Futsal with friends' : null,
        });
        continue;
      }
      const start = new Date(date);
      start.setHours(18, 5 + (back % 4) * 7, 0, 0);
      let minutes = 0;
      const sessionId = insert('workout_sessions', {
        routine_id: routine.id,
        routine_day_id: entry.day.id,
        workout_name_snapshot: entry.spec.name,
        focus_snapshot: entry.spec.focus,
        status: 'completed',
        started_at: start.toISOString(),
        finished_at: null,
        paused_at: null,
        total_paused_seconds: 0,
        duration_seconds: null,
        notes: null,
        source: 'app',
        created_at: start.toISOString(),
      }).id;
      entry.spec.exercises.forEach(([name, equipment, type, sets, min, max, rest, startLb, stepLb, notes], j) => {
        const we = insert('workout_exercises', {
          workout_session_id: sessionId,
          exercise_id: exIds.get(name)!,
          exercise_name_snapshot: name,
          equipment_snapshot: equipment,
          exercise_type_snapshot: type,
          sort_order: j,
          target_sets: sets,
          min_reps: type === 'time' ? null : min,
          max_reps: type === 'time' ? null : max,
          target_seconds: type === 'time' ? 45 : null,
          rest_seconds: rest,
          routine_notes_snapshot: notes ?? null,
          notes: null,
          status: 'pending',
        });
        // Double progression: reps climb within the range, then weight goes up.
        const cycle = max - min + 1;
        const weight = startLb + stepLb * Math.floor(week / Math.max(1, Math.ceil(cycle / 2)));
        const baseReps = Math.min(max, min + (week % cycle));
        for (let s = 0; s < sets; s++) {
          const fatigue = s >= sets - 1 && (back + j) % 3 === 0 ? 1 : 0;
          const reps = type === 'bodyweight' ? 6 + Math.min(4, week) - (s > 1 ? 1 : 0) : Math.max(min - 1, baseReps - fatigue);
          minutes += rest / 60 + 0.75;
          insert('workout_sets', {
            workout_exercise_id: we.id,
            set_number: s + 1,
            weight_kg: type === 'weight' || type === 'weighted_bodyweight' ? lb(weight) : null,
            reps: type === 'time' ? null : reps,
            duration_seconds: type === 'time' ? 40 + week * 5 : null,
            distance_m: null,
            completed: true,
            completed_at: new Date(start.getTime() + minutes * 60000).toISOString(),
            notes: null,
          });
        }
      });
      const duration = Math.round(minutes * 60 + 300);
      insert('workout_sessions', {
        id: sessionId,
        routine_id: routine.id,
        routine_day_id: entry.day.id,
        workout_name_snapshot: entry.spec.name,
        focus_snapshot: entry.spec.focus,
        status: 'completed',
        started_at: start.toISOString(),
        finished_at: new Date(start.getTime() + duration * 1000).toISOString(),
        paused_at: null,
        total_paused_seconds: 0,
        duration_seconds: duration,
        notes: null,
        source: 'app',
        created_at: start.toISOString(),
      });
    }
  });
}
