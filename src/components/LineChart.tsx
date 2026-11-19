import { useEffect, useMemo, useRef, useState } from 'react';

export interface ChartPoint {
  x: number; // epoch ms
  y: number;
  highlight?: boolean; // e.g. a PR
}

/** Small dependency-free SVG line chart sized for a phone. Tap/drag to inspect points. */
export function LineChart({
  points,
  formatY,
  formatX = (x) => new Date(x).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
  height = 190,
}: {
  points: ChartPoint[];
  formatY: (y: number) => string;
  formatX?: (x: number) => string;
  height?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(200, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    setActive(null);
  }, [points]);

  const pad = { l: 44, r: 12, t: 16, b: 26 };
  const geo = useMemo(() => {
    if (!points.length) return null;
    const ys = points.map((p) => p.y);
    let min = Math.min(...ys);
    let max = Math.max(...ys);
    if (min === max) {
      min = min * 0.9;
      max = max * 1.1 || 1;
    }
    // Round the axis to friendly numbers (1, 2, 2.5, 5 × 10ⁿ)
    const raw = (max - min) / 2;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
    min = Math.max(0, Math.floor(min / step) * step);
    max = Math.ceil(max / step) * step;
    if (max === min) max = min + step;
    const iw = width - pad.l - pad.r;
    const ih = height - pad.t - pad.b;
    const n = points.length;
    // Even spacing reads better than true time spacing for irregular sessions
    const px = (i: number) => pad.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
    const py = (y: number) => pad.t + ih - ((y - min) / (max - min)) * ih;
    const ticks: number[] = [];
    for (let t = min; t <= max + 1e-9; t += step) ticks.push(t);
    return { px, py, ticks, ih, iw };
  }, [points, width, height]);

  if (!points.length || !geo) {
    return (
      <div ref={ref} className="chart-empty" style={{ height }}>
        Not enough data yet
      </div>
    );
  }

  const path = points.map((p, i) => `${i ? 'L' : 'M'}${geo.px(i).toFixed(1)},${geo.py(p.y).toFixed(1)}`).join(' ');
  const area = `${path} L${geo.px(points.length - 1).toFixed(1)},${pad.t + geo.ih} L${geo.px(0).toFixed(1)},${pad.t + geo.ih} Z`;
  const sel = active ?? points.length - 1;
  const sp = points[sel];

  const pick = (clientX: number) => {
    const rect = ref.current!.getBoundingClientRect();
    const x = clientX - rect.left;
    let best = 0;
    let bestD = Infinity;
    points.forEach((_, i) => {
      const d = Math.abs(geo.px(i) - x);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    setActive(best);
  };

  return (
    <div ref={ref} className="chart" style={{ height }}>
      <div className="chart__readout">
        <span className="num">{formatY(sp.y)}</span>
        <span className="muted">{formatX(sp.x)}</span>
      </div>
      <svg
        width={width}
        height={height}
        onPointerDown={(e) => pick(e.clientX)}
        onPointerMove={(e) => e.buttons && pick(e.clientX)}
        style={{ touchAction: 'pan-y', display: 'block' }}
      >
        <defs>
          <linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ECECEC" stopOpacity="0.14" />
            <stop offset="100%" stopColor="#ECECEC" stopOpacity="0" />
          </linearGradient>
        </defs>
        {geo.ticks.map((t, i) => (
          <g key={i}>
            <line x1={pad.l} x2={width - pad.r} y1={geo.py(t)} y2={geo.py(t)} stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
            <text x={pad.l - 8} y={geo.py(t) + 4} textAnchor="end" fontSize="11" fill="#808080">
              {formatY(t)}
            </text>
          </g>
        ))}
        <path key={`a${path}`} className="chart__area" d={area} fill="url(#chart-fill)" />
        <path key={`l${path}`} className="chart__line" pathLength={1} d={path} fill="none" stroke="#ECECEC" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <line x1={geo.px(sel)} x2={geo.px(sel)} y1={pad.t} y2={pad.t + geo.ih} stroke="rgba(255,255,255,0.18)" strokeWidth="1" />
        {points.map((p, i) => (
          <circle
            key={i}
            cx={geo.px(i)}
            cy={geo.py(p.y)}
            r={i === sel ? 5 : points.length > 30 ? 0 : 3}
            fill={i === sel || p.highlight ? '#ECECEC' : '#2A2A2A'}
            stroke="#ECECEC"
            strokeWidth="2"
          />
        ))}
        <text x={pad.l} y={height - 6} fontSize="11" fill="#808080">
          {formatX(points[0].x)}
        </text>
        {points.length > 1 && (
          <text x={width - pad.r} y={height - 6} textAnchor="end" fontSize="11" fill="#808080">
            {formatX(points[points.length - 1].x)}
          </text>
        )}
      </svg>
    </div>
  );
}
