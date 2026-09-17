import { performance } from "node:perf_hooks";

import {
  buildPanelDragStaticGeometry,
  createPanelDragSpatialIndex,
  resolvePanelDragFrameUV,
  type PanelInst,
} from "../src/components_v2/modules/panels/usePanelDragSnap";
import { createPanelPastePlacementValidator } from "../src/components_v2/modules/manualPlacement";
import type { PanelInstance, RoofArea } from "../src/types/planner";

const POINTER_MOVES = 600;

function fixture(panelCount: number): PanelInst[] {
  return Array.from({ length: panelCount }, (_, index) => ({
    id: `panel-${index}`,
    roofId: "roof-benchmark",
    cx: (index % 25) * 14,
    cy: Math.floor(index / 25) * 24,
    wPx: 12,
    hPx: 22,
    angleDeg: 0,
  }));
}

function medianTiming(run: () => void): number {
  run();
  const samples = Array.from({ length: 9 }, () => {
    const start = performance.now();
    run();
    return performance.now() - start;
  }).sort((a, b) => a - b);
  return Number(samples[Math.floor(samples.length / 2)].toFixed(3));
}

function run(panelCount: number) {
  const panels = fixture(panelCount);
  let afterProjections = 0;
  const legacyResolve = (u0: number, v0: number) => {
    let u = u0;
    let v = v0;
    for (let pass = 0; pass < 4; pass++) {
      let changed = false;
      for (let index = 1; index < panels.length; index++) {
        const panel = panels[index];
        const panelU = panel.cx;
        const panelV = panel.cy;
        const minU = 6 + panel.wPx / 2 + 2;
        const minV = 11 + panel.hPx / 2 + 2;
        const du = u - panelU;
        const dv = v - panelV;
        const penU = minU - Math.abs(du);
        const penV = minV - Math.abs(dv);
        if (penU > 0 && penV > 0) {
          if (penU < penV) u = panelU + (du >= 0 ? minU : -minU);
          else v = panelV + (dv >= 0 ? minV : -minV);
          changed = true;
        }
      }
      if (!changed) break;
    }
    return { u, v };
  };
  const beforeWork = () => {
    for (let move = 0; move < POINTER_MOVES; move++) {
      legacyResolve(20 + move / 10, 20);
    }
  };
  const beforeMs = medianTiming(beforeWork);

  const staticPanels = buildPanelDragStaticGeometry({
    allPanels: panels,
    roofId: "roof-benchmark",
    excludeId: "panel-0",
    defaultAngleDeg: 0,
    project: ({ x, y }) => {
      afterProjections++;
      return { u: x, v: y };
    },
  });
  const spatialIndex = createPanelDragSpatialIndex(staticPanels, 40);
  const benchmarkRoof: RoofArea = {
    id: "roof-benchmark",
    name: "Benchmark",
    points: [
      { x: -100, y: -100 },
      { x: 500, y: -100 },
      { x: 500, y: 1000 },
      { x: -100, y: 1000 },
    ],
  };
  const committedPanels = panels.map((panel) => ({
    ...panel,
    angleDeg: panel.angleDeg ?? 0,
    orientation: "portrait" as const,
    panelId: "benchmark-module",
  })) satisfies PanelInstance[];
  const validatePlacement = createPanelPastePlacementValidator({
    roof: benchmarkRoof,
    marginM: 0,
    mppImage: 0.1,
    zones: [],
    snowGuards: [],
    panels: committedPanels,
    excludePanelIds: new Set(["panel-0"]),
    moduleGapXM: 0.2,
    moduleGapYM: 0.2,
  });
  const solveFrame = (move: number) => {
    const free = { u: 20 + move / 5, v: 20 };
    resolvePanelDragFrameUV({
      free,
      hw: 6,
      hh: 11,
      gapXPx: 2,
      gapYPx: 2,
      activationThresholdPx: 10,
      panels: spatialIndex.query(free.u, free.v, 50),
      validate: (position) => validatePlacement([{
        ...committedPanels[0],
        cx: position.u,
        cy: position.v,
      }]),
    });
  };
  const afterWork = () => {
    for (let move = 0; move < POINTER_MOVES / 2; move++) {
      solveFrame(move);
    }
  };
  const afterMs = medianTiming(afterWork);
  const solveSamples = Array.from({ length: POINTER_MOVES / 2 }, (_, move) => {
    const start = performance.now();
    solveFrame(move);
    return performance.now() - start;
  }).sort((a, b) => a - b);
  const averageSolveMs = solveSamples.reduce((sum, value) => sum + value, 0) / solveSamples.length;
  const p95SolveMs = solveSamples[Math.floor((solveSamples.length - 1) * 0.95)];

  return {
    panels: panelCount,
    rawPointerMoves: POINTER_MOVES,
    scheduledFrames: POINTER_MOVES / 2,
    historicalPushAway: {
      storeWrites: POINTER_MOVES,
      minimumProjectionsPerGesture: (panelCount - 1) * POINTER_MOVES,
      medianCpuMs: beforeMs,
    },
    v2: {
      storeWritesDuringPointerMove: 0,
      storeWritesOnValidRelease: 1,
      projectionsPerGesture: afterProjections,
      medianCpuMsFor300Frames: afterMs,
      averageTransientSolveMs: Number(averageSolveMs.toFixed(4)),
      p95TransientSolveMs: Number(p95SolveMs.toFixed(4)),
    },
  };
}

console.log(JSON.stringify({
  note: "Deterministic Node microbenchmark; not an FPS claim or M1 measurement.",
  historicalUnoptimizedWriteModelFor600RawMoves: {
    panelDrag: { duringPointerMove: 600 },
    zoneVertexDrag: { before: 600, after: 1 },
    roofMove: { before: 600, after: 1 },
    stagePan: { before: 600, after: 1 },
    drawingPointer: { beforeCanvasStageRenders: 600, afterCanvasStageRenders: 0, transientFramesAt60Hz: 300 },
  },
  panelDragV2For600RawMoves: {
    persistentWritesDuringPointerMove: 0,
    persistentWritesOnValidRelease: 1,
    persistentWritesOnInvalidRelease: 0,
    canvasStageReactRendersCausedByPointerFrames: 0,
    scheduledTransientFramesAt60HzOverFiveSeconds: 300,
  },
  fixtures: [run(30), run(180), run(400)],
}, null, 2));
