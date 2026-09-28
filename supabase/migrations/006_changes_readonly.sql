-- The change log is written only by the Claude connector (service role).
-- Members may read their own entries but never write them, because undo
-- replays these rows. Safe to re-run.
drop policy if exists "own rows" on public.bb_changes;
drop policy if exists "own changes read" on public.bb_changes;
create policy "own changes read" on public.bb_changes for select to authenticated
  using (user_id = auth.uid() and public.bb_is_member());
