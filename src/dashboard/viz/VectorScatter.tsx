import { useEffect, useMemo, useRef } from 'react';

export interface ScatterPoint {
  id: string | number;
  nx: number; // normalized [0,1]
  ny: number; // normalized [0,1]
  cluster: number;
  payload: Record<string, unknown> | null;
}

export interface FocusResult {
  index: number;
  neighbors: { index: number; sim: number }[];
}

export interface RegionLabel {
  cluster: number;
  nx: number; // normalized centroid [0,1]
  ny: number;
  text: string;
}

interface VectorScatterProps {
  points: ScatterPoint[];
  colors: string[];       // per-point fill, aligned with points
  vectors: number[][];    // aligned with points, for neighbour cosine
  labels?: RegionLabel[]; // floating region labels at cluster centroids
  activeMask?: boolean[] | null; // per-point: false → dimmed (filtered out)
  busy?: boolean;         // overlay a spinner while re-querying / re-projecting
  busyLabel?: string;     // text shown under the spinner
  lassoMode: boolean;
  resetToken: number;     // bump to reset pan/zoom
  onFocus: (f: FocusResult | null) => void;
  onLasso: (indices: number[]) => void;
}

const PAD = 26;
const HIT_RADIUS = 9;
const NEIGHBOR_K = 12;

interface View { scale: number; tx: number; ty: number; }
interface Pt { x: number; y: number; }

