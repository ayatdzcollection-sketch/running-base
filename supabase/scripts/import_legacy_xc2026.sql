-- ============================================================
-- One-off, idempotent import of the original single-runner log
-- (public.runs, access code XC2026) into the owner's bb_* account.
-- READS the legacy tables, never writes them. Safe to re-run: every row
-- is keyed by external_id 'legacy:<date>' or the (user_id, date) key.
-- ============================================================

with owner as (select '86831193-48a9-49a9-9df4-92eb8adbe313'::uuid as id),
-- Planned miles for days that were checked off without a distance
-- (reconstructed from the old engine's plan for those weeks).
planned(date, miles) as (values
  ('2026-07-08'::date, 4.0), ('2026-07-15', 5.0), ('2026-07-16', 4.5),
  ('2026-07-20', 6.0), ('2026-07-21', 6.0), ('2026-07-22', 5.5), ('2026-07-24', 6.0),
  ('2026-07-27', 5.0), ('2026-07-28', 4.5), ('2026-07-29', 4.5), ('2026-07-30', 3.5),
  ('2026-08-03', 6.0), ('2026-08-04', 6.0), ('2026-08-11', 6.0)
),
legacy as (
  select r.*, p.miles as plan_miles
  from public.runs r left join planned p on p.date = r.date::date
  where r.access_code = 'XC2026'
)
insert into public.bb_activities
  (user_id, date, distance_mi, kind, source, distance_estimated, rpe, external_id, created_at, updated_at)
select (select id from owner), l.date::date,
       coalesce(nullif(l.miles_actual, 0), l.plan_miles),
       case when coalesce(nullif(l.miles_actual, 0), l.plan_miles) >= 7 then 'long' else 'easy' end,
       'import',
       (coalesce(l.miles_actual, 0) = 0),
       l.rpe, 'legacy:' || l.date, l.updated_at, now()
from legacy l
where coalesce(nullif(l.miles_actual, 0), l.plan_miles) is not null
  and (l.done or coalesce(l.miles_actual, 0) > 0)
on conflict (user_id, external_id) do update
  set distance_mi = excluded.distance_mi, distance_estimated = excluded.distance_estimated,
      rpe = excluded.rpe, kind = excluded.kind, updated_at = now();

-- Explicit skips (done = false, 0 miles) become known "skipped" days.
insert into public.bb_days (user_id, date, status, note)
select '86831193-48a9-49a9-9df4-92eb8adbe313'::uuid, r.date::date, 'skipped', 'imported from the old app'
from public.runs r
where r.access_code = 'XC2026' and not r.done and coalesce(r.miles_actual, 0) = 0
on conflict (user_id, date) do nothing;

-- Logged pain becomes a post-run check-in (once).
insert into public.bb_checkins (user_id, date, moment, pain, pain_area, note)
select '86831193-48a9-49a9-9df4-92eb8adbe313'::uuid, r.date::date, 'post_run', r.pain_during, 'hip', 'imported from the old app'
from public.runs r
where r.access_code = 'XC2026' and r.pain_during is not null
  and not exists (select 1 from public.bb_checkins c
                  where c.user_id = '86831193-48a9-49a9-9df4-92eb8adbe313' and c.date = r.date::date and c.note = 'imported from the old app');

-- Next-morning pain becomes a morning check-in on the following day (once).
insert into public.bb_checkins (user_id, date, moment, pain, pain_area, note)
select '86831193-48a9-49a9-9df4-92eb8adbe313'::uuid, r.date::date + 1, 'morning', r.pain_next_am, 'hip', 'imported from the old app'
from public.runs r
where r.access_code = 'XC2026' and r.pain_next_am is not null
  and not exists (select 1 from public.bb_checkins c
                  where c.user_id = '86831193-48a9-49a9-9df4-92eb8adbe313' and c.date = r.date::date + 1
                    and c.moment = 'morning' and c.note = 'imported from the old app');
