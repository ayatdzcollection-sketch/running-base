interface Props {
  current: number;         // today's target miles (clamped to the live ceiling)
  cap: number;             // live nextLong ceiling from trailing-30-day actuals
  actual?: number | null;  // logged actual — drives the fill and full opacity
}

// Semicircle cap gauge (design spec): a full track with a colored arc filling
// to today's fraction of the cap, plus a needle. Teal under cap, amber at the
// cap, rose over it. Faded until the run is logged.
export default function CapGauge({ current, cap, actual }: Props) {
  const cur = actual != null ? actual : current;
  const done = actual != null;
  const LEN = Math.PI * 84;
  const frac = cap > 0 ? cur / cap : 0;
  const arc = Math.min(frac, 1);

  const color = frac > 1.001 ? '#fb7185' : frac > 0.949 ? '#f59e0b' : '#2dd4bf';
  const dash = `${(LEN * arc).toFixed(1)} ${Math.ceil(LEN + 2)}`;
  const nx = (100 - 74 * Math.cos(Math.PI * arc)).toFixed(1);
  const ny = (104 - 74 * Math.sin(Math.PI * arc)).toFixed(1);

  const under = cap - cur;
  const label =
    under > 0.05 ? `${under.toFixed(1)} mi under this week's ${cap.toFixed(1)} mi cap`
    : cur - cap > 0.05 ? `${(cur - cap).toFixed(1)} mi OVER the cap. Pull it back`
    : `right at the ${cap.toFixed(1)} mi cap`;

  return (
    <div className="flex flex-col items-center gap-0.5">
      <svg viewBox="0 0 200 120" className="w-[232px] max-w-full block" aria-label={`${cur} mi vs ${cap} mi cap`}>
        <path d="M16,104 A84,84 0 0 1 184,104" fill="none" stroke="#1e293b" strokeWidth="12" strokeLinecap="round" />
        <path d="M16,104 A84,84 0 0 1 184,104" fill="none" stroke={color} strokeWidth="12" strokeLinecap="round"
          strokeDasharray={dash} opacity={done ? 1 : 0.62}
          style={{ transition: 'stroke-dasharray .5s ease, opacity .3s ease' }} />
        <line x1="100" y1="104" x2={nx} y2={ny} stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" />
        <circle cx="100" cy="104" r="5" fill="#0b1220" stroke="#334155" strokeWidth="2" />
        <text x="16" y="118" fill="#64748b" fontSize="9" fontFamily="Space Grotesk, sans-serif" textAnchor="middle">0</text>
        <text x="184" y="118" fill="#64748b" fontSize="9" fontFamily="Space Grotesk, sans-serif" textAnchor="middle">{cap}</text>
      </svg>
      <span className="font-display text-xs text-slate-400 tabular-nums">{label}</span>
      <span className="font-display text-[10.5px] tracking-[0.1em] uppercase text-slate-700">nothing exceeds the cap</span>
    </div>
  );
}
