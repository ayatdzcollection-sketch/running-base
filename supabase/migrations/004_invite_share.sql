-- Each member has an invite code they can share with teammates (created on
-- first ask). Additive; safe to re-run.
create or replace function public.bb_my_invite()
returns text language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if not public.bb_is_member() then return null; end if;
  select code into c from public.bb_invites where created_by = auth.uid() and uses_left > 0 order by created_at limit 1;
  if c is null then
    c := 'BASE-' || upper(substr(md5(random()::text || auth.uid()::text), 1, 5));
    insert into public.bb_invites (code, created_by, uses_left) values (c, auth.uid(), 25);
  end if;
  return c;
end $$;
revoke all on function public.bb_my_invite() from public, anon;
grant execute on function public.bb_my_invite() to authenticated;
