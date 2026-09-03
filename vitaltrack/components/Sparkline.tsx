// Tiny dependency-free SVG sparkline.

export function Sparkline({
  values,
  width = 160,
  height = 40,
  stroke = "#0d9488",
}: {
  values: Array<number | undefined>;
  width?: number;
  height?: number;
  stroke?: string;
}) {
  const pts = values
    .map((v, i) => ({ v, i }))
    .filter((p): p is { v: number; i: number } => typeof p.v === "number");
  if (pts.length < 2)
    return <div style={{ width, height }} className="bg-slate-50 rounded" />;
  const min = Math.min(...pts.map((p) => p.v));
  const max = Math.max(...pts.map((p) => p.v));
  const span = max - min || 1;
  const n = values.length - 1 || 1;
  const path = pts
    .map(
      (p, idx) =>
        `${idx === 0 ? "M" : "L"}${((p.i / n) * (width - 4) + 2).toFixed(1)},${(
          height -
          3 -
          ((p.v - min) / span) * (height - 6)
        ).toFixed(1)}`
    )
    .join(" ");
  return (
    <svg width={width} height={height} className="overflow-visible">
      <path d={path} fill="none" stroke={stroke} strokeWidth={1.8} strokeLinejoin="round" />
    </svg>
  );
}
