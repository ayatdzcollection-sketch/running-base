-- ============================================================
-- Migration 002 — speed layer (ADDITIVE, NON-DESTRUCTIVE)
--
-- Safe to run on the live database:
--   * ADD COLUMN IF NOT EXISTS never touches existing rows — every
--     existing row simply reads NULL for the new columns.
--   * No column is dropped, renamed, retyped, or given a backfill.
--   * CREATE TABLE IF NOT EXISTS only creates the new athlete_state
--     table; it cannot affect the existing runs table.
--   * Re-running this file is a no-op (idempotent).
-- ============================================================

-- 1. New nullable per-day columns on runs (defaults NULL — additive).
alter table public.runs add column if not exists rpe          smallint;
alter table public.runs add column if not exists pain_during  smallint;
alter table public.runs add column if not exists pain_next_am smallint;
alter table public.runs add column if not exists did_strides  boolean;
alter table public.runs add column if not exists stride_note  text;

-- 2. New table for global speed-layer state (one jsonb row per access code).
--    Brand-new table — cannot touch existing data.
create table if not exists public.athlete_state (
  access_code text primary key,
  state       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

-- 3. Row Level Security — mirror the pattern already used for runs.
--    The app authenticates by access code with the public anon key, so the
--    policies allow anon read/write (same trust model as the runs table).
--    If your runs table uses different policies, copy those instead.
alter table public.athlete_state enable row level security;

drop policy if exists "anon can read athlete_state" on public.athlete_state;
create policy "anon can read athlete_state"
  on public.athlete_state for select
  using (true);

drop policy if exists "anon can insert athlete_state" on public.athlete_state;
create policy "anon can insert athlete_state"
  on public.athlete_state for insert
  with check (true);

drop policy if exists "anon can update athlete_state" on public.athlete_state;
create policy "anon can update athlete_state"
  on public.athlete_state for update
  using (true)
  with check (true);

-- ── Verification (run after; both should show your data intact) ──
-- select count(*), max(updated_at) from public.runs;
-- select date, done, miles_actual, rpe, pain_during from public.runs order by date;
