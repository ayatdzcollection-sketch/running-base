interface Props {
  current: number;  // today's prescribed miles
  cap: number;      // week's long-run cap (Friday miles)
}

export default function CapGauge({ current, cap }: Props) {
  const CX = 100;
  const CY = 100;
  const R = 76;
  const STROKE = 10;

  // ratio: 0 = left, 1 = right
  const ratio = cap > 0 ? Math.min(current / cap, 1.2) : 0;

  function arcPoint(p: number) {
    const angle = Math.PI - p * Math.PI; // π → 0 as p → 1
    return {
      x: CX + R * Math.cos(angle),
      y: CY - R * Math.sin(angle),
    };
  }

  function arcPath(p: number) {
    if (p <= 0) return '';
    const clamped = Math.min(p, 1);
    const end = arcPoint(clamped);
    const largeArc = clamped > 0.5 ? 1 : 0;
    const start = arcPoint(0);
    return `M ${start.x} ${start.y} A ${R} ${R} 0 ${largeArc} 0 ${end.x} ${end.y}`;
  }

  // Color: teal under cap, amber at cap, rose over cap
  const color =
    ratio > 1 ? '#fb7185' : ratio >= 0.95 ? '#f59e0b' : '#2dd4bf';

  // Needle endpoint
  const needle = arcPoint(Math.min(ratio, 1));
  const startPt = arcPoint(0);

  return (
    <div className="flex flex-col items-center gap-1">
      <svg
        viewBox="0 0 200 110"
        className="w-48 h-auto motion-safe:transition-all"
        aria-label={`${current} mi vs ${cap} mi cap`}
      >
        {/* Track */}
        <path
          d={`M ${startPt.x} ${startPt.y} A ${R} ${R} 0 0 0 ${arcPoint(1).x} ${arcPoint(1).y}`}
          fill="none"
          stroke="#1e293b"
          strokeWidth={STROKE}
          strokeLinecap="round"
        />
        {/* Fill */}
        {ratio > 0 && (
          <path
            d={arcPath(ratio)}
            fill="none"
            stroke={color}
            strokeWidth={STROKE}
            strokeLinecap="round"
          />
        )}
        {/* Needle */}
        <line
          x1={CX}
          y1={CY}
          x2={needle.x}
          y2={needle.y}
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
          opacity={0.9}
        />
        {/* Center dot */}
        <circle cx={CX} cy={CY} r={4} fill={color} />
        {/* Labels */}
        <text x={startPt.x} y={CY + 18} textAnchor="middle" fontSize={9} fill="#64748b" fontFamily="Space Grotesk, sans-serif">0</text>
        <text x={arcPoint(1).x} y={CY + 18} textAnchor="middle" fontSize={9} fill="#64748b" fontFamily="Space Grotesk, sans-serif">{cap}</text>
        <text x={CX} y={CY - R - 12} textAnchor="middle" fontSize={9} fill="#64748b" fontFamily="Space Grotesk, sans-serif">cap</text>
      </svg>
      <p className="text-xs text-slate-500 tabular-nums">
        {current} mi / {cap} mi cap
      </p>
    </div>
  );
}
