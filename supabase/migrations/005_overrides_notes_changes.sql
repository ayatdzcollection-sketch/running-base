-- ============================================================
-- Migration 005: plan changes, notes, change log, problem reports.
-- Additive only; legacy and rtr_* tables untouched. Safe to re-run.
-- ============================================================

-- A day of the plan changed on purpose (by the runner or by Claude).
create table if not exists public.bb_plan_overrides (
  user_id    uuid not null references auth.users on delete cascade,
  date       date not null,
  kind       text not null check (kind in ('easy', 'long', 'rest', 'cross', 'workout')),
  miles      numeric check (miles is null or (miles > 0 and miles < 40)),
  note       text,
  source     text not null default 'app' check (source in ('app', 'claude')),
  created_at timestamptz not null default now(),
  primary key (user_id, date)
);

-- Free-text notes on a day.
create table if not exists public.bb_notes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users on delete cascade,
  date       date not null,
  body       text not null check (length(body) between 1 and 4000),
  source     text not null default 'app' check (source in ('app', 'claude', 'import')),
  created_at timestamptz not null default now()
);
create index if not exists bb_notes_user_date on public.bb_notes (user_id, date);

-- Every change the Claude connector makes, so it can be shown and undone.
create table if not exists public.bb_changes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users on delete cascade,
  at         timestamptz not null default now(),
  source     text not null default 'claude',
  tool       text not null,
  summary    text not null,
  ops        jsonb not null,          -- [{table, op: insert|update|delete|upsert, key, before, after}]
  undone_at  timestamptz
);
create index if not exists bb_changes_user_at on public.bb_changes (user_id, at desc);

-- Problems found in the plan or engine, for a developer to reproduce.
create table if not exists public.bb_feedback (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users on delete cascade,
  at             timestamptz not null default now(),
  source         text not null default 'claude',
  title          text not null,
  detail         text not null default '',
  engine_version text,
  snapshot       jsonb,
  status         text not null default 'open' check (status in ('open', 'fixed', 'wontfix'))
);

do $$
declare t text;
begin
  foreach t in array array['bb_plan_overrides','bb_notes','bb_changes','bb_feedback'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format('create policy "own rows" on public.%I for all to authenticated using (user_id = auth.uid() and public.bb_is_member()) with check (user_id = auth.uid() and public.bb_is_member())', t);
  end loop;
end $$;
