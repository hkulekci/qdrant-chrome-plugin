import { useState, type CSSProperties } from 'react';

interface SparklineProps {
  values: number[];
  /** Optional pre-formatted label per data point (e.g. local time string).
   *  Shown in the hover tooltip beneath the value. */
  labels?: string[];
  /** Format the data value for the tooltip (e.g. comma-separated ints, %). */
  format?: (v: number) => string;
  /** Visual size of the sparkline in CSS pixels. */
  width?: number;
  height?: number;
  /** CSS color for the stroke + fill (fill is auto-faded). */
  color?: string;
  /** When the series is shorter than 2 points, render this fallback. */
  emptyText?: string;
  className?: string;
}

/**
 * Tiny inline trend chart. Stateless except for hover tracking. No deps.
 *
 * Layout: SVG fills its container width; on mouse move we map cursor X to
 * the closest data index, then draw a vertical guide and a focus circle
 * plus a tooltip element absolutely positioned over the SVG.
 */
export function Sparkline({
  values,
  labels,
  format = (v) => String(v),
  width = 200,
  height = 40,
  color = 'var(--accent)',
  emptyText = '— too few samples —',
  className,
}: SparklineProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (values.length < 2) {
    return <div className={`sparkline-empty ${className || ''}`}>{emptyText}</div>;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const padX = 2;
  const padY = 4;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;

  const points: [number, number][] = values.map((v, i) => {
    const x = padX + (i / (values.length - 1)) * innerW;
    const y = padY + innerH - ((v - min) / range) * innerH;
    return [x, y];
  });

  const polyline = points.map(p => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' ');
  const firstX = points[0][0];
  const lastX = points[points.length - 1][0];
  const fillPath = [
    `M ${firstX.toFixed(2)},${height}`,
    ...points.map(p => `L ${p[0].toFixed(2)},${p[1].toFixed(2)}`),
    `L ${lastX.toFixed(2)},${height}`,
    'Z',
  ].join(' ');

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    // SVG is rendered at the container's pixel width, but our coordinate
    // calculations (innerW, padX, points) are in viewBox units. Convert
    // the cursor's screen-px X into viewBox units before indexing, or the
    // mapping breaks whenever the rendered width differs from `width`.
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const screenX = e.clientX - rect.left;
    const viewX = (screenX / rect.width) * width;
    const relX = viewX - padX;
    const idx = Math.round((relX / innerW) * (values.length - 1));
    setHoverIdx(Math.max(0, Math.min(values.length - 1, idx)));
  };

  const tooltipLeftPct = hoverIdx !== null ? (points[hoverIdx][0] / width) * 100 : 0;
  const tooltipStyle: CSSProperties = {
    left: `${tooltipLeftPct}%`,
  };

  return (
    <div className={`sparkline-wrap ${className || ''}`}>
      <svg
        className="sparkline"
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        onMouseMove={onMove}
        onMouseLeave={() => setHoverIdx(null)}
        role="img"
        aria-label={`Sparkline: ${values.length} points, latest ${format(values[values.length - 1])}`}
      >
        <path d={fillPath} fill={color} fillOpacity="0.14" />
        <polyline
          points={polyline}
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        {hoverIdx !== null && (
          <>
            <line
              x1={points[hoverIdx][0]}
              y1={padY}
              x2={points[hoverIdx][0]}
              y2={height - padY}
              stroke="var(--text-secondary)"
              strokeWidth="0.5"
              strokeDasharray="2 2"
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={points[hoverIdx][0]}
              cy={points[hoverIdx][1]}
              r="3"
              fill={color}
              stroke="var(--bg-secondary)"
              strokeWidth="1.5"
            />
          </>
        )}
      </svg>
      {hoverIdx !== null && (
        <div className="sparkline-tooltip" style={tooltipStyle}>
          <span className="sparkline-tooltip-value">{format(values[hoverIdx])}</span>
          {labels?.[hoverIdx] && <span className="sparkline-tooltip-time">{labels[hoverIdx]}</span>}
        </div>
      )}
    </div>
  );
}
