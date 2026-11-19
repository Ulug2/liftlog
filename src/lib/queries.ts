/**
 * Read-side helpers. Everything is derived from the in-memory tables; a small
 * index is rebuilt only when the workout tables actually change.
 */
import type {
  DayLog,
  Exercise,
  ExerciseType,
  Routine,
  RoutineDay,
  RoutineExercise,
  TableState,
  WorkoutExercise,
  WorkoutSession,
  WorkoutSet,
} from '../types/models';
import type { AppState } from './db';
import { epley1RM, setStats, supportsE1RM, usesWeight, type SetStats } from '../utils/calculations';
import { addDays, localDateKey, startOfWeek } from '../utils/dates';

export const alive = <T extends { deleted_at: string | null }>(rows: Record<string, T>): T[] =>
  Object.values(rows).filter((r) => !r.deleted_at);

const bySort = <T extends { sort_order: number }>(a: T, b: T) => a.sort_order - b.sort_order;

/* -------------------------------- Routines -------------------------------- */

export function listRoutines(t: TableState): Routine[] {
  return alive(t.routines)
    .filter((r) => !r.archived_at)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export function activeRoutine(s: AppState): Routine | null {
  const id = s.profile.active_routine_id;
  const r = id ? s.tables.routines[id] : undefined;
  if (r && !r.deleted_at && !r.archived_at) return r;
  return listRoutines(s.tables)[0] ?? null;
}

export function routineDays(t: TableState, routineId: string | undefined, archived = false): RoutineDay[] {
  if (!routineId) return [];
  return alive(t.routine_days)
    .filter((d) => d.routine_id === routineId && !!d.archived_at === archived)
    .sort(bySort);
}

export interface DayExercise {
  re: RoutineExercise;
  exercise: Exercise;
}

export function dayExercises(t: TableState, dayId: string): DayExercise[] {
  return alive(t.routine_exercises)
    .filter((re) => re.routine_day_id === dayId && t.exercises[re.exercise_id])
    .sort(bySort)
    .map((re) => ({ re, exercise: t.exercises[re.exercise_id] }));
}

export function listExercises(t: TableState, includeArchived = false): Exercise[] {
  return alive(t.exercises)
    .filter((e) => includeArchived || !e.archived_at)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function exerciseLabel(e: { name: string; equipment: string | null }) {
  return e.equipment ? `${e.name}` : e.name;
}

/** Days scheduled for a given weekday in the active routine. */
export function scheduledDaysFor(s: AppState, date = new Date()): RoutineDay[] {
  const r = activeRoutine(s);
  return routineDays(s.tables, r?.id).filter((d) => d.scheduled_weekdays.includes(date.getDay()));
}

/** A routine day has been used if any session references it. */
export function isDayUsed(t: TableState, dayId: string) {
  return Object.values(t.workout_sessions).some((s) => s.routine_day_id === dayId);
}

export function isExerciseUsed(t: TableState, exerciseId: string) {
  return Object.values(t.workout_exercises).some((w) => w.exercise_id === exerciseId);
}

/* -------------------------------- Workouts -------------------------------- */

export interface HistoryEntry {
  session: WorkoutSession;
  we: WorkoutExercise;
  sets: WorkoutSet[];
}

export interface WorkoutIndex {
  weBySession: Map<string, WorkoutExercise[]>;
  setsByWe: Map<string, WorkoutSet[]>;
  /** completed sessions, newest first */
  completed: WorkoutSession[];
  /** per exercise, newest first, completed sessions only */
  historyByExercise: Map<string, HistoryEntry[]>;
  lastByDay: Map<string, WorkoutSession>;
  sessionsByDate: Map<string, WorkoutSession[]>;
  logsByDate: Map<string, DayLog>;
  active: WorkoutSession | null;
}

let cacheKey: unknown[] = [];
let cacheVal: WorkoutIndex | null = null;

export function workoutIndex(t: TableState): WorkoutIndex {
  const key = [t.workout_sessions, t.workout_exercises, t.workout_sets, t.day_logs];
  if (cacheVal && key.every((k, i) => k === cacheKey[i])) return cacheVal;

  const setsByWe = new Map<string, WorkoutSet[]>();
  for (const s of alive(t.workout_sets)) {
    const arr = setsByWe.get(s.workout_exercise_id) ?? [];
    arr.push(s);
    setsByWe.set(s.workout_exercise_id, arr);
  }
  setsByWe.forEach((arr) => arr.sort((a, b) => a.set_number - b.set_number));

  const weBySession = new Map<string, WorkoutExercise[]>();
  for (const w of alive(t.workout_exercises)) {
    const arr = weBySession.get(w.workout_session_id) ?? [];
    arr.push(w);
    weBySession.set(w.workout_session_id, arr);
  }
  weBySession.forEach((arr) => arr.sort(bySort));

  const sessions = alive(t.workout_sessions);
  const completed = sessions
    .filter((s) => s.status === 'completed')
    .sort((a, b) => b.started_at.localeCompare(a.started_at));
  const active = sessions.find((s) => s.status === 'active') ?? null;

  const historyByExercise = new Map<string, HistoryEntry[]>();
  const lastByDay = new Map<string, WorkoutSession>();
  const sessionsByDate = new Map<string, WorkoutSession[]>();
  for (const session of completed) {
    if (session.routine_day_id && !lastByDay.has(session.routine_day_id)) lastByDay.set(session.routine_day_id, session);
    const dk = localDateKey(session.started_at);
    sessionsByDate.set(dk, [...(sessionsByDate.get(dk) ?? []), session]);
    for (const we of weBySession.get(session.id) ?? []) {
      const sets = setsByWe.get(we.id) ?? [];
      const arr = historyByExercise.get(we.exercise_id) ?? [];
      arr.push({ session, we, sets });
      historyByExercise.set(we.exercise_id, arr);
    }
  }

  const logsByDate = new Map<string, DayLog>();
  for (const l of alive(t.day_logs)) {
    const prev = logsByDate.get(l.log_date);
    if (!prev || prev.updated_at < l.updated_at) logsByDate.set(l.log_date, l);
  }

  cacheKey = key;
  cacheVal = { weBySession, setsByWe, completed, historyByExercise, lastByDay, sessionsByDate, logsByDate, active };
  return cacheVal;
}

/** The most recent completed performance of an exercise (completed sets only). */
export function previousPerformance(idx: WorkoutIndex, exerciseId: string, excludeSessionId?: string): HistoryEntry | null {
  for (const h of idx.historyByExercise.get(exerciseId) ?? []) {
    if (h.session.id === excludeSessionId) continue;
    const done = h.sets.filter((s) => s.completed);
    if (done.length) return { ...h, sets: done };
  }
  return null;
}

export interface SessionSummary {
  exercisesCompleted: number;
  exercisesTotal: number;
  setsCompleted: number;
  setsTotal: number;
  volumeKg: number;
}

export function sessionSummary(idx: WorkoutIndex, sessionId: string): SessionSummary {
  const wes = idx.weBySession.get(sessionId) ?? [];
  let exercisesCompleted = 0;
  let setsCompleted = 0;
  let setsTotal = 0;
  let volumeKg = 0;
  let exercisesTotal = 0;
  for (const we of wes) {
    const sets = idx.setsByWe.get(we.id) ?? [];
    const done = sets.filter((s) => s.completed);
    if (we.status !== 'skipped') {
      exercisesTotal++;
      setsTotal += sets.length;
    }
    setsCompleted += done.length;
    if (sets.length > 0 && done.length === sets.length) exercisesCompleted++;
    for (const s of done) if (usesWeight(we.exercise_type_snapshot) && s.weight_kg != null && s.reps != null) volumeKg += s.weight_kg * s.reps;
  }
  return { exercisesCompleted, exercisesTotal, setsCompleted, setsTotal, volumeKg };
}

/** For history lists: exercises with at least one completed set. */
export function exercisesPerformed(idx: WorkoutIndex, sessionId: string) {
  return (idx.weBySession.get(sessionId) ?? []).filter((we) => (idx.setsByWe.get(we.id) ?? []).some((s) => s.completed)).length;
}

export function liveElapsedSeconds(s: WorkoutSession, now = Date.now()): number {
  const start = Date.parse(s.started_at);
  const end = s.finished_at ? Date.parse(s.finished_at) : s.paused_at ? Date.parse(s.paused_at) : now;
  return Math.max(0, Math.floor((end - start) / 1000 - s.total_paused_seconds));
}

/* ------------------------------- Records / PRs ------------------------------ */

export interface Bests {
  maxWeight: number | null;
  bestE1RM: number | null;
  maxReps: number | null;
}

/** All-time bests for an exercise from completed sessions, optionally excluding one session. */
export function bestsFor(idx: WorkoutIndex, exerciseId: string, excludeSessionId?: string): Bests {
  const b: Bests = { maxWeight: null, bestE1RM: null, maxReps: null };
  for (const h of idx.historyByExercise.get(exerciseId) ?? []) {
    if (h.session.id === excludeSessionId) continue;
    const st = setStats(h.sets, h.we.exercise_type_snapshot);
    if (st.maxWeight != null && (b.maxWeight == null || st.maxWeight > b.maxWeight)) b.maxWeight = st.maxWeight;
    if (st.bestE1RM != null && (b.bestE1RM == null || st.bestE1RM > b.bestE1RM)) b.bestE1RM = st.bestE1RM;
    if (st.maxReps != null && (b.maxReps == null || st.maxReps > b.maxReps)) b.maxReps = st.maxReps;
  }
  return b;
}

/** Is this completed set a new record vs. everything logged before? Requires prior history. */
export function setIsPR(set: WorkoutSet, type: ExerciseType, prior: Bests, hasHistory: boolean): boolean {
  if (!set.completed || !hasHistory) return false;
  if (usesWeight(type)) {
    if (set.weight_kg != null && prior.maxWeight != null && set.weight_kg > prior.maxWeight + 1e-6) return true;
    if (supportsE1RM(type)) {
      const e = epley1RM(set.weight_kg, set.reps);
      if (e != null && prior.bestE1RM != null && e > prior.bestE1RM + 1e-6) return true;
    }
    return false;
  }
  if (type === 'bodyweight') return set.reps != null && prior.maxReps != null && set.reps > prior.maxReps;
  return false;
}

export interface ProgressPoint {
  session: WorkoutSession;
  stats: SetStats;
  sets: WorkoutSet[];
  we: WorkoutExercise;
  isPR: boolean;
}

export interface ExerciseProgress {
  points: ProgressPoint[]; // oldest → newest
  bests: Bests;
  bestSet: WorkoutSet | null;
  totalVolume: number;
  repRecords: { weightKg: number; reps: number; date: string }[];
}

export function exerciseProgress(idx: WorkoutIndex, exerciseId: string, type: ExerciseType): ExerciseProgress {
  const entries = [...(idx.historyByExercise.get(exerciseId) ?? [])]
    .map((h) => ({ ...h, sets: h.sets.filter((s) => s.completed) }))
    .filter((h) => h.sets.length > 0)
    .reverse();
  const bests: Bests = { maxWeight: null, bestE1RM: null, maxReps: null };
  let bestSet: WorkoutSet | null = null;
  let bestSetScore = -1;
  let totalVolume = 0;
  const repAt = new Map<number, { reps: number; date: string }>();
  const points: ProgressPoint[] = entries.map((h, i) => {
    const st = setStats(h.sets, type);
    const prior = { ...bests };
    const isPR =
      i > 0 &&
      ((st.maxWeight != null && prior.maxWeight != null && st.maxWeight > prior.maxWeight + 1e-6) ||
        (st.bestE1RM != null && prior.bestE1RM != null && st.bestE1RM > prior.bestE1RM + 1e-6) ||
        (type === 'bodyweight' && st.maxReps != null && prior.maxReps != null && st.maxReps > prior.maxReps));
    if (st.maxWeight != null && (bests.maxWeight == null || st.maxWeight > bests.maxWeight)) bests.maxWeight = st.maxWeight;
    if (st.bestE1RM != null && (bests.bestE1RM == null || st.bestE1RM > bests.bestE1RM)) bests.bestE1RM = st.bestE1RM;
    if (st.maxReps != null && (bests.maxReps == null || st.maxReps > bests.maxReps)) bests.maxReps = st.maxReps;
    totalVolume += st.volume;
    for (const s of h.sets) {
      const score = supportsE1RM(type) ? epley1RM(s.weight_kg, s.reps) ?? (s.weight_kg ?? 0) : (s.weight_kg ?? 0) * 1000 + (s.reps ?? 0);
      if (score > bestSetScore) {
        bestSetScore = score;
        bestSet = s;
      }
      if (s.weight_kg != null && s.reps != null) {
        const k = Math.round(s.weight_kg * 10000) / 10000;
        const cur = repAt.get(k);
        if (!cur || s.reps > cur.reps) repAt.set(k, { reps: s.reps, date: h.session.started_at });
      }
    }
    return { session: h.session, stats: st, sets: h.sets, we: h.we, isPR };
  });
  const repRecords = [...repAt.entries()]
    .map(([weightKg, v]) => ({ weightKg, ...v }))
    .sort((a, b) => b.weightKg - a.weightKg);
  return { points, bests, bestSet, totalVolume, repRecords };
}

/** Recent sessions where any exercise set a new record. */
export function recentPRs(s: AppState, idx: WorkoutIndex, limit = 5) {
  const out: { exercise: Exercise; point: ProgressPoint }[] = [];
  for (const [exerciseId] of idx.historyByExercise) {
    const ex = s.tables.exercises[exerciseId];
    if (!ex) continue;
    const prog = exerciseProgress(idx, exerciseId, ex.exercise_type);
    for (const p of prog.points) if (p.isPR) out.push({ exercise: ex, point: p });
  }
  return out.sort((a, b) => b.point.session.started_at.localeCompare(a.point.session.started_at)).slice(0, limit);
}

/* ---------------------------------- Calendar --------------------------------- */

export type DayStatus = 'completed' | 'skipped' | 'rest' | 'none';

export function dayStatus(idx: WorkoutIndex, dateKey: string): DayStatus {
  if (idx.sessionsByDate.get(dateKey)?.length) return 'completed';
  const log = idx.logsByDate.get(dateKey);
  if (log) return log.status === 'skipped' ? 'skipped' : 'rest';
  return 'none';
}

export function weekDays(idx: WorkoutIndex, ref = new Date()) {
  const start = startOfWeek(ref);
  return Array.from({ length: 7 }, (_, i) => {
    const d = addDays(start, i);
    const key = localDateKey(d);
    return { date: d, key, status: dayStatus(idx, key) };
  });
}

export function workoutsThisWeek(idx: WorkoutIndex, ref = new Date()) {
  const startKey = localDateKey(startOfWeek(ref));
  const endKey = localDateKey(addDays(startOfWeek(ref), 7));
  return idx.completed.filter((s) => {
    const k = localDateKey(s.started_at);
    return k >= startKey && k < endKey;
  }).length;
}

/** How many days the active routine schedules per week (for "3 / 5"). */
export function plannedPerWeek(s: AppState) {
  const r = activeRoutine(s);
  const days = new Set<number>();
  for (const d of routineDays(s.tables, r?.id)) d.scheduled_weekdays.forEach((w) => days.add(w));
  return days.size;
}

/** Consecutive weeks (ending this or last week) with at least one workout. */
export function weekStreak(idx: WorkoutIndex) {
  const weeks = new Set(idx.completed.map((s) => localDateKey(startOfWeek(new Date(s.started_at)))));
  let streak = 0;
  let cursor = startOfWeek();
  if (!weeks.has(localDateKey(cursor))) cursor = addDays(cursor, -7);
  while (weeks.has(localDateKey(cursor))) {
    streak++;
    cursor = addDays(cursor, -7);
  }
  return streak;
}
