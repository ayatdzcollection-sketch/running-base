import type { BlockMeta } from '../config/homeBlocks';

// ============================================================
// STUB CARD — polished, INERT fallback.
//
// The five secondary widgets it once stood in for (Daily notes, Weekly
// check-in, Shoe mileage, Coach/PT log, Heat-adjusted effort) all SHIPPED as
// real, functional cards. This card now renders only as the compile-time
// kill-switch fallback: if a FLAGS.<widget> is flipped back to false, its
// renderBlock case shows this instead of the live component, so a disabled
// feature still looks intentional rather than blank. It stays deliberately
// non-interactive. See each widget's source + lib module for the real data
// model and the safety boundary it respects (all display-only / additive;
// none feeds a cap, gate, or the speed ladder).
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
      <p className="m-0 text-[11px] text-slate-600">Enabled from Settings → Home layout. A concept, not active. Nothing is recorded or sent.</p>
    </section>
  );
}
