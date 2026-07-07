import type { BlockMeta } from '../config/homeBlocks';

// ============================================================
// PROPOSED-BLOCK STUBS (Stage H) — polished, INERT placeholders.
//
// These render on the home screen only when the user enables them from
// Settings → Home layout. They are intentionally non-interactive: no fake
// buttons, no disabled inputs that imply near-term function. Each needs its
// own data model, UI, sync, and — per the design's own dev note — real
// research before it ships. TODOs below spell out the requirements and the
// safety boundary each must respect.
//
// ── notes (Daily notes) ──────────────────────────────────────
//   Data model: additive optional `note?: string | null` on RunEntry
//   (localStorage-safe today; Supabase needs an additive `note text` column on
//   runs, following the v2-column fallback in storage.ts). Cap ~500 chars.
//   Safety: free text is NEVER parsed by any gate or metric — purely human.
//
// ── checkin (Weekly check-in) ────────────────────────────────
//   Data model: a record keyed by weekStart (Mon YYYY-MM-DD) — energy / sleep /
//   soreness-trend / motivation 1–5 — stored additively on GlobalState (a new
//   optional field via migrateGlobalState) or its own key.
//   Safety: answers may SUGGEST holding or stepping down, but must NEVER
//   auto-advance speedState or relax painCap / readiness gates. Upward moves
//   stay behind the existing checklist in lib/speed.ts.
//
// ── shoes (Shoe mileage) ─────────────────────────────────────
//   Data model: `shoes: {id,name,startDate,retiredAt?,baseMiles}[]` in settings;
//   per-run attribution by date range or an optional RunEntry.shoeId. Mileage
//   derived from the existing run log (same effective-miles logic as the stats).
//   Safety: worn-shoe warnings are advisory only — never block logging, never
//   feed the cap / gate math.
//
// ── coach (Coach / PT thread) ────────────────────────────────
//   Data model: a `messages` table (access_code, author_role, body, created_at)
//   AND a real identity / delivery / read-acknowledgment story before ANY send
//   button exists. Safety: the UI must never imply a coach or PT receives
//   messages until delivery is real; PT clearance stays a manual toggle in the
//   Speed plan and is NEVER settable from thread content. Copy must say
//   "concept — nothing is sent anywhere."
//
// ── weather (Heat-adjusted effort) ───────────────────────────
//   Data model: manual temp/humidity entry (or later a weather API) → displayed
//   GUIDANCE like "hot day: expect HR ~5–8 bpm higher at the same easy pace;
//   slow down rather than push". Safety: MUST NOT modify painCap, the nextLong
//   ceiling, speed-state gates, or the HR hard cap — output is display-only
//   effort guidance, never an input to any rule.
// ============================================================

export default function StubCard({ meta }: { meta: BlockMeta }) {
  return (
    <section
      data-block={meta.id}
      className="rounded-2xl border border-dashed border-border bg-[#070c15] px-[18px] py-4 flex flex-col gap-1.5"
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-display text-[13px] font-semibold text-slate-400">{meta.label}</span>
        <span className="inline-flex px-1.5 rounded-full font-display text-[9px] font-semibold tracking-wider bg-slate-500/[0.12] text-slate-500 border border-border">
          NOT BUILT YET
        </span>
      </div>
      {meta.desc && <p className="m-0 text-xs leading-relaxed text-slate-500">{meta.desc}</p>}
      <p className="m-0 text-[11px] text-slate-600">Enabled from Settings → Home layout. A concept, not active — nothing is recorded or sent.</p>
    </section>
  );
}