function pointInPoly(px: number, py: number, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    const intersect = (yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = h.length === 3
    ? h.split('').map(c => c + c).join('')
    : h;
  const int = parseInt(n, 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

/** A cached radial-gradient sprite per colour, drawn additively to build the
 *  nebula glow / density bloom. Overlapping sprites accumulate into bright cores. */
function makeGlowSprite(color: string): HTMLCanvasElement {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const g = c.getContext('2d')!;
  const [r, gr, b] = color.startsWith('#') ? hexToRgb(color) : [139, 147, 167];
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, `rgba(${r}, ${gr}, ${b}, 0.85)`);
  grad.addColorStop(0.35, `rgba(${r}, ${gr}, ${b}, 0.35)`);
  grad.addColorStop(1, `rgba(${r}, ${gr}, ${b}, 0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

function shortText(v: unknown, max = 42): string {
  let s: string;
  if (v === null || v === undefined) s = '∅';
  else if (typeof v === 'object') s = Array.isArray(v) ? `[${v.length}]` : JSON.stringify(v);
  else s = String(v);
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

export function VectorScatter({
  points, colors, vectors, labels, activeMask, busy, busyLabel, lassoMode, resetToken, onFocus, onLasso,
}: VectorScatterProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const viewRef = useRef<View>({ scale: 1, tx: 0, ty: 0 });
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });

  // Latest props mirrored into refs so the (stable) event handlers and the
  // draw loop always see current data without re-binding listeners.
  const pointsRef = useRef(points);
  const colorsRef = useRef(colors);
  const vectorsRef = useRef(vectors);
  const labelsRef = useRef(labels);
  const activeMaskRef = useRef(activeMask);
  const lassoModeRef = useRef(lassoMode);
  pointsRef.current = points;
  colorsRef.current = colors;
  vectorsRef.current = vectors;
  labelsRef.current = labels;
  activeMaskRef.current = activeMask;
  lassoModeRef.current = lassoMode;

  // Interaction state (refs — no React re-render on hover/drag).
  const hoverRef = useRef<number | null>(null);
  const focusRef = useRef<FocusResult | null>(null);
  const lassoSelRef = useRef<number[]>([]);
  const dragRef = useRef<{ x: number; y: number; moved: boolean; panning: boolean } | null>(null);
  const lassoPtsRef = useRef<Pt[]>([]);
  const rafRef = useRef<number | null>(null);
  const spriteCacheRef = useRef<Map<string, HTMLCanvasElement>>(new Map());

  const glowSprite = (color: string): HTMLCanvasElement => {
    const cache = spriteCacheRef.current;
    let s = cache.get(color);
    if (!s) { s = makeGlowSprite(color); cache.set(color, s); }
    return s;
  };

  // Precompute L2 norms once per vector set for fast cosine.
  const norms = useMemo(() => vectors.map(v => {
    let s = 0; for (const x of v) s += x * x; return Math.sqrt(s) || 1;
  }), [vectors]);
  const normsRef = useRef(norms);
  normsRef.current = norms;

  const worldOf = (nx: number, ny: number): Pt => {
    const { w, h } = sizeRef.current;
    return { x: PAD + nx * (w - 2 * PAD), y: PAD + ny * (h - 2 * PAD) };
  };
  const screenOf = (nx: number, ny: number): Pt => {
    const wpt = worldOf(nx, ny);
    const v = viewRef.current;
    return { x: wpt.x * v.scale + v.tx, y: wpt.y * v.scale + v.ty };
  };

  const requestDraw = () => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => { rafRef.current = null; draw(); });
  };

  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { w, h, dpr } = sizeRef.current;
    const pts = pointsRef.current;
    const cols = colorsRef.current;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const focus = focusRef.current;
    const lassoSel = lassoSelRef.current;
    const mask = activeMaskRef.current;
    const hasSelection = !!focus || lassoSel.length > 0;
    const neighborSet = new Set<number>(focus ? focus.neighbors.map(n => n.index) : []);
    const lassoSet = new Set<number>(lassoSel);
    const scale = viewRef.current.scale;
    const coreR = Math.max(1.6, Math.min(5, 2.3 * Math.sqrt(scale)));
    const glowR = Math.max(11, Math.min(52, coreR * 7));

    // Pass 1: additive glow — overlapping sprites accumulate into a nebula /
    // density bloom, so crowded regions read as bright cores.
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < pts.length; i++) {
      const s = screenOf(pts[i].nx, pts[i].ny);
      if (s.x < -glowR || s.x > w + glowR || s.y < -glowR || s.y > h + glowR) continue;
      const out = mask ? !mask[i] : false;
      const isHi = focus?.index === i || neighborSet.has(i) || lassoSet.has(i);
      const dim = hasSelection && !isHi;
      ctx.globalAlpha = out ? 0.03 : dim ? 0.05 : 0.42;
      ctx.drawImage(glowSprite(cols[i] || '#8b93a7'), s.x - glowR, s.y - glowR, glowR * 2, glowR * 2);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    // Neighbour connector lines (drawn over the glow, under the cores).
    if (focus) {
      const from = screenOf(pts[focus.index].nx, pts[focus.index].ny);
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.5)';
      for (const n of focus.neighbors) {
        const to = screenOf(pts[n.index].nx, pts[n.index].ny);
        ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
      }
    }

    // Pass 2: crisp cores with a bright centre + selection rings.
    for (let i = 0; i < pts.length; i++) {
      const s = screenOf(pts[i].nx, pts[i].ny);
      if (s.x < -20 || s.x > w + 20 || s.y < -20 || s.y > h + 20) continue;
      const isFocus = focus?.index === i;
      const isNeighbor = neighborSet.has(i);
      const isLasso = lassoSet.has(i);
      const out = mask ? !mask[i] : false;
      const dim = out || (hasSelection && !isFocus && !isNeighbor && !isLasso);
      ctx.globalAlpha = out ? 0.08 : dim ? 0.22 : 1;
      ctx.fillStyle = cols[i] || '#8b93a7';
      ctx.beginPath();
      ctx.arc(s.x, s.y, isFocus ? coreR + 2 : coreR, 0, Math.PI * 2);
      ctx.fill();
      if (!dim && coreR > 2) {
        ctx.globalAlpha = 0.8;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.beginPath();
        ctx.arc(s.x, s.y, coreR * 0.42, 0, Math.PI * 2);
        ctx.fill();
      }
      if (isNeighbor || isLasso) {
        ctx.globalAlpha = 1;
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = isLasso ? '#a78bfa' : '#38bdf8';
        ctx.beginPath();
        ctx.arc(s.x, s.y, coreR + 2.5, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (isFocus) {
        ctx.globalAlpha = 1;
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#f59e0b';
        ctx.beginPath();
        ctx.arc(s.x, s.y, coreR + 4, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    // Floating region labels at cluster centroids.
    const labelList = labelsRef.current;
    if (labelList && labelList.length && !hasSelection) {
      ctx.font = '600 13px Inter, system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const lab of labelList) {
        const s = screenOf(lab.nx, lab.ny);
        if (s.x < 0 || s.x > w || s.y < 0 || s.y > h) continue;
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = 'rgba(4, 6, 12, 0.9)';
        ctx.strokeText(lab.text, s.x, s.y);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
        ctx.fillText(lab.text, s.x, s.y);
      }
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    }

    // In-progress lasso outline.
    const lp = lassoPtsRef.current;
    if (lp.length > 1) {
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(167, 139, 250, 0.9)';
      ctx.fillStyle = 'rgba(167, 139, 250, 0.08)';
      ctx.beginPath();
      ctx.moveTo(lp[0].x, lp[0].y);
      for (let i = 1; i < lp.length; i++) ctx.lineTo(lp[i].x, lp[i].y);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }

    // Hover tooltip.
    const hi = hoverRef.current;
    if (hi != null && hi < pts.length) {
      const s = screenOf(pts[hi].nx, pts[hi].ny);
      ctx.beginPath(); ctx.arc(s.x, s.y, coreR + 3, 0, Math.PI * 2);
      ctx.lineWidth = 2; ctx.strokeStyle = '#e2e8f0'; ctx.stroke();
      drawTooltip(ctx, w, h, s, pts[hi]);
    }
  };

  const drawTooltip = (ctx: CanvasRenderingContext2D, w: number, h: number, at: Pt, p: ScatterPoint) => {
    const lines: string[] = [`id: ${shortText(p.id, 48)}`];
    if (p.payload) {
      const keys = Object.keys(p.payload).slice(0, 5);
      for (const k of keys) lines.push(`${k}: ${shortText(p.payload[k])}`);
      if (Object.keys(p.payload).length > 5) lines.push('…');
    }
    ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
    let bw = 0;
    for (const l of lines) bw = Math.max(bw, ctx.measureText(l).width);
    const padX = 8, padY = 6, lh = 15;
    const boxW = bw + padX * 2;
    const boxH = lines.length * lh + padY * 2 - 3;
    let bx = at.x + 12, by = at.y + 12;
    if (bx + boxW > w) bx = at.x - boxW - 12;
    if (by + boxH > h) by = at.y - boxH - 12;
    ctx.fillStyle = 'rgba(15, 18, 26, 0.94)';
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
    ctx.lineWidth = 1;
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(bx, by, boxW, boxH, 6); ctx.fill(); ctx.stroke(); }
    else { ctx.fillRect(bx, by, boxW, boxH); ctx.strokeRect(bx, by, boxW, boxH); }
    ctx.textBaseline = 'top';
    for (let i = 0; i < lines.length; i++) {
      ctx.fillStyle = i === 0 ? '#93c5fd' : '#e2e8f0';
      ctx.fillText(lines[i], bx + padX, by + padY + i * lh);
    }
  };

  const hitTest = (px: number, py: number): number => {
    const pts = pointsRef.current;
    let best = -1, bestD = HIT_RADIUS * HIT_RADIUS;
    for (let i = 0; i < pts.length; i++) {
      const s = screenOf(pts[i].nx, pts[i].ny);
      const dx = s.x - px, dy = s.y - py, d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  };

  const computeNeighbors = (i: number): FocusResult => {
    const vecs = vectorsRef.current, ns = normsRef.current;
    const a = vecs[i], na = ns[i];
    const sims: { index: number; sim: number }[] = [];
    for (let j = 0; j < vecs.length; j++) {
      if (j === i) continue;
      const b = vecs[j];
      let dotp = 0; const len = Math.min(a.length, b.length);
      for (let d = 0; d < len; d++) dotp += a[d] * b[d];
      sims.push({ index: j, sim: dotp / (na * ns[j]) });
    }
    sims.sort((x, y) => y.sim - x.sim);
    return { index: i, neighbors: sims.slice(0, NEIGHBOR_K) };
  };

  // Resize handling.
  useEffect(() => {
    const wrap = wrapRef.current, canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      sizeRef.current = { w: rect.width, h: rect.height, dpr };
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      requestDraw();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  // Redraw when data/colors/labels/filter-mask change.
  useEffect(() => { requestDraw(); }, [points, colors, labels, activeMask]);

  // Reset pan/zoom + clear selection on new data or explicit reset.
  useEffect(() => {
    viewRef.current = { scale: 1, tx: 0, ty: 0 };
    focusRef.current = null;
    lassoSelRef.current = [];
    hoverRef.current = null;
    requestDraw();
  }, [resetToken]);

  // Pointer + wheel handlers.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const localPos = (e: PointerEvent | WheelEvent): Pt => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const onDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      const p = localPos(e);
      if (lassoModeRef.current) {
        lassoPtsRef.current = [p];
        dragRef.current = { x: p.x, y: p.y, moved: false, panning: false };
      } else {
        dragRef.current = { x: p.x, y: p.y, moved: false, panning: true };
      }
    };

    const onMove = (e: PointerEvent) => {
      const p = localPos(e);
      const drag = dragRef.current;
      if (drag) {
        const dx = p.x - drag.x, dy = p.y - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
        if (lassoModeRef.current && !drag.panning) {
          lassoPtsRef.current.push(p);
          requestDraw();
        } else if (drag.panning) {
          viewRef.current.tx += dx; viewRef.current.ty += dy;
          drag.x = p.x; drag.y = p.y;
          requestDraw();
        }
      } else {
        const idx = hitTest(p.x, p.y);
        const cur = idx >= 0 ? idx : null;
        if (cur !== hoverRef.current) { hoverRef.current = cur; requestDraw(); }
      }
    };

    const onUp = (e: PointerEvent) => {
      const p = localPos(e);
      const drag = dragRef.current;
      dragRef.current = null;
      if (lassoModeRef.current && lassoPtsRef.current.length > 2) {
        const poly = lassoPtsRef.current;
        const pts = pointsRef.current;
        const sel: number[] = [];
        for (let i = 0; i < pts.length; i++) {
          const s = screenOf(pts[i].nx, pts[i].ny);
          if (pointInPoly(s.x, s.y, poly)) sel.push(i);
        }
        lassoPtsRef.current = [];
        lassoSelRef.current = sel;
        focusRef.current = null;
        onFocus(null);
        onLasso(sel);
        requestDraw();
        return;
      }
      lassoPtsRef.current = [];
      if (!drag || !drag.moved) {
        const idx = hitTest(p.x, p.y);
        if (idx >= 0) {
          const f = computeNeighbors(idx);
          focusRef.current = f;
          lassoSelRef.current = [];
          onLasso([]);
          onFocus(f);
        } else {
          focusRef.current = null;
          lassoSelRef.current = [];
          onFocus(null);
          onLasso([]);
        }
        requestDraw();
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = localPos(e);
      const v = viewRef.current;
      const factor = Math.exp(-e.deltaY * 0.0012);
      const newScale = Math.max(0.4, Math.min(40, v.scale * factor));
      v.tx = p.x - (p.x - v.tx) * (newScale / v.scale);
      v.ty = p.y - (p.y - v.ty) * (newScale / v.scale);
      v.scale = newScale;
      requestDraw();
    };

    const onLeave = () => { if (hoverRef.current != null) { hoverRef.current = null; requestDraw(); } };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={wrapRef} className={`vec-scatter ${lassoMode ? 'lasso' : ''}`}>
      <canvas ref={canvasRef} />
      {busy && (
        <div className="vec-scatter-busy">
          <div className="spinner" />
          <span>{busyLabel || 'Working…'}</span>
        </div>
      )}
    </div>
  );
}
