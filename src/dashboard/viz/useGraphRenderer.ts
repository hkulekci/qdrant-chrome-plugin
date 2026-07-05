// Canvas 2D renderer for the HNSW graph: a custom perspective projection with
// depth-of-field, animated traversal paths, ripples and a query crosshair.
//
// Ported to TypeScript from VectorLens (HNSW Vector Search Visualizer) by
// Manik Bodamwad — https://github.com/ManikBodamwad/HNSW_Vector_Search_Visualizer
// Licensed under the MIT License. See NOTICE. Adapted to take generic nodes
// carrying { x, y, cluster } laid out from real Qdrant vectors.

import { useRef, useCallback, type RefObject } from 'react';

export interface RenderNode { x: number; y: number; cluster: number }
export interface RenderEdge { from: number; to: number }

interface Cam {
  rotY: number; rotX: number; targetRotY: number; targetRotX: number;
  panX: number; panY: number; targetPanX: number; targetPanY: number;
  distance: number; targetDistance: number; fov: number;
  autoRotate: boolean; userInteracted?: boolean;
}

interface Projected { sx: number; sy: number; scale: number; depth: number }

function project3D(x3: number, y3: number, z3: number, W: number, H: number, cam: Cam): Projected | null {
  const cx = x3 - 500 + (cam.panX || 0);
  const cy = y3 - 400 + (cam.panY || 0);
  const cz = z3;

  const cosY = Math.cos(cam.rotY), sinY = Math.sin(cam.rotY);
  const rx = cx * cosY + cz * sinY;
  const ry = cy;
  const rz = -cx * sinY + cz * cosY;

  const cosX = Math.cos(cam.rotX), sinX = Math.sin(cam.rotX);
  const rx2 = rx;
  const ry2 = ry * cosX - rz * sinX;
  const rz2 = ry * sinX + rz * cosX;

  const dz = rz2 + cam.distance;
  if (dz <= 0) return null;
  const scale = cam.fov / dz;

  const sx = W / 2 + rx2 * scale * (W / 900);
  const sy = H / 2 + ry2 * scale * (H / 720);
  return { sx, sy, scale, depth: rz2 };
}

const C = {
  nodDefault: 'rgba(255, 255, 255, 0.5)',
  nodVisited: '#0070F3',
  nodResult: '#10B981',
  nodEntry: '#3291FF',
  edgeActive: '#0070F3',
  edgeBrute: '#F5A623',
};

type NodeState = 'default' | 'visited' | 'entry' | 'result';

export interface RendererState {
  nodeStates: Record<number, NodeState>;
  activePath: RenderEdge[];
  queryNodePos: { x: number; y: number; z?: number; pulse: number } | null;
  isBrute: boolean;
  animFrame: number | null;
  tick: number;
  ripples: { sx: number; sy: number; r: number; maxR: number; alpha: number; color: string }[];
  rippleQueue?: { id: number; isHit?: boolean }[];
  prevStates: Record<number, NodeState>;
  cam: Cam;
  nodeZ: number[] | null;
  currentNode?: number | null;
  currentLayer?: number;
  isComplete?: boolean;
  sortedIdx?: { p: Projected | null; i: number }[];
  lastCamHash?: string;
}

