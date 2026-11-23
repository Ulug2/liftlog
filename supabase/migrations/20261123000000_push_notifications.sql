-- Timer notifications (Web Push).
--
-- The phone registers a push subscription. While a rest timer runs and the app is
-- in the background, the phone schedules a "rest over" alert here. A pg_cron job
-- checks every 5 seconds and, only when something is due, asks the `push` Edge
-- Function to deliver it. VAPID keys and the dispatch secret never leave the server.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------------------------------------------------------------------------
-- Push subscriptions (one per device/browser)
-- ---------------------------------------------------------------------------
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_success_at timestamptz
);
create index on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
create policy "own subscriptions" on public.push_subscriptions for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- Scheduled notifications (one pending row per user per kind)
-- ---------------------------------------------------------------------------
create table public.notification_schedule (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('rest')),
  due_at timestamptz not null,
  title text not null check (length(title) <= 120),
  body text check (length(body) <= 300),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (user_id, kind)
);
create index notification_schedule_due on public.notification_schedule (due_at) where sent_at is null;
alter table public.notification_schedule enable row level security;
create policy "own schedule" on public.notification_schedule for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- Server-only config (not exposed through the API)
-- ---------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.push_config (
  id int primary key default 1 check (id = 1),
  vapid_public text,
  vapid_private_jwk jsonb,
  dispatch_secret text not null default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
);
insert into private.push_config (id) values (1);

-- Read config (Edge Function, via service role)
create or replace function public.push_config_get()
returns table (vapid_public text, vapid_private_jwk jsonb, dispatch_secret text)
language sql security definer set search_path = '' as $$
  select c.vapid_public, c.vapid_private_jwk, c.dispatch_secret from private.push_config c where c.id = 1;
$$;

-- First-run key storage; never overwrites existing keys (safe under races)
create or replace function public.push_config_init_vapid(p_public text, p_private jsonb)
returns text
language plpgsql security definer set search_path = '' as $$
begin
  update private.push_config set vapid_public = p_public, vapid_private_jwk = p_private
   where id = 1 and vapid_public is null;
  return (select c.vapid_public from private.push_config c where c.id = 1);
end $$;

-- Atomically take everything that is due (and tidy up old rows)
create or replace function public.push_claim_due()
returns table (user_id uuid, kind text, title text, body text)
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.notification_schedule s where s.sent_at < now() - interval '1 day';
  return query
    update public.notification_schedule s
       set sent_at = now()
     where s.sent_at is null and s.due_at <= now() + interval '1 second'
       and s.due_at > now() - interval '10 minutes'   -- never deliver stale alerts
    returning s.user_id, s.kind, s.title, s.body;
end $$;

-- Called by pg_cron: only wakes the Edge Function when something is due
create or replace function public.push_dispatch_tick()
returns void
language plpgsql security definer set search_path = '' as $$
declare
  secret text;
begin
  if not exists (
    select 1 from public.notification_schedule
     where sent_at is null and due_at <= now() + interval '1 second'
  ) then
    return;
  end if;
  select c.dispatch_secret into secret from private.push_config c where c.id = 1;
  perform net.http_post(
    url := 'https://tqbldynnwryogarysijp.supabase.co/functions/v1/push',
    body := '{"action":"dispatch"}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-dispatch-secret', secret),
    timeout_milliseconds := 10000
  );
end $$;

revoke execute on function public.push_config_get() from public, anon, authenticated;
revoke execute on function public.push_config_init_vapid(text, jsonb) from public, anon, authenticated;
revoke execute on function public.push_claim_due() from public, anon, authenticated;
revoke execute on function public.push_dispatch_tick() from public, anon, authenticated;
grant execute on function public.push_config_get() to service_role;
grant execute on function public.push_config_init_vapid(text, jsonb) to service_role;
grant execute on function public.push_claim_due() to service_role;

select cron.schedule('liftlog-push-dispatch', '5 seconds', $$ select public.push_dispatch_tick() $$);
