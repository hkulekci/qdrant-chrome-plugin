// Steps the search animation through the renderer state over time.
//
// Ported to TypeScript from VectorLens (HNSW Vector Search Visualizer) by
// Manik Bodamwad — https://github.com/ManikBodamwad/HNSW_Vector_Search_Visualizer
// Licensed under the MIT License. See NOTICE.

import { useRef, useCallback, useEffect, type RefObject } from 'react';
import type { RendererState } from './useGraphRenderer';
import type { SearchStep } from '../../lib/hnsw';

export interface StepUpdate { stepIndex: number; total: number; step: SearchStep; nodesVisited: number }

export function useAnimator(
  stateRef: RefObject<RendererState>,
  onStepUpdate?: (u: StepUpdate) => void,
  onDone?: () => void,
) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onDoneRef = useRef(onDone);
  const onStepUpdateRef = useRef(onStepUpdate);
  useEffect(() => { onDoneRef.current = onDone; }, [onDone]);
  useEffect(() => { onStepUpdateRef.current = onStepUpdate; }, [onStepUpdate]);

  const cancel = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  }, []);

  const play = useCallback((steps: SearchStep[], speedMs = 160, isBrute = false) => {
    cancel();
    let prevHopNode: number | null = null;
    let visitedCount = 0;

    function playStep(index: number) {
      const state = stateRef.current;
      if (!state) return;
      if (index >= steps.length) {
        state.isComplete = true;
        onDoneRef.current?.();
        return;
      }
      const step = steps[index];

      switch (step.type) {
        case 'entry':
          state.nodeStates[step.nodeId] = 'entry';
          prevHopNode = step.nodeId;
          state.currentNode = step.nodeId;
          state.currentLayer = step.layer;
          state.activePath = [];
          visitedCount++;
          break;
        case 'hop': {
          state.nodeStates[step.nodeId] = 'visited';
          const src = step.from ?? prevHopNode;
          if (state.currentLayer !== step.layer) {
            state.activePath = [];
            state.currentLayer = step.layer;
          } else if (src !== null && src !== undefined && src !== step.nodeId) {
            state.activePath.push({ from: src, to: step.nodeId });
            if (state.activePath.length > 10) state.activePath.shift();
          }
          prevHopNode = step.nodeId;
          state.currentNode = step.nodeId;
          break;
        }
        case 'evaluate':
          if (!state.nodeStates[step.nodeId]) {
            state.nodeStates[step.nodeId] = 'visited';
            visitedCount++;
          }
          if (step.from !== undefined) {
            state.evalEdges.push({ from: step.from, to: step.nodeId, isHit: !!step.isHit, life: 1 });
            if (state.evalEdges.length > 120) state.evalEdges.shift();
          }
          state.rippleQueue = state.rippleQueue || [];
          state.rippleQueue.push({ id: step.nodeId, isHit: step.isHit });
          break;
        case 'result':
          state.nodeStates[step.nodeId] = 'result';
          state.currentNode = null;
          break;
      }

      onStepUpdateRef.current?.({ stepIndex: index, total: steps.length, step, nodesVisited: visitedCount });

      let delay: number;
      if (isBrute) {
        delay = step.type === 'result' ? speedMs * 2 : speedMs * 0.2;
      } else {
        switch (step.type) {
          case 'entry': delay = speedMs * 2.5; break;
          case 'hop': delay = speedMs * 2.0; break;
          case 'result': delay = speedMs * 3.0; break;
          default: delay = speedMs * 0.6;
        }
      }
      timerRef.current = setTimeout(() => playStep(index + 1), delay);
    }

    playStep(0);
  }, [cancel, stateRef]);

  return { play, cancel };
}