export function useGraphRenderer(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  nodes: RenderNode[],
  edges: RenderEdge[],
) {
  const stateRef = useRef<RendererState>({
    nodeStates: {},
    activePath: [],
    queryNodePos: null,
    isBrute: false,
    animFrame: null,
    tick: 0,
    ripples: [],
    prevStates: {},
    cam: {
      rotY: 0.25, rotX: 0.18, targetRotY: 0.25, targetRotX: 0.18,
      panX: 0, panY: 0, targetPanX: 0, targetPanY: 0,
      distance: 520, targetDistance: 520, fov: 520, autoRotate: true,
    },
    nodeZ: null,
  });

  // Assign a z per node from its cluster so clusters separate in depth.
  if (!stateRef.current.nodeZ && nodes.length > 0) {
    const clusterZ = [-100, 80, -60, 100, -80, 60, -40, 100, 20, -20];
    stateRef.current.nodeZ = nodes.map(n => (clusterZ[n.cluster] ?? 0) + (Math.random() - 0.5) * 40);
  }

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !nodes.length) return;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth || canvas.width / dpr;
    const H = canvas.clientHeight || canvas.height / dpr;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const state = stateRef.current;
    const cam = state.cam;
    state.tick++;

    cam.rotY += (cam.targetRotY - cam.rotY) * 0.15;
    cam.rotX += (cam.targetRotX - cam.rotX) * 0.15;
    cam.distance += (cam.targetDistance - cam.distance) * 0.15;
    cam.panX += (cam.targetPanX - cam.panX) * 0.15;
    cam.panY += (cam.targetPanY - cam.panY) * 0.15;

    if (state.isComplete || state.activePath.length === 0) cam.targetRotY += 0.0015;

    if (state.isComplete) {
      if (!cam.userInteracted) {
        cam.targetPanX = 0; cam.targetPanY = 0; cam.targetDistance = 650; cam.targetRotX = 0.22;
      }
    } else if (!cam.userInteracted) {
      let focus: { x: number; y: number } | null = null;
      if (state.currentNode != null) focus = nodes[state.currentNode];
      else if (state.queryNodePos) focus = state.queryNodePos;
      if (focus) {
        cam.targetPanX = 500 - focus.x;
        cam.targetPanY = 400 - focus.y;
        cam.targetDistance = 280;
        cam.targetRotX = 0.35;
      }
    }

    if (cam.autoRotate) cam.targetRotY += 0.0008;

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    const gridSpacing = 55;
    for (let gx = 0; gx < W; gx += gridSpacing) {
      for (let gy = 0; gy < H; gy += gridSpacing) {
        ctx.beginPath();
        ctx.arc(gx, gy, 1, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
        ctx.fill();
      }
    }

    const nodeZ = state.nodeZ || [];
    const projected = nodes.map((n, i) => project3D(n.x, n.y, nodeZ[i] ?? 0, W, H, cam));

    // Base edges
    edges.forEach(edge => {
      const p1 = projected[edge.from], p2 = projected[edge.to];
      if (!p1 || !p2) return;
      const isActive = state.activePath.some(
        p => (p.from === edge.from && p.to === edge.to) || (p.from === edge.to && p.to === edge.from),
      );
      if (isActive) return;
      const avgDepth = (p1.depth + p2.depth) / 2;
      const depthAlpha = Math.max(0.02, Math.min(1, 1 - (avgDepth + 150) / 400));
      ctx.beginPath();
      ctx.moveTo(p1.sx, p1.sy);
      ctx.lineTo(p2.sx, p2.sy);
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.06 * depthAlpha})`;
      ctx.lineWidth = 0.5;
      ctx.stroke();
    });

    // Active traversal path
    state.activePath.forEach(({ from, to }) => {
      const p1 = projected[from], p2 = projected[to];
      if (!p1 || !p2) return;
      const isBrute = state.isBrute;
      const grad = ctx.createLinearGradient(p1.sx, p1.sy, p2.sx, p2.sy);
      grad.addColorStop(0, isBrute ? 'rgba(245, 166, 35, 0.1)' : 'rgba(0, 112, 243, 0.1)');
      grad.addColorStop(1, isBrute ? '#F5A623' : '#0070F3');
      ctx.beginPath();
      ctx.moveTo(p1.sx, p1.sy);
      ctx.lineTo(p2.sx, p2.sy);
      ctx.strokeStyle = grad;
      ctx.lineWidth = 2.0;
      ctx.lineCap = 'round';
      ctx.stroke();
    });

    // Ripples
    state.ripples = state.ripples.filter(r => r.alpha > 0.01);
    state.ripples.forEach(r => {
      r.r += (r.maxR - r.r) * 0.09;
      r.alpha *= 0.87;
      const hex = Math.round(r.alpha * 255).toString(16).padStart(2, '0');
      ctx.beginPath();
      ctx.arc(r.sx, r.sy, r.r, 0, Math.PI * 2);
      ctx.strokeStyle = r.color + hex;
      ctx.lineWidth = 2;
      ctx.stroke();
    });

    if (state.rippleQueue) {
      state.rippleQueue.forEach(({ id, isHit }) => {
        const p = projected[id];
        if (p) {
          const color = isHit ? '#10B981' : '#EF4444';
          state.ripples.push({ sx: p.sx, sy: p.sy, r: 5, maxR: 35, alpha: 0.95, color });
        }
      });
      state.rippleQueue = [];
    }

    Object.entries(state.nodeStates).forEach(([idStr, ns]) => {
      const id = parseInt(idStr);
      if (state.prevStates[id] !== ns) {
        if (ns === 'entry' || ns === 'result') {
          const p = projected[id];
          if (p) {
            const color = ns === 'result' ? '#059669' : '#60A5FA';
            state.ripples.push({ sx: p.sx, sy: p.sy, r: 3, maxR: 45, alpha: 0.85, color });
          }
        }
        state.prevStates[id] = ns;
      }
    });

    // Nodes, back-to-front
    const camHash = `${cam.rotY.toFixed(3)}_${cam.rotX.toFixed(3)}_${cam.panX.toFixed(1)}_${cam.panY.toFixed(1)}_${cam.distance.toFixed(1)}`;
    if (state.lastCamHash !== camHash || !state.sortedIdx) {
      state.sortedIdx = projected
        .map((p, i) => ({ p, i }))
        .filter(x => x.p !== null)
        .sort((a, b) => (a.p!.depth) - (b.p!.depth));
      state.lastCamHash = camHash;
    } else {
      state.sortedIdx.forEach(item => { item.p = projected[item.i]; });
    }

    state.sortedIdx.forEach(({ p, i }) => {
      if (!p) return;
      const ns = state.nodeStates[i] || 'default';
      const scalePerspective = Math.max(0.4, Math.min(1.6, p.scale));

      let color: string, baseRadius: number, glowStrength: number;
      switch (ns) {
        case 'result': color = C.nodResult; baseRadius = 6; glowStrength = 1; break;
        case 'entry': color = C.nodEntry; baseRadius = 5; glowStrength = 0.8; break;
        case 'visited': color = state.isBrute ? C.edgeBrute : C.nodVisited; baseRadius = 4; glowStrength = 0.5; break;
        default: color = C.nodDefault; baseRadius = 2.5; glowStrength = 0;
      }

      const r = baseRadius * scalePerspective;
      const depthAlpha = Math.max(0.1, Math.min(1, 1 - (p.depth + 150) / 400));
      ctx.globalAlpha = ns === 'default' ? depthAlpha : 1;

      ctx.beginPath();
      ctx.arc(p.sx, p.sy, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();

      if (glowStrength > 0) {
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, r * 3, 0, Math.PI * 2);
        ctx.fillStyle = `${color}40`;
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      if (ns === 'result') {
        const pulse = 0.5 + 0.5 * Math.sin(state.tick * 0.07 + i * 0.5);
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, r + 4 + pulse * 3, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(5,150,105,${0.3 + pulse * 0.2})`;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }

      if (state.currentNode === i && !state.isBrute) {
        const pulse = 0.5 + 0.5 * Math.sin(state.tick * 0.15);
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, r + 6 + pulse * 6, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(96,165,250,${0.6 - pulse * 0.4})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    });

    // Query crosshair
    if (state.queryNodePos) {
      const { x, y, z = 0 } = state.queryNodePos;
      const p = project3D(x, y, z, W, H, cam);
      if (p) {
        const sc = Math.max(0.6, Math.min(1.4, p.scale));
        const pR = 12 * sc;
        ctx.beginPath();
        ctx.moveTo(p.sx - pR, p.sy); ctx.lineTo(p.sx + pR, p.sy);
        ctx.moveTo(p.sx, p.sy - pR); ctx.lineTo(p.sx, p.sy + pR);
        ctx.strokeStyle = '#F5A623';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        const outerR = pR + 4 + Math.sin(state.queryNodePos.pulse) * 3;
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, outerR, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(245, 166, 35, ${0.4 + 0.4 * Math.sin(state.queryNodePos.pulse)})`;
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(p.sx, p.sy, 3 * sc, 0, Math.PI * 2);
        ctx.fillStyle = '#F5A623';
        ctx.fill();

        state.queryNodePos.pulse += 0.055;
      }
    }

    ctx.restore();
    state.animFrame = requestAnimationFrame(draw);
  }, [nodes, edges, canvasRef]);

  const startLoop = useCallback(() => {
    if (stateRef.current.animFrame) cancelAnimationFrame(stateRef.current.animFrame);
    stateRef.current.animFrame = requestAnimationFrame(draw);
  }, [draw]);

  const stopLoop = useCallback(() => {
    if (stateRef.current.animFrame) {
      cancelAnimationFrame(stateRef.current.animFrame);
      stateRef.current.animFrame = null;
    }
  }, []);

  const handleDrag = useCallback((dx: number, dy: number, isPan = false) => {
    const cam = stateRef.current.cam;
    cam.autoRotate = false;
    cam.userInteracted = true;
    if (isPan) {
      cam.targetPanX += dx * 1.5;
      cam.targetPanY += dy * 1.5;
    } else {
      cam.targetRotY += dx * 0.006;
      cam.targetRotX -= dy * 0.006;
      cam.targetRotX = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, cam.targetRotX));
    }
  }, []);

  const handleZoom = useCallback((deltaY: number) => {
    const cam = stateRef.current.cam;
    if (Math.abs(deltaY) > 5) cam.userInteracted = true;
    cam.targetDistance += deltaY * 1.2;
    cam.targetDistance = Math.max(100, Math.min(5000, cam.targetDistance));
  }, []);

  return { draw, stateRef, startLoop, stopLoop, handleDrag, handleZoom };
}
