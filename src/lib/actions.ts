/**
 * Domain operations. Every function writes locally first (instant), and the
 * sync engine picks the changes up in the background.
 */
import type {
  Exercise,
  ExerciseType,
  RoutineDay,
  RoutineExercise,
  SkipReason,
  WorkoutExercise,
  WorkoutSession,
  WorkoutSet,
} from '../types/models';
import { batch, getState, insert, nowIso, remove, setProfile, setWorkoutUi, update } from './db';
import {
  activeRoutine,
  alive,
  dayExercises,
  isDayUsed,
  liveElapsedSeconds,
  previousPerformance,
  routineDays,
  workoutIndex,
} from './queries';
import { localDateKey } from '../utils/dates';

const t = () => getState().tables;

/* --------------------------------- Routines -------------------------------- */

export function createRoutine(name: string) {
  const r = insert('routines', { name: name.trim() || 'My Routine', description: null, archived_at: null });
  setProfile({ active_routine_id: r.id });
  return r;
}

export function ensureRoutine() {
  return activeRoutine(getState()) ?? createRoutine('My Routine');
}

export function renameRoutine(id: string, name: string) {
  update('routines', id, { name: name.trim() || 'My Routine' });
}

export function setActiveRoutine(id: string) {
  setProfile({ active_routine_id: id });
}

export function createDay(name: string, description: string | null = null): RoutineDay {
  const routine = ensureRoutine();
  const days = alive(t().routine_days).filter((d) => d.routine_id === routine.id);
  const sort = days.reduce((m, d) => Math.max(m, d.sort_order), -1) + 1;
  return insert('routine_days', {
    routine_id: routine.id,
    name: name.trim() || 'New day',
    description,
    sort_order: sort,
    scheduled_weekdays: [],
    archived_at: null,
  });
}

export function updateDay(id: string, patch: Partial<RoutineDay>) {
  update('routine_days', id, patch);
}

export function duplicateDay(id: string) {
  const day = t().routine_days[id];
  if (!day) return null;
  return batch(() => {
    const siblings = routineDays(t(), day.routine_id);
    // Insert directly after the original
    siblings.filter((d) => d.sort_order > day.sort_order).forEach((d) => update('routine_days', d.id, { sort_order: d.sort_order + 1 }));
    const copy = insert('routine_days', {
      routine_id: day.routine_id,
      name: `${day.name} (copy)`,
      description: day.description,
      sort_order: day.sort_order + 1,
      scheduled_weekdays: [],
      archived_at: null,
    });
    for (const { re } of dayExercises(t(), id)) {
      const { id: _id, created_at: _c, updated_at: _u, deleted_at: _d, ...rest } = re;
      insert('routine_exercises', { ...rest, routine_day_id: copy.id });
    }
    return copy;
  });
}

export function archiveDay(id: string) {
  update('routine_days', id, { archived_at: nowIso() });
}
export function restoreDay(id: string) {
  update('routine_days', id, { archived_at: null });
}

/** Only allowed for days that were never used in a workout. */
export function deleteDay(id: string): boolean {
  if (isDayUsed(t(), id)) return false;
  batch(() => {
    for (const { re } of dayExercises(t(), id)) remove('routine_exercises', re.id);
    remove('routine_days', id);
  });
  return true;
}

export function reorder<T extends { id: string }>(table: 'routine_days' | 'routine_exercises', ordered: T[]) {
  batch(() => ordered.forEach((row, i) => update(table, row.id, { sort_order: i })));
}

/* -------------------------------- Exercises -------------------------------- */

export function createExercise(data: {
  name: string;
  equipment: string | null;
  category?: string | null;
  exercise_type: ExerciseType;
  weight_unit?: Exercise['weight_unit'];
  notes?: string | null;
}): Exercise {
  return insert('exercises', {
    name: data.name.trim(),
    equipment: data.equipment,
    category: data.category ?? null,
    exercise_type: data.exercise_type,
    weight_unit: data.weight_unit ?? null,
    notes: data.notes ?? null,
    archived_at: null,
  });
}

export function updateExercise(id: string, patch: Partial<Exercise>) {
  update('exercises', id, patch);
}

export function archiveExercise(id: string) {
  update('exercises', id, { archived_at: nowIso() });
}
export function restoreExercise(id: string) {
  update('exercises', id, { archived_at: null });
}

