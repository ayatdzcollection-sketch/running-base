import { useState } from 'react';

/**
 * Cloud-sync setup banner.
 *
 * The app already saves your whole training state as one JSON blob and reloads
 * it verbatim on any device — that is the `athlete_state` table. When that table
 * does not exist the blob has nowhere to go, so settings, the pain baseline,
 * shoes and speed state stay on ONE device while runs keep syncing normally.
 *
 * That used to fail silently: a console warning nobody reads, while the header
 * still said "synced". Opening the app on a second device then showed defaults,
 * which reads as data loss. This banner states the problem plainly and hands
 * over the exact SQL to fix it — the app cannot create the table itself, because
 * the public anon key has no DDL rights (by design).
 */

const SQL = `-- Bulletproof Base — cloud sync setup (safe + idempotent)
alter table public.runs add column if not exists rpe          smallint;
alter table public.runs add column if not exists pain_during  smallint;
alter table public.runs add column if not exists pain_next_am smallint;
alter table public.runs add column if not exists did_strides  boolean;
alter table public.runs add column if not exists stride_note  text;

create table if not exists public.athlete_state (
  access_code text primary key,
  state       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

alter table public.athlete_state enable row level security;

drop policy if exists "anon can read athlete_state" on public.athlete_state;
create policy "anon can read athlete_state"
  on public.athlete_state for select using (true);

drop policy if exists "anon can insert athlete_state" on public.athlete_state;
create policy "anon can insert athlete_state"
  on public.athlete_state for insert with check (true);

drop policy if exists "anon can update athlete_state" on public.athlete_state;
create policy "anon can update athlete_state"
  on public.athlete_state for update using (true) with check (true);`;

export default function CloudSetupBanner() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(SQL);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setOpen(true); // clipboard blocked — at least reveal the SQL to select by hand
    }
  };

  return (
    <div
      data-block="cloudsetup"
      className="rounded-2xl border border-amber-500/25 bg-amber-500/[0.06] px-4 py-3.5 flex flex-col gap-[6px]"
    >
      <span className="font-display text-[10.5px] font-semibold tracking-[0.12em] text-amber-300">
        CLOUD SYNC · SETUP NEEDED
      </span>
      <p className="m-0 text-[13px] leading-relaxed text-slate-300">
        Your runs are syncing, but <strong className="text-slate-200">settings, pain history,
        shoes and speed progress are only on this device</strong> — the cloud table that holds
        them doesn't exist yet. Open the app on another device and it will show defaults.
      </p>
      <p className="m-0 text-[12.5px] leading-snug text-slate-400">
        One-time fix: run this in your Supabase project → SQL Editor. It's additive and safe to
        re-run — it never touches the runs you've already logged.
      </p>
      <div className="flex items-center gap-2 mt-0.5">
        <button
          onClick={copy}
          className="px-3 py-1.5 rounded-[9px] border border-amber-500/40 bg-amber-500/10
                     text-[11.5px] text-amber-200 hover:border-amber-400/60 transition"
        >
          {copied ? 'Copied ✓' : 'Copy SQL'}
        </button>
        <button
          onClick={() => setOpen(o => !o)}
          className="px-3 py-1.5 rounded-[9px] border border-border text-[11.5px]
                     text-slate-400 hover:border-slate-600 transition"
        >
          {open ? 'Hide' : 'Show SQL'}
        </button>
      </div>
      {open && (
        <pre
          className="mt-1 max-h-[240px] overflow-auto rounded-lg border border-border bg-ink
                     p-2.5 text-[10.5px] leading-relaxed text-slate-400 whitespace-pre"
        >{SQL}</pre>
      )}
      <p className="m-0 mt-0.5 text-[11.5px] leading-snug text-slate-500">
        Until then everything keeps working normally on this device, and nothing you've logged
        is at risk — it just won't follow you to a new browser.
      </p>
    </div>
  );
}
