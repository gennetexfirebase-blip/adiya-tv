-- run the PandaScore poller (edge function panda-live) every minute; it polls for ~55 s on its own
create extension if not exists pg_net;
do $$ begin perform cron.unschedule('panda-live-every-minute'); exception when others then null; end $$;
select cron.schedule('panda-live-every-minute', '* * * * *', $cron$
  select net.http_post(
    url := 'https://lipwcqmjhcxppscbsmzp.supabase.co/functions/v1/panda-live',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxpcHdjcW1qaGN4cHBzY2JzbXpwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwMjg1NzIsImV4cCI6MjEwNzYwNDU3Mn0.gNCvEqPYU4udvMZ9BWLcRdZKeAX4TzUIHM8NH1o6ipA"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 60000);
$cron$);