export function addExerciseToDay(dayId: string, exerciseId: string): RoutineExercise {
  const ex = t().exercises[exerciseId];
  const existing = dayExercises(t(), dayId);
  const sort = existing.reduce((m, d) => Math.max(m, d.re.sort_order), -1) + 1;
  const isTime = ex?.exercise_type === 'time';
  return insert('routine_exercises', {
    routine_day_id: dayId,
    exercise_id: exerciseId,
    sort_order: sort,
    target_sets: 3,
    min_reps: isTime || ex?.exercise_type === 'distance' ? null : 8,
    max_reps: isTime || ex?.exercise_type === 'distance' ? null : 12,
    target_seconds: isTime ? 60 : null,
    rest_seconds: getState().profile.default_rest_seconds,
    notes: null,
  });
}

export function updateRoutineExercise(id: string, patch: Partial<RoutineExercise>) {
  update('routine_exercises', id, patch);
}

export function removeRoutineExercise(id: string) {
  remove('routine_exercises', id);
}

export function duplicateRoutineExercise(id: string) {
  const re = t().routine_exercises[id];
  if (!re) return;
  batch(() => {
    dayExercises(t(), re.routine_day_id)
      .filter((d) => d.re.sort_order > re.sort_order)
      .forEach((d) => update('routine_exercises', d.re.id, { sort_order: d.re.sort_order + 1 }));
    const { id: _id, created_at: _c, updated_at: _u, deleted_at: _d, ...rest } = re;
    insert('routine_exercises', { ...rest, sort_order: re.sort_order + 1 });
  });
}

/* --------------------------------- Workouts -------------------------------- */

function prefilledSets(weId: string, exerciseId: string, count: number, excludeSessionId: string) {
  const prev = previousPerformance(workoutIndex(t()), exerciseId, excludeSessionId);
  const prevSets = prev?.sets ?? [];
  for (let i = 0; i < count; i++) {
    // Same set number from last time; if I'm doing more sets than last time, repeat the last one.
    const src = prevSets[i] ?? prevSets[prevSets.length - 1];
    insert('workout_sets', {
      workout_exercise_id: weId,
      set_number: i + 1,
      weight_kg: src?.weight_kg ?? null,
      reps: src?.reps ?? null,
      duration_seconds: src?.duration_seconds ?? null,
      distance_m: src?.distance_m ?? null,
      completed: false, // prefilled values are suggestions — never auto-complete
      completed_at: null,
      notes: null,
    });
  }
}

function snapshotExercise(sessionId: string, ex: Exercise, sort: number, re?: RoutineExercise): WorkoutExercise {
  return insert('workout_exercises', {
    workout_session_id: sessionId,
    exercise_id: ex.id,
    exercise_name_snapshot: ex.name,
    equipment_snapshot: ex.equipment,
    exercise_type_snapshot: ex.exercise_type,
    sort_order: sort,
    target_sets: re?.target_sets ?? 3,
    min_reps: re ? re.min_reps : 8,
    max_reps: re ? re.max_reps : 12,
    target_seconds: re?.target_seconds ?? null,
    rest_seconds: re?.rest_seconds ?? getState().profile.default_rest_seconds,
    routine_notes_snapshot: re?.notes ?? ex.notes ?? null,
    notes: null,
    status: 'pending',
  });
}

export function startWorkout(dayId: string | null): WorkoutSession {
  const s = getState();
  const day = dayId ? s.tables.routine_days[dayId] : null;
  return batch(() => {
    const session = insert('workout_sessions', {
      routine_id: day?.routine_id ?? null,
      routine_day_id: day?.id ?? null,
      workout_name_snapshot: day?.name ?? 'Workout',
      focus_snapshot: day?.description ?? null,
      status: 'active',
      started_at: nowIso(),
      finished_at: null,
      paused_at: null,
      total_paused_seconds: 0,
      duration_seconds: null,
      notes: null,
      source: 'app',
    });
    let first: string | null = null;
    if (day) {
      dayExercises(s.tables, day.id)
        .filter(({ exercise }) => !exercise.deleted_at && !exercise.archived_at)
        .forEach(({ re, exercise }, i) => {
          const we = snapshotExercise(session.id, exercise, i, re);
          prefilledSets(we.id, exercise.id, re.target_sets, session.id);
          if (!first) first = we.id;
        });
    }
    setWorkoutUi({ sessionId: session.id, currentExerciseId: first, rest: null });
    return session;
  });
}

export function addExerciseToWorkout(sessionId: string, exerciseId: string) {
  const ex = t().exercises[exerciseId];
  if (!ex) return;
  const idx = workoutIndex(t());
  const sort = (idx.weBySession.get(sessionId) ?? []).reduce((m, w) => Math.max(m, w.sort_order), -1) + 1;
  batch(() => {
    const we = snapshotExercise(sessionId, ex, sort);
    prefilledSets(we.id, ex.id, we.target_sets, sessionId);
    setCurrentExercise(we.id);
  });
}

