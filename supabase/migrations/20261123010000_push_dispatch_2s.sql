-- Check for due rest alerts every 2 seconds (was 5) so the buzz lands close to 0:00.
create or replace function public.push_claim_due()
returns table (user_id uuid, kind text, title text, body text)
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.notification_schedule s where s.sent_at < now() - interval '1 day';
  return query
    update public.notification_schedule s
       set sent_at = now()
     where s.sent_at is null and s.due_at <= now() + interval '1.5 seconds'
       and s.due_at > now() - interval '10 minutes'
    returning s.user_id, s.kind, s.title, s.body;
end $$;

create or replace function public.push_dispatch_tick()
returns void
language plpgsql security definer set search_path = '' as $$
declare
  secret text;
begin
  if not exists (
    select 1 from public.notification_schedule
     where sent_at is null and due_at <= now() + interval '1.5 seconds'
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

revoke execute on function public.push_claim_due() from public, anon, authenticated;
revoke execute on function public.push_dispatch_tick() from public, anon, authenticated;
grant execute on function public.push_claim_due() to service_role;

select cron.schedule('liftlog-push-dispatch', '2 seconds', $$ select public.push_dispatch_tick() $$);
