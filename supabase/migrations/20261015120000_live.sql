-- FragBoard live store: one tiny JSONB row per key ('now' = live list, 'm:<id>' = scoreboard, 'news' = news)
create table if not exists public.live (
  k  text primary key,
  v  jsonb not null,
  at timestamptz not null default now()
);

alter table public.live enable row level security;

-- anyone may read
drop policy if exists live_read on public.live;
create policy live_read on public.live for select to anon, authenticated using (true);

-- only the collector may write: it sends header x-fb-key whose sha256 must match
create or replace function public.fb_can_write() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    encode(extensions.digest(coalesce(current_setting('request.headers', true)::json->>'x-fb-key',''), 'sha256'), 'hex')
      = '2728ccd066d265b69206b6b4de5e27a2e0e3d6bc45b04d865b6aaf431272ef07', false)
$$;

drop policy if exists live_ins on public.live;
create policy live_ins on public.live for insert to anon with check (public.fb_can_write());
drop policy if exists live_upd on public.live;
create policy live_upd on public.live for update to anon using (public.fb_can_write()) with check (public.fb_can_write());
drop policy if exists live_del on public.live;
create policy live_del on public.live for delete to anon using (public.fb_can_write());

-- push row changes to subscribers instantly
do $$ begin
  alter publication supabase_realtime add table public.live;
exception when duplicate_object then null; end $$;