export function setCurrentExercise(weId: string) {
  const ui = getState().workoutUi;
  if (ui) setWorkoutUi({ ...ui, currentExerciseId: weId });
}

export function updateSet(id: string, patch: Partial<WorkoutSet>) {
  update('workout_sets', id, patch);
}

export function completeSet(id: string) {
  const set = t().workout_sets[id];
  if (!set) return;
  const we = t().workout_exercises[set.workout_exercise_id];
  update('workout_sets', id, { completed: true, completed_at: nowIso() });
  if (we && we.status === 'skipped') update('workout_exercises', we.id, { status: 'pending' });
  if (we) startRest(we.id, we.rest_seconds);
}

export function uncompleteSet(id: string) {
  update('workout_sets', id, { completed: false, completed_at: null });
  const ui = getState().workoutUi;
  if (ui?.rest) setWorkoutUi({ ...ui, rest: null });
}

export function addSet(weId: string) {
  const sets = workoutIndex(t()).setsByWe.get(weId) ?? [];
  const last = sets[sets.length - 1];
  insert('workout_sets', {
    workout_exercise_id: weId,
    set_number: (last?.set_number ?? 0) + 1,
    weight_kg: last?.weight_kg ?? null,
    reps: last?.reps ?? null,
    duration_seconds: last?.duration_seconds ?? null,
    distance_m: last?.distance_m ?? null,
    completed: false,
    completed_at: null,
    notes: null,
  });
}

/** Remove a set and renumber the rest. Completed sets can only be removed when editing history. */
export function removeSet(id: string, allowCompleted = false) {
  const set = t().workout_sets[id];
  if (!set || (set.completed && !allowCompleted)) return;
  batch(() => {
    remove('workout_sets', id);
    const rest = (workoutIndex(t()).setsByWe.get(set.workout_exercise_id) ?? []).filter((s) => s.id !== id);
    rest.forEach((s, i) => {
      if (s.set_number !== i + 1) update('workout_sets', s.id, { set_number: i + 1 });
    });
  });
}

/** Copy one set's values onto every later set that isn't completed yet. */
export function applyToRemaining(id: string) {
  const src = t().workout_sets[id];
  if (!src) return;
  const sets = workoutIndex(t()).setsByWe.get(src.workout_exercise_id) ?? [];
  batch(() => {
    for (const s of sets) {
      if (s.set_number > src.set_number && !s.completed) {
        update('workout_sets', s.id, {
          weight_kg: src.weight_kg,
          reps: src.reps,
          duration_seconds: src.duration_seconds,
          distance_m: src.distance_m,
        });
      }
    }
  });
}

export function setExerciseSkipped(weId: string, skipped: boolean) {
  update('workout_exercises', weId, { status: skipped ? 'skipped' : 'pending' });
}

export function setExerciseNote(weId: string, notes: string) {
  update('workout_exercises', weId, { notes: notes.trim() || null });
}

export function removeWorkoutExercise(weId: string) {
  batch(() => {
    for (const s of workoutIndex(t()).setsByWe.get(weId) ?? []) remove('workout_sets', s.id);
    remove('workout_exercises', weId);
  });
}

export function pauseWorkout(sessionId: string) {
  const s = t().workout_sessions[sessionId];
  if (!s || s.paused_at) return;
  update('workout_sessions', sessionId, { paused_at: nowIso() });
}

export function resumeWorkout(sessionId: string) {
  const s = t().workout_sessions[sessionId];
  if (!s || !s.paused_at) return;
  const paused = (Date.now() - Date.parse(s.paused_at)) / 1000;
  update('workout_sessions', sessionId, { paused_at: null, total_paused_seconds: s.total_paused_seconds + Math.max(0, paused) });
}

export function finishWorkout(sessionId: string) {
  const s = t().workout_sessions[sessionId];
  if (!s) return;
  batch(() => {
    const finished = nowIso();
    let pausedTotal = s.total_paused_seconds;
    if (s.paused_at) pausedTotal += Math.max(0, (Date.parse(finished) - Date.parse(s.paused_at)) / 1000);
    const final = { ...s, paused_at: null, total_paused_seconds: pausedTotal, finished_at: finished };
    update('workout_sessions', sessionId, {
      status: 'completed',
      finished_at: finished,
      paused_at: null,
      total_paused_seconds: pausedTotal,
      duration_seconds: liveElapsedSeconds(final),
    });
    // Keep only what was actually performed. Targets stay in the exercise snapshot.
    const idx = workoutIndex(t());
    for (const we of idx.weBySession.get(sessionId) ?? []) {
      for (const set of idx.setsByWe.get(we.id) ?? []) if (!set.completed) remove('workout_sets', set.id);
    }
    // Renumber remaining sets 1..n per exercise
    const idx2 = workoutIndex(t());
    for (const we of idx2.weBySession.get(sessionId) ?? []) {
      (idx2.setsByWe.get(we.id) ?? []).forEach((set, i) => {
        if (set.set_number !== i + 1) update('workout_sets', set.id, { set_number: i + 1 });
      });
    }
    setWorkoutUi(null);
  });
}

