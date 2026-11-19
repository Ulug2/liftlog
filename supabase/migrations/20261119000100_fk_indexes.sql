-- Cover the remaining foreign keys (flagged by the Supabase performance advisor).
create index on public.day_logs (routine_day_id);
create index on public.routine_exercises (exercise_id);
create index on public.workout_sessions (routine_day_id);
create index on public.workout_sessions (routine_id);
