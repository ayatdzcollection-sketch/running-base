-- Owner profile, season, shoe and first invite code. Idempotent.
insert into public.bb_profiles (user_id, display_name, days_per_week, long_run_day, start_mpw, start_longest, hr_easy_max, plan_start, onboarded)
values ('86831193-48a9-49a9-9df4-92eb8adbe313', 'Youcef', 5, 5, 20, 4.5, 150, '2026-06-29', true)
on conflict (user_id) do nothing;
insert into public.bb_state (user_id) values ('86831193-48a9-49a9-9df4-92eb8adbe313') on conflict do nothing;
insert into public.bb_seasons (user_id, kind, label, start_date, end_date, workout_days)
select '86831193-48a9-49a9-9df4-92eb8adbe313', 'xc', 'Cross country', '2026-08-20', null, '{1,3}'
where not exists (select 1 from public.bb_seasons where user_id = '86831193-48a9-49a9-9df4-92eb8adbe313' and kind = 'xc' and start_date = '2026-08-20');
insert into public.bb_shoes (user_id, name, start_date, retire_at)
select '86831193-48a9-49a9-9df4-92eb8adbe313', 'Asics', '2026-06-28', 250
where not exists (select 1 from public.bb_shoes where user_id = '86831193-48a9-49a9-9df4-92eb8adbe313');
insert into public.bb_invites (code, created_by, uses_left)
values ('BASE-' || upper(substr(md5(random()::text), 1, 5)), '86831193-48a9-49a9-9df4-92eb8adbe313', 25)
on conflict do nothing;
