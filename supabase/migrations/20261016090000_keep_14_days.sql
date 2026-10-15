-- keep finished-match results ('r:<id>') and scoreboards ('m:<id>') for 14 days, then drop them
create extension if not exists pg_cron;

create or replace function public.live_cleanup() returns void
language sql security definer set search_path = '' as $$
  delete from public.live
  where (k like 'r:%' or k like 'm:%') and at < now() - interval '14 days';
$$;

do $$ begin
  perform cron.unschedule('live-cleanup-14d');
exception when others then null; end $$;
select cron.schedule('live-cleanup-14d', '17 3 * * *', 'select public.live_cleanup()');
