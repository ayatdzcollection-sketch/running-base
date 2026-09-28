-- ============================================================
-- Migration 003: multi-runner schema (bb_* tables). ADDITIVE ONLY.
--
-- Leaves the legacy tables alone (runs, athlete_state) and return-to-run's
-- tables (rtr_*). Everything new is prefixed bb_ and scoped to the
-- signed-in user through RLS. Safe to re-run.
-- ============================================================

create extension if not exists pgcrypto with schema extensions;

-- ── Invites: gate sign-up to people a teammate invited ──────────────
create table if not exists public.bb_invites (
  code        text primary key,
  created_by  uuid references auth.users on delete set null,
  uses_left   int  not null default 25,
  created_at  timestamptz not null default now()
);

-- ── Profile: one row per runner, created only through bb_redeem_invite ──
create table if not exists public.bb_profiles (
  user_id          uuid primary key references auth.users on delete cascade,
  display_name     text not null default '',
  birth_year       int,
  experience_years numeric,
  days_per_week    int  not null default 5 check (days_per_week between 3 and 7),
  long_run_day     int  not null default 5 check (long_run_day between 0 and 6), -- 0 = Mon … 6 = Sun
  units            text not null default 'mi' check (units in ('mi', 'km')),
  start_mpw        numeric not null default 15 check (start_mpw >= 0),
  start_longest    numeric not null default 4  check (start_longest >= 0),
  goal_mpw         numeric check (goal_mpw is null or goal_mpw > 0),
  hr_easy_max      int,
  plan_start       date not null default current_date,
  onboarded        boolean not null default false,
  settings         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ── School seasons (coach-led windows) ─────────────────────────────
create table if not exists public.bb_seasons (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users on delete cascade,
  kind         text not null default 'other' check (kind in ('xc', 'indoor', 'outdoor', 'other')),
  label        text not null default '',
  start_date   date not null,
  end_date     date check (end_date is null or end_date >= start_date),
  workout_days int[] not null default '{1,3}',   -- coach's hard days, 0 = Mon
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists bb_seasons_user on public.bb_seasons (user_id, start_date);

-- ── Planned meets / races on the calendar ──────────────────────────
create table if not exists public.bb_meets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  date        date not null,
  name        text not null default '',
  distance_mi numeric,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists bb_meets_user on public.bb_meets (user_id, date);

-- ── Activities: one row per run (several per day allowed) ──────────
create table if not exists public.bb_activities (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users on delete cascade,
  date               date not null,
  start_at           timestamptz,
  distance_mi        numeric not null default 0 check (distance_mi >= 0 and distance_mi < 100),
  duration_s         int check (duration_s is null or duration_s >= 0),
  avg_hr             int,
  max_hr             int,
  kind               text not null default 'easy' check (kind in ('easy', 'long', 'workout', 'race', 'cross', 'other')),
  source             text not null default 'manual' check (source in ('watch', 'manual', 'claude', 'import')),
  distance_estimated boolean not null default false,   -- true = checked off, distance taken from the plan
  rpe                smallint check (rpe is null or rpe between 1 and 10),
  notes              text,
  external_id        text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (user_id, external_id)
);
create index if not exists bb_activities_user_date on public.bb_activities (user_id, date);

-- ── Day status: makes a day "known" without a run (rest, sick, …) ──
create table if not exists public.bb_days (
  user_id    uuid not null references auth.users on delete cascade,
  date       date not null,
  status     text not null check (status in ('rest', 'skipped', 'sick', 'injured', 'travel')),
  note       text,
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);

-- ── Check-ins: pain / effort after a run or in the morning ─────────
create table if not exists public.bb_checkins (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  date        date not null,
  activity_id uuid references public.bb_activities on delete set null,
  moment      text not null default 'post_run' check (moment in ('post_run', 'morning')),
  pain        smallint check (pain is null or pain between 0 and 10),
  pain_area   text,
  rpe         smallint check (rpe is null or rpe between 1 and 10),
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists bb_checkins_user_date on public.bb_checkins (user_id, date);

-- ── Injuries: triage result + comeback progress ────────────────────
create table if not exists public.bb_injuries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  area        text not null,
  started_on  date not null,
  answers     jsonb not null default '{}'::jsonb,
  outcome     text not null check (outcome in ('run', 'easy', 'cross', 'stop')),
  likely      text,
  status      text not null default 'active' check (status in ('active', 'resolved')),
  stage       int  not null default 0,
  stage_since date,
  cleared_by_clinician boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists bb_injuries_user on public.bb_injuries (user_id, status);

-- ── Shoes ───────────────────────────────────────────────────────────
create table if not exists public.bb_shoes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  name        text not null,
  start_date  date not null,
  base_miles  numeric not null default 0,
  retire_at   numeric not null default 300,
  retired_at  date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ── Speed ladder and other small per-runner state ──────────────────
create table if not exists public.bb_state (
  user_id           uuid primary key references auth.users on delete cascade,
  speed_level       int  not null default 0 check (speed_level between 0 and 7),
  speed_level_since date,
  updated_at        timestamptz not null default now()
);

-- ── Personal tokens for the watch Shortcut and the Claude connector ──
create table if not exists public.bb_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users on delete cascade,
  kind         text not null check (kind in ('shortcut', 'mcp')),
  token_hash   text not null unique,
  hint         text not null,             -- last 4 characters, for display
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

-- ── Raw ingest log (what the Shortcut actually sent) ───────────────
create table if not exists public.bb_ingest_log (
  id          bigserial primary key,
  user_id     uuid references auth.users on delete cascade,
  received_at timestamptz not null default now(),
  payload     jsonb,
  result      text
);

-- ============================================================
-- Row Level Security: a runner sees and edits only their own rows,
-- and only once they have a profile (i.e. redeemed an invite).
-- ============================================================
create or replace function public.bb_is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.bb_profiles where user_id = auth.uid());
$$;

do $$
declare t text;
begin
  foreach t in array array['bb_seasons','bb_meets','bb_activities','bb_days','bb_checkins','bb_injuries','bb_shoes','bb_state'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format('create policy "own rows" on public.%I for all to authenticated using (user_id = auth.uid() and public.bb_is_member()) with check (user_id = auth.uid() and public.bb_is_member())', t);
  end loop;
end $$;

alter table public.bb_profiles enable row level security;
drop policy if exists "own profile read" on public.bb_profiles;
create policy "own profile read" on public.bb_profiles for select to authenticated using (user_id = auth.uid());
drop policy if exists "own profile update" on public.bb_profiles;
create policy "own profile update" on public.bb_profiles for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.bb_tokens enable row level security;
drop policy if exists "own tokens read" on public.bb_tokens;
create policy "own tokens read" on public.bb_tokens for select to authenticated using (user_id = auth.uid());
drop policy if exists "own tokens revoke" on public.bb_tokens;
create policy "own tokens revoke" on public.bb_tokens for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Invites and the ingest log have RLS on and no policies: only the
-- security-definer functions and the service role can touch them.
alter table public.bb_invites enable row level security;
alter table public.bb_ingest_log enable row level security;

-- ── Sign-up gate: create the profile only with a valid invite code ──
create or replace function public.bb_redeem_invite(invite_code text, name text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if exists (select 1 from public.bb_profiles where user_id = auth.uid()) then return; end if;
  update public.bb_invites set uses_left = uses_left - 1
   where code = upper(trim(invite_code)) and uses_left > 0;
  if not found then raise exception 'That invite code does not work.'; end if;
  insert into public.bb_profiles (user_id, display_name) values (auth.uid(), coalesce(trim(name), ''));
  insert into public.bb_state (user_id) values (auth.uid()) on conflict do nothing;
end $$;

-- ── Personal tokens: returned once in plain text, stored hashed ────
create or replace function public.bb_create_token(token_kind text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare raw text;
begin
  if not public.bb_is_member() then raise exception 'not a member'; end if;
  if token_kind not in ('shortcut', 'mcp') then raise exception 'bad kind'; end if;
  update public.bb_tokens set revoked_at = now()
   where user_id = auth.uid() and kind = token_kind and revoked_at is null;
  raw := 'bb_' || encode(gen_random_bytes(24), 'hex');
  insert into public.bb_tokens (user_id, kind, token_hash, hint)
  values (auth.uid(), token_kind, encode(digest(raw, 'sha256'), 'hex'), right(raw, 4));
  return raw;
end $$;

revoke all on function public.bb_redeem_invite(text, text) from public, anon;
revoke all on function public.bb_create_token(text) from public, anon;
grant execute on function public.bb_redeem_invite(text, text) to authenticated;
grant execute on function public.bb_create_token(text) to authenticated;
