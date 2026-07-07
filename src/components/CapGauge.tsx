interface Props {
  current: number;         // today's target miles (clamped to the live ceiling)
  cap: number;             // live nextLong ceiling from trailing-30-day actuals
  actual?: number | null;  // logged actual — rose if it exceeds the cap
}

export default function CapGauge({ current, cap, actual }: Props) {
  const CX = 100;
  const CY = 100;
  const R = 80;
  const SW = 10; // stroke width

  const ratio = cap > 0 ? Math.min(current / cap, 1.2) : 0;

  // angle goes π (left) → 0 (right) as p goes 0 → 1
  // In SVG (Y-down), sweep=1 is clockwise on screen: left → top → right ✓
  function pt(p: number) {
    const a = Math.PI * (1 - p);
    return { x: CX + R * Math.cos(a), y: CY - R * Math.sin(a) };
  }

  const startPt = pt(0); // (20, 100)
  const endPt   = pt(1); // (180, 100)

  function fillPath(p: number): string {
    if (p <= 0) return '';
    const { x, y } = pt(Math.min(p, 1));
    // sweep=1 (clockwise on screen) = upper semicircle
    return `M ${startPt.x} ${startPt.y} A ${R} ${R} 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)}`;
  }

  // teal below cap · amber at cap · rose only when a LOGGED actual exceeds it
  const actualOver = actual != null && actual > cap;
  const color =
    actualOver || ratio > 1 ? '#fb7185' : ratio >= 0.95 ? '#f59e0b' : '#2dd4bf';

  const needle = pt(Math.min(ratio, 1));

  return (
    <div className="flex flex-col items-center gap-1">
      <svg
        viewBox="0 0 200 115"
        className="w-48 h-auto"
        aria-label={`${current} mi vs ${cap} mi cap`}
      >
        {/* Track — full upper semicircle */}
        <path
          d={`M ${startPt.x} ${startPt.y} A ${R} ${R} 0 0 1 ${endPt.x} ${endPt.y}`}
          fill="none"
          stroke="#334155"
          strokeWidth={SW}
          strokeLinecap="round"
        />

        {/* Fill — portion driven by today's distance */}
        {ratio > 0 && (
          <path
            d={fillPath(ratio)}
            fill="none"
            stroke={color}
            strokeWidth={SW}
            strokeLinecap="round"
          />
        )}

        {/* Needle from center to arc point */}
        <line
          x1={CX} y1={CY}
          x2={needle.x} y2={needle.y}
          stroke={color}
          strokeWidth={2.5}
          strokeLinecap="round"
          opacity={0.85}
        />
        <circle cx={CX} cy={CY} r={4} fill={color} />

        {/* End-point labels */}
        <text x={startPt.x} y={CY + 14} textAnchor="middle"
          fontSize={9} fill="#64748b" fontFamily="Space Grotesk, sans-serif">0</text>
        <text x={endPt.x} y={CY + 14} textAnchor="middle"
          fontSize={9} fill="#64748b" fontFamily="Space Grotesk, sans-serif">{cap}</text>
      </svg>

      <p className="text-xs text-slate-500 tabular-nums">
        {current} mi / {cap} mi cap
      </p>
    </div>
  );
}
