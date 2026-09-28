-- ============================================================
-- Migration 008: sign in on another app with a short code.
-- A signed-in browser (e.g. Safari after tapping the email link) makes a
-- 6-digit code; the Home Screen app trades it for its own session through
-- the `pair` edge function. One code per runner, 10 minutes, 5 tries.
-- ============================================================
create table if not exists public.bb_pairing (
  user_id    uuid primary key references auth.users on delete cascade,
  email      text not null,
  code_hash  text not null,
  expires_at timestamptz not null,
  attempts   int not null default 0
);
alter table public.bb_pairing enable row level security;   -- no policies: functions only

create or replace function public.bb_make_pairing_code()
returns text language plpgsql security definer set search_path = public, extensions as $$
declare c text; e text;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select email into e from auth.users where id = auth.uid();
  c := lpad((floor(random() * 1000000))::int::text, 6, '0');
  insert into public.bb_pairing (user_id, email, code_hash, expires_at, attempts)
  values (auth.uid(), lower(e), encode(digest(c, 'sha256'), 'hex'), now() + interval '10 minutes', 0)
  on conflict (user_id) do update set email = excluded.email, code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0;
  return c;
end $$;
revoke all on function public.bb_make_pairing_code() from public, anon;
grant execute on function public.bb_make_pairing_code() to authenticated;
