-- ============================================================
-- Migration 007: close public access to the retired single-runner tables.
-- The new app no longer uses `runs` or `athlete_state`; their rows stay
-- (they are the original log, also backed up), but the public anon key can
-- no longer read or write them. RLS stays on with no policies, so only the
-- service role can reach them. return-to-run's rtr_* tables are NOT touched.
--
-- To undo (restores the old open access):
--   create policy "anon full access" on public.runs for all to anon using (true) with check (true);
--   create policy "anon can read athlete_state"   on public.athlete_state for select using (true);
--   create policy "anon can insert athlete_state" on public.athlete_state for insert with check (true);
--   create policy "anon can update athlete_state" on public.athlete_state for update using (true) with check (true);
-- ============================================================
alter table public.runs enable row level security;
alter table public.athlete_state enable row level security;
drop policy if exists "anon full access" on public.runs;
drop policy if exists "anon can read athlete_state" on public.athlete_state;
drop policy if exists "anon can insert athlete_state" on public.athlete_state;
drop policy if exists "anon can update athlete_state" on public.athlete_state;
