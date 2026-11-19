/**
 * Data model. Field names mirror the Supabase tables 1:1 (see supabase/migrations),
 * so the same rows live in IndexedDB and in Postgres.
 *
 * Conventions
 *  - ids are client-generated UUIDs (lets us create rows offline, and makes sync idempotent)
 *  - every row has created_at / updated_at / deleted_at (soft delete = tombstone that syncs)
 *  - weights are stored in KILOGRAMS; converted for display only
 *  - null means "unknown / not recorded" and is never the same as 0
 */

export type WeightUnit = 'lb' | 'kg';

export type ExerciseType =
  | 'weight' // barbell bench, cable row …
  | 'bodyweight' // push-ups, pull-ups
  | 'weighted_bodyweight' // weighted dips (weight = added load)
  | 'time' // plank
  | 'distance'; // sled push, run

export interface BaseRow {
  id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface Exercise extends BaseRow {
  name: string;
  equipment: string | null;
  /** Optional grouping only (e.g. "Chest fly"). Variations are NEVER merged for stats. */
  category: string | null;
  exercise_type: ExerciseType;
  /** Per-exercise unit override (some machines are labelled in kg). null = use profile unit. */
  weight_unit: WeightUnit | null;
  notes: string | null;
  archived_at: string | null;
}

export interface Routine extends BaseRow {
  name: string;
  description: string | null;
  archived_at: string | null;
}

export interface RoutineDay extends BaseRow {
  routine_id: string;
  name: string;
  description: string | null;
  sort_order: number;
  /** 0 = Sunday … 6 = Saturday. Empty = not scheduled (start it manually any time). */
  scheduled_weekdays: number[];
  archived_at: string | null;
}

export interface RoutineExercise extends BaseRow {
  routine_day_id: string;
  exercise_id: string;
  sort_order: number;
  target_sets: number;
  min_reps: number | null;
  max_reps: number | null;
  /** For time-based exercises. */
  target_seconds: number | null;
  rest_seconds: number;
  notes: string | null;
}

export type SessionStatus = 'active' | 'completed' | 'discarded';

export interface WorkoutSession extends BaseRow {
  routine_id: string | null;
  routine_day_id: string | null;
  workout_name_snapshot: string;
  focus_snapshot: string | null;
  status: SessionStatus;
  started_at: string;
  finished_at: string | null;
  paused_at: string | null;
  total_paused_seconds: number;
  duration_seconds: number | null;
  notes: string | null;
  /** 'app' for logged sessions, 'import' for historical imports (may be incomplete). */
  source: 'app' | 'import';
}

export type WorkoutExerciseStatus = 'pending' | 'skipped';

export interface WorkoutExercise extends BaseRow {
  workout_session_id: string;
  exercise_id: string;
  exercise_name_snapshot: string;
  equipment_snapshot: string | null;
  exercise_type_snapshot: ExerciseType;
  sort_order: number;
  target_sets: number;
  min_reps: number | null;
  max_reps: number | null;
  target_seconds: number | null;
  rest_seconds: number;
  routine_notes_snapshot: string | null;
  notes: string | null;
  status: WorkoutExerciseStatus;
}

export interface WorkoutSet extends BaseRow {
  workout_exercise_id: string;
  set_number: number;
  /** kilograms; for weighted bodyweight this is the ADDED load */
  weight_kg: number | null;
  reps: number | null;
  duration_seconds: number | null;
  distance_m: number | null;
  completed: boolean;
  completed_at: string | null;
  notes: string | null;
}

export type SkipReason = 'futsal' | 'busy' | 'recovery' | 'no_motivation' | 'other';

/** A day-level record that isn't a workout: a skipped scheduled workout or a planned rest day. */
export interface DayLog extends BaseRow {
  /** Local calendar date, YYYY-MM-DD */
  log_date: string;
  status: 'skipped' | 'rest';
  routine_day_id: string | null;
  skip_reason: SkipReason | null;
  notes: string | null;
}

/** Non-gym activity (futsal, walking…). Schema is ready; UI is a later phase. */
export interface ActivityLog extends BaseRow {
  activity_type: string;
  activity_date: string;
  duration_seconds: number | null;
  notes: string | null;
}

export interface Profile {
  id: 'me';
  updated_at: string;
  weight_unit: WeightUnit;
  default_rest_seconds: number;
  active_routine_id: string | null;
}

export interface Tables {
  exercises: Exercise;
  routines: Routine;
  routine_days: RoutineDay;
  routine_exercises: RoutineExercise;
  workout_sessions: WorkoutSession;
  workout_exercises: WorkoutExercise;
  workout_sets: WorkoutSet;
  day_logs: DayLog;
  activity_logs: ActivityLog;
}

export type TableName = keyof Tables;

/** Parent tables first — the order rows must be pushed to satisfy foreign keys. */
export const TABLES: TableName[] = [
  'exercises',
  'routines',
  'routine_days',
  'routine_exercises',
  'workout_sessions',
  'workout_exercises',
  'workout_sets',
  'day_logs',
  'activity_logs',
];

export type TableState = { [K in TableName]: Record<string, Tables[K]> };

/** Device-only state for the live workout (never synced). */
export interface WorkoutUiState {
  sessionId: string;
  currentExerciseId: string | null;
  rest: RestState | null;
}

export interface RestState {
  /** epoch ms when rest ends; null while paused */
  endsAt: number | null;
  /** ms left, set only while paused */
  pausedRemaining: number | null;
  durationMs: number;
  workoutExerciseId: string;
}
