-- LiftLog schema
-- Every table carries user_id so Row Level Security is a simple, fast equality check.
-- Rows are created on the device (client UUIDs) and soft-deleted with deleted_at so
-- deletions sync too. Workout tables hold snapshots so routine edits never rewrite history.

-- ---------------------------------------------------------------------------
-- Shared trigger functions
-- ---------------------------------------------------------------------------

-- Server-side change cursor for incremental pulls.
create or replace function public.set_synced_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.synced_at := clock_timestamp();
  return new;
end $$;

-- Last-write-wins guard: never let a stale device overwrite a newer row.
create or replace function public.reject_stale_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.updated_at < old.updated_at then
    return null; -- silently keep the newer server row
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  weight_unit text not null default 'lb' check (weight_unit in ('lb','kg')),
  default_rest_seconds int not null default 120 check (default_rest_seconds between 0 and 1800),
  active_routine_id uuid
);

-- ---------------------------------------------------------------------------
-- exercises: one row per variation (Cable Fly ≠ Machine Fly)
-- ---------------------------------------------------------------------------
create table public.exercises (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  equipment text,
  category text,
  exercise_type text not null default 'weight'
    check (exercise_type in ('weight','bodyweight','weighted_bodyweight','time','distance')),
  weight_unit text check (weight_unit in ('lb','kg')),
  notes text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  synced_at timestamptz not null default clock_timestamp()
);

-- ---------------------------------------------------------------------------
-- routines → routine_days → routine_exercises (the plan; freely editable)
-- ---------------------------------------------------------------------------
create table public.routines (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  description text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  synced_at timestamptz not null default clock_timestamp()
);

create table public.routine_days (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  routine_id uuid not null references public.routines(id) on delete cascade,
  name text not null,
  description text,
  sort_order int not null default 0,
  scheduled_weekdays smallint[] not null default '{}', -- 0=Sun … 6=Sat
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  synced_at timestamptz not null default clock_timestamp()
);

create table public.routine_exercises (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  routine_day_id uuid not null references public.routine_days(id) on delete cascade,
  exercise_id uuid not null references public.exercises(id),
  sort_order int not null default 0,
  target_sets int not null default 3 check (target_sets between 0 and 50),
  min_reps int,
  max_reps int,
  target_seconds int,
  rest_seconds int not null default 120,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  synced_at timestamptz not null default clock_timestamp()
);

-- ---------------------------------------------------------------------------
-- workout_sessions → workout_exercises → workout_sets (what actually happened)
-- ---------------------------------------------------------------------------
create table public.workout_sessions (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  routine_id uuid references public.routines(id) on delete set null,
  routine_day_id uuid references public.routine_days(id) on delete set null,
  workout_name_snapshot text not null,
  focus_snapshot text,
  status text not null check (status in ('active','completed','discarded')),
  started_at timestamptz not null,
  finished_at timestamptz,
  paused_at timestamptz,
  total_paused_seconds double precision not null default 0,
  duration_seconds int,
  notes text,
  source text not null default 'app' check (source in ('app','import')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  synced_at timestamptz not null default clock_timestamp()
);

create table public.workout_exercises (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  workout_session_id uuid not null references public.workout_sessions(id) on delete cascade,
  exercise_id uuid not null references public.exercises(id),
  exercise_name_snapshot text not null,
  equipment_snapshot text,
  exercise_type_snapshot text not null,
  sort_order int not null default 0,
  target_sets int not null default 0,
  min_reps int,
  max_reps int,
  target_seconds int,
  rest_seconds int not null default 0,
  routine_notes_snapshot text,
  notes text,
  status text not null default 'pending' check (status in ('pending','skipped')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  synced_at timestamptz not null default clock_timestamp()
);

create table public.workout_sets (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  workout_exercise_id uuid not null references public.workout_exercises(id) on delete cascade,
  set_number int not null,
  weight_kg double precision,      -- null = unknown (never coerced to 0)
  reps int,
  duration_seconds int,
  distance_m double precision,
  completed boolean not null default false,
  completed_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  synced_at timestamptz not null default clock_timestamp()
);

-- ---------------------------------------------------------------------------
-- day_logs: skipped scheduled workouts and planned rest days (never workouts)
-- ---------------------------------------------------------------------------
create table public.day_logs (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  log_date date not null,
  status text not null check (status in ('skipped','rest')),
  routine_day_id uuid references public.routine_days(id) on delete set null,
  skip_reason text check (skip_reason in ('futsal','busy','recovery','no_motivation','other')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  synced_at timestamptz not null default clock_timestamp()
);

-- activity_logs: futsal, walks… kept separate from gym workouts (UI in a later phase)
create table public.activity_logs (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  activity_type text not null,
  activity_date date not null,
  duration_seconds int,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  synced_at timestamptz not null default clock_timestamp()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
create index on public.exercises (user_id, synced_at);
create index on public.routines (user_id, synced_at);
create index on public.routine_days (user_id, synced_at);
create index on public.routine_days (routine_id);
create index on public.routine_exercises (user_id, synced_at);
create index on public.routine_exercises (routine_day_id);
create index on public.workout_sessions (user_id, synced_at);
create index on public.workout_sessions (user_id, started_at desc);
create index on public.workout_exercises (user_id, synced_at);
create index on public.workout_exercises (workout_session_id);
create index on public.workout_exercises (exercise_id);
create index on public.workout_sets (user_id, synced_at);
create index on public.workout_sets (workout_exercise_id);
create index on public.day_logs (user_id, synced_at);
create index on public.day_logs (user_id, log_date);
create index on public.activity_logs (user_id, synced_at);

-- ---------------------------------------------------------------------------
-- Triggers + Row Level Security
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['exercises','routines','routine_days','routine_exercises',
                           'workout_sessions','workout_exercises','workout_sets',
                           'day_logs','activity_logs']
  loop
    execute format('create trigger %I_synced_at before insert or update on public.%I
                    for each row execute function public.set_synced_at()', t, t);
    execute format('create trigger %I_reject_stale before update on public.%I
                    for each row execute function public.reject_stale_update()', t, t);
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "own rows" on public.%I for all to authenticated
                    using ((select auth.uid()) = user_id)
                    with check ((select auth.uid()) = user_id)', t);
  end loop;
end $$;

create trigger profiles_reject_stale before update on public.profiles
  for each row execute function public.reject_stale_update();
alter table public.profiles enable row level security;
create policy "own profile" on public.profiles for all to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);