export function discardWorkout(sessionId: string) {
  batch(() => {
    update('workout_sessions', sessionId, { status: 'discarded', deleted_at: nowIso() });
    setWorkoutUi(null);
  });
}

/* ------------------------------- Rest timer -------------------------------- */

export function startRest(weId: string, seconds: number) {
  const ui = getState().workoutUi;
  if (!ui || seconds <= 0) return;
  setWorkoutUi({ ...ui, rest: { endsAt: Date.now() + seconds * 1000, pausedRemaining: null, durationMs: seconds * 1000, workoutExerciseId: weId } });
}

export function pauseRest() {
  const ui = getState().workoutUi;
  if (!ui?.rest?.endsAt) return;
  setWorkoutUi({ ...ui, rest: { ...ui.rest, pausedRemaining: Math.max(0, ui.rest.endsAt - Date.now()), endsAt: null } });
}

export function resumeRest() {
  const ui = getState().workoutUi;
  if (!ui?.rest || ui.rest.pausedRemaining == null) return;
  setWorkoutUi({ ...ui, rest: { ...ui.rest, endsAt: Date.now() + ui.rest.pausedRemaining, pausedRemaining: null } });
}

export function adjustRest(deltaSeconds: number) {
  const ui = getState().workoutUi;
  if (!ui?.rest) return;
  const r = ui.rest;
  if (r.endsAt != null) {
    const base = Math.max(r.endsAt, Date.now());
    setWorkoutUi({ ...ui, rest: { ...r, endsAt: base + deltaSeconds * 1000, durationMs: r.durationMs + deltaSeconds * 1000 } });
  } else if (r.pausedRemaining != null) {
    setWorkoutUi({ ...ui, rest: { ...r, pausedRemaining: Math.max(0, r.pausedRemaining + deltaSeconds * 1000) } });
  }
}

export function stopRest() {
  const ui = getState().workoutUi;
  if (ui) setWorkoutUi({ ...ui, rest: null });
}

/* ----------------------------- Skips & rest days ----------------------------- */

function clearLogsFor(dateKey: string) {
  for (const l of alive(t().day_logs)) if (l.log_date === dateKey) remove('day_logs', l.id);
}

export function skipDay(dateKey: string, routineDayId: string | null, reason: SkipReason | null, notes: string | null) {
  batch(() => {
    clearLogsFor(dateKey);
    insert('day_logs', { log_date: dateKey, status: 'skipped', routine_day_id: routineDayId, skip_reason: reason, notes: notes?.trim() || null });
  });
}

export function logRestDay(dateKey = localDateKey()) {
  batch(() => {
    clearLogsFor(dateKey);
    insert('day_logs', { log_date: dateKey, status: 'rest', routine_day_id: null, skip_reason: null, notes: null });
  });
}

export function clearDayLog(id: string) {
  remove('day_logs', id);
}

/* ------------------------------ History editing ------------------------------ */

export function updateSession(id: string, patch: Partial<WorkoutSession>) {
  update('workout_sessions', id, patch);
}

export function deleteSession(id: string) {
  remove('workout_sessions', id);
}

export function addHistoricalSet(weId: string) {
  const sets = workoutIndex(t()).setsByWe.get(weId) ?? [];
  const last = sets[sets.length - 1];
  insert('workout_sets', {
    workout_exercise_id: weId,
    set_number: (last?.set_number ?? 0) + 1,
    weight_kg: last?.weight_kg ?? null,
    reps: last?.reps ?? null,
    duration_seconds: last?.duration_seconds ?? null,
    distance_m: last?.distance_m ?? null,
    completed: true,
    completed_at: last?.completed_at ?? nowIso(),
    notes: null,
  });
}

export const SKIP_REASONS: { value: SkipReason; label: string }[] = [
  { value: 'futsal', label: 'Futsal' },
  { value: 'busy', label: 'Busy' },
  { value: 'recovery', label: 'Recovery / injury' },
  { value: 'no_motivation', label: "Didn't feel like it" },
  { value: 'other', label: 'Other' },
];

export const skipReasonLabel = (r: SkipReason | null) => SKIP_REASONS.find((x) => x.value === r)?.label ?? 'Skipped';
