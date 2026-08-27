import { performance } from "node:perf_hooks";

import {
  buildPanelDragStaticGeometry,
  resolveNoOverlapCached,
  type PanelInst,
} from "../src/components_v2/modules/panels/usePanelDragSnap";

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
  const afterWork = () => {
    for (let move = 0; move < POINTER_MOVES / 2; move++) {
      resolveNoOverlapCached({
        u: 20 + move / 5,
        v: 20,
        hw: 6,
        hh: 11,
        gapPx: 2,
        panels: staticPanels,
      });
    }
  };
  const afterMs = medianTiming(afterWork);

  return {
    panels: panelCount,
    rawPointerMoves: POINTER_MOVES,
    scheduledFrames: POINTER_MOVES / 2,
    before: { storeWrites: POINTER_MOVES, minimumProjectionsPerGesture: (panelCount - 1) * POINTER_MOVES, medianCpuMs: beforeMs },
    after: { storeWrites: 1, projectionsPerGesture: afterProjections, medianCpuMs: afterMs },
  };
}

console.log(JSON.stringify({
  note: "Deterministic Node microbenchmark; not an FPS claim or M1 measurement.",
  interactionWriteModelFor600RawMoves: {
    panelDrag: { before: 600, after: 1 },
    zoneVertexDrag: { before: 600, after: 1 },
    roofMove: { before: 600, after: 1 },
    stagePan: { before: 600, after: 1 },
    drawingPointer: { beforeCanvasStageRenders: 600, afterCanvasStageRenders: 0, transientFramesAt60Hz: 300 },
  },
  fixtures: [run(30), run(180), run(400)],
}, null, 2));
