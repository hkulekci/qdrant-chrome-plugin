import { useCallback, useEffect, useRef, useState } from 'react';
import type { VizGraph } from '../../lib/hnsw';
import { searchVizGraph } from '../../lib/hnsw';
import { useGraphRenderer } from './useGraphRenderer';
import { useAnimator, type StepUpdate } from './useAnimator';

interface Stats { nodesEvaluated: number; computeSaved: number; topSim: number; total: number }

/**
 * Renders one built HNSW graph and animates a query traversal over it. Remount
 * (via a `key` on the parent) whenever the graph changes so renderer state is
 * fresh.
 */
export function VisualizerCanvas({ graph }: { graph: VizGraph }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { stateRef, startLoop, stopLoop, handleDrag, handleZoom } = useGraphRenderer(canvasRef, graph.nodes, graph.edges);

  const [running, setRunning] = useState(false);
  const [stats, setStats] = useState<Stats>({ nodesEvaluated: 0, computeSaved: 0, topSim: 0, total: graph.nodes.length });
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

  useEffect(() => {
    startLoop();
    return () => stopLoop();
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
    setStats(s => ({ ...s, nodesEvaluated: u.nodesVisited }));
  }, []);
  const onDone = useCallback(() => setRunning(false), []);
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
    setStats({ nodesEvaluated: 0, computeSaved: result.computeSaved, topSim: result.topSim, total: graph.nodes.length });
    setRunning(true);
    play(result.steps, 140, false);
  }, [graph, cancel, play, stateRef]);

  return (
    <div className="viz-stage">
      <canvas ref={canvasRef} className="viz-canvas" />
      <div className="viz-hud">
        <div className="viz-hud-row"><span>Nodes</span><b>{stats.total}</b></div>
        <div className="viz-hud-row"><span>Evaluated</span><b>{stats.nodesEvaluated}</b></div>
        <div className="viz-hud-row"><span>Compute saved</span><b>{stats.computeSaved}%</b></div>
        <div className="viz-hud-row"><span>Top similarity</span><b>{stats.topSim.toFixed(4)}</b></div>
        {queryLabel && <div className="viz-hud-row"><span>Query point</span><b title={queryLabel}>{queryLabel.length > 12 ? queryLabel.slice(0, 12) + '…' : queryLabel}</b></div>}
      </div>
      <div className="viz-legend">
        <span><i className="dot" style={{ background: '#10B981' }} />hit edge (improves)</span>
        <span><i className="dot" style={{ background: '#EF4444' }} />miss edge (rejected)</span>
        <span><i className="dot" style={{ background: '#0070F3' }} />chosen path</span>
        <span><i className="dot" style={{ background: '#10B981' }} />top-k result</span>
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
