import { useCallback, useEffect, useRef, useState } from 'react';
import type { VizGraph } from '../../lib/hnsw';
import { searchVizGraph } from '../../lib/hnsw';
import { useGraphRenderer } from './useGraphRenderer';
import { useAnimator, type StepUpdate } from './useAnimator';

interface LayerStat { hits: number; misses: number }
interface Stats {
  nodesEvaluated: number;
  computeSaved: number;
  topSim: number;
  total: number;
  hits: number;
  misses: number;
  currentLayer: number | null;
  topLayer: number;
  perLayer: Record<number, LayerStat>;
}

function emptyStats(graph: VizGraph): Stats {
  return {
    nodesEvaluated: 0, computeSaved: 0, topSim: 0, total: graph.nodes.length,
    hits: 0, misses: 0, currentLayer: null, topLayer: graph.maxLayer, perLayer: {},
  };
}

/**
 * Renders one built HNSW graph and animates a query traversal over it. Remount
 * (via a `key` on the parent) whenever the graph changes so renderer state is
 * fresh.
 */
export function VisualizerCanvas({ graph }: { graph: VizGraph }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { stateRef, startLoop, stopLoop, handleDrag, handleZoom } = useGraphRenderer(canvasRef, graph.nodes, graph.edges);

  const [running, setRunning] = useState(false);
  const [stats, setStats] = useState<Stats>(() => emptyStats(graph));
  const [queryLabel, setQueryLabel] = useState<string | null>(null);

  // Size the canvas to its box at device-pixel resolution.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  // Only animate while the canvas is on screen — with several stacked graphs
  // this keeps the off-screen ones from burning frames.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const io = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) startLoop(); else stopLoop(); },
      { threshold: 0.01 },
    );
    io.observe(canvas);
    return () => { io.disconnect(); stopLoop(); };
  }, [startLoop, stopLoop]);

  // Pointer drag (rotate) / shift-drag (pan) and wheel zoom.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let dragging = false, lastX = 0, lastY = 0, pan = false;
    const down = (e: PointerEvent) => { dragging = true; pan = e.shiftKey; lastX = e.clientX; lastY = e.clientY; canvas.setPointerCapture(e.pointerId); };
    const move = (e: PointerEvent) => { if (!dragging) return; handleDrag(e.clientX - lastX, e.clientY - lastY, pan); lastX = e.clientX; lastY = e.clientY; };
    const up = () => { dragging = false; };
    const wheel = (e: WheelEvent) => { e.preventDefault(); handleZoom(e.deltaY); };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('wheel', wheel, { passive: false });
    return () => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('wheel', wheel);
    };
  }, [handleDrag, handleZoom]);

  const onStep = useCallback((u: StepUpdate) => {
    const step = u.step;
    setStats(s => {
      const next: Stats = { ...s, nodesEvaluated: u.nodesVisited };
      if (step.layer != null) next.currentLayer = step.layer;
      if (step.type === 'evaluate') {
        const layer = step.layer ?? 0;
        const prev = s.perLayer[layer] ?? { hits: 0, misses: 0 };
        const bump: LayerStat = step.isHit
          ? { hits: prev.hits + 1, misses: prev.misses }
          : { hits: prev.hits, misses: prev.misses + 1 };
        next.perLayer = { ...s.perLayer, [layer]: bump };
        if (step.isHit) next.hits = s.hits + 1; else next.misses = s.misses + 1;
      }
      return next;
    });
  }, []);
  const onDone = useCallback(() => {
    setRunning(false);
    setStats(s => ({ ...s, currentLayer: null }));
  }, []);
  const { play, cancel } = useAnimator(stateRef, onStep, onDone);

  const runSearch = useCallback(() => {
    const state = stateRef.current;
    if (!state || graph.nodes.length === 0) return;
    cancel();

    // Reset visual state for a clean run.
    state.nodeStates = {};
    state.prevStates = {};
    state.activePath = [];
    state.ripples = [];
    state.evalEdges = [];
    state.rippleQueue = [];
    state.currentNode = null;
    state.isComplete = false;
    state.cam.userInteracted = false;

    // Use a random real point as the query vector.
    const qi = Math.floor(Math.random() * graph.nodes.length);
    const qNode = graph.nodes[qi];
    state.queryNodePos = { x: qNode.x, y: qNode.y, pulse: 0 };
    setQueryLabel(String(qNode.pointId));

    const result = searchVizGraph(graph, qNode.embedding, 5);
    setStats({ ...emptyStats(graph), computeSaved: result.computeSaved, topSim: result.topSim });
    setRunning(true);
    play(result.steps, 140, false);
  }, [graph, cancel, play, stateRef]);

  return (
    <div className="viz-stage">
      <canvas ref={canvasRef} className="viz-canvas" />
      <div className="viz-hud">
        <div className="viz-hud-row"><span>Nodes</span><b>{stats.total}</b></div>
        <div className="viz-hud-row"><span>Layers</span><b>{stats.topLayer + 1} (L0–L{stats.topLayer})</b></div>
        <div className="viz-hud-row"><span>Evaluated</span><b>{stats.nodesEvaluated}</b></div>
        <div className="viz-hud-row">
          <span>Hits / misses</span>
          <b><span className="viz-hit">{stats.hits}✓</span> / <span className="viz-miss">{stats.misses}✗</span></b>
        </div>
        <div className="viz-hud-row"><span>Compute saved</span><b>{stats.computeSaved}%</b></div>
        <div className="viz-hud-row"><span>Top similarity</span><b>{stats.topSim.toFixed(4)}</b></div>
        {queryLabel && <div className="viz-hud-row"><span>Query point</span><b title={queryLabel}>{queryLabel.length > 12 ? queryLabel.slice(0, 12) + '…' : queryLabel}</b></div>}

        <div className="viz-hud-layers">
          <div className="viz-hud-layers-title">Per level (top → bottom)</div>
          {Array.from({ length: stats.topLayer + 1 }, (_, k) => stats.topLayer - k).map(layer => {
            const ls = stats.perLayer[layer] ?? { hits: 0, misses: 0 };
            const active = stats.currentLayer === layer;
            return (
              <div key={layer} className={`viz-hud-row viz-layer-row${active ? ' active' : ''}`}>
                <span>L{layer}{active ? ' ◂' : ''}</span>
                <b><span className="viz-hit">{ls.hits}</span> / <span className="viz-miss">{ls.misses}</span></b>
              </div>
            );
          })}
        </div>
      </div>
      <div className="viz-legend">
        <span><i className="dot" style={{ background: '#10B981' }} />hit edge (improves)</span>
        <span><i className="dot" style={{ background: '#EF4444' }} />miss edge (rejected)</span>
        <span><i className="dot" style={{ background: '#0070F3' }} />chosen path</span>
        <span><i className="dot" style={{ background: '#10B981' }} />top-k result</span>
        <span className="viz-legend-note">Depth = HNSW level (top layers float above L0)</span>
      </div>
      <div className="viz-controls">
        <button className="btn btn-refresh" onClick={runSearch} disabled={running}>
          {running ? 'Searching…' : 'Run search'}
        </button>
        <span className="viz-hint">Drag to rotate · Shift-drag to pan · Scroll to zoom</span>
      </div>
    </div>
  );
}
