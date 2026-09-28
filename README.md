# Bulletproof Base

A training companion for high school distance runners, built around the school
calendar. The year cycles on its own: **build** between seasons, **coach mode**
while a season is on (the coach owns the workouts), a short **break** after it,
then build again toward the next season. Runs arrive from an Apple Watch (via an
iOS Shortcut) or from Claude; typing is the fallback.

Invite-only. Installable as a PWA (Add to Home Screen on iPhone).

## How it's put together

| Piece | Where | What it does |
| --- | --- | --- |
| Engine | `src/engine/` | Pure TypeScript. Data in, plan out. Shared by the app, the Claude connector and the tests. |
| App | `src/app`, `src/screens`, `src/ui`, `src/data` | React + Vite PWA. Design tokens in `src/styles.css`. |
| Database | Supabase, `bb_*` tables | Row Level Security scopes every row to its runner; sign-up needs an invite code. |
| Watch ingest | `supabase/functions/ingest` | The Shortcut POSTs a finished workout here with the runner's code. |
| Claude connector | `supabase/functions/mcp` | Remote MCP server (Streamable HTTP). The runner's private link ends in their code. |

The legacy tables `runs` and `athlete_state` (the original single-runner app)
and `rtr_*` (a separate app) share the project and are never touched by the
migrations.

## The engine's rules (plain version)

- **A day with no data is unknown, never zero.** Only fully known weeks can pull
  a plan down; silence never slides the "usual week".
- **Build:** about +10% a week in whole miles (1–3 mi), a lighter week (85%)
  after every 4 build weeks, never more than 15% above the biggest recent known
  week, a ceiling by experience (lower for runners 15 and under).
- **Facts steer the build:** a week run at 85%+ of plan keeps building; a fully
  known week well under it restarts from what was run, once.
- **Long run:** at most 30% of the week, about 10% past the longest run in the
  last 30 days. That limit caps every run; a week that can't fit comes out smaller.
- **Coach mode:** easy days keep the runner near their usual week (median of the
  last 3 fully known weeks). No app lighter weeks.
- **Plan changes:** future days only. Moving, swapping and cutting are fine;
  adding miles past the week target or the long-run limit is refused; during an
  injury only rest or cross-training.
- **Injury check:** rule-based triage per body area. Red flags (one sharp spot on
  a bone, pain when hopping, pain at night, limping, a pop, numbness) mean stop
  and see a trainer or doctor. Otherwise it follows the pain-monitoring rule. A
  six-stage comeback moves up after two good days.
- **Speed ladder:** 7 levels, each unlocked by 4 pain-free check-ins; in season
  only strides; paused during injuries.

Every number lives in `src/engine/rules.ts` with the reason for it.
`auditEngine()` checks these rules against real data; the tests run it too.

## Claude connector (MCP)

In the app: **You → Claude → Make my link**, then in Claude **Customize →
Connectors → Add custom connector**, paste the link, choose **No sign-in**.

32 tools, including: today and full status, weekly review, week details,
runs/notes/changes lists, log runs and races, fix/delete runs, mark days,
check-ins, notes, **preview → apply plan changes**, reset days, settings,
seasons, meets, shoes, the injury check and comeback updates, **trace a week**
(how its number was decided), **audit the plan** (engine self-checks), **report
a problem**, and **undo** (every connector write is logged with before/after
rows in `bb_changes`).

## Development

```bash
npm install
cp .env.example .env.local   # VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
npm run dev
npm test                     # engine tests
npm run build
```

A private regression test runs on a real log when
`src/engine/__tests__/fixtures/private/youcef.json` exists (git-ignored).

### Database and functions

```bash
# migrations are additive and safe to re-run
supabase db query --linked --project-ref <ref> -f supabase/migrations/003_bb_schema.sql   # then 004, 005

# always sync the engine before deploying the connector
node scripts/sync-engine.mjs
supabase functions deploy mcp    --project-ref <ref> --no-verify-jwt --use-api
supabase functions deploy ingest --project-ref <ref> --no-verify-jwt --use-api
```

Sign-in uses email codes. Supabase's default email template sends a link; the
**Magic Link** template must include `{{ .Token }}`. The built-in email sender
only reaches the project's own team, so inviting teammates needs custom SMTP
(e.g. Resend).

`docs/archive/` holds the research and specs from the original single-runner app.
