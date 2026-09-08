import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { readFileSync } from "node:fs";

import { buildThermalFieldPdf } from "../../src/components_v2/modules/thermalFields/thermalFieldPdf";
import {
  HINDERNIS_HATCH_SPACING,
  resolveHindernisHatchPatternScale,
} from "../../src/lib/planning/presentation/hindernisHatch";

test("committed thermal export builds a two-page vector fallback PDF", async () => {
  const bytes = await buildThermalFieldPdf({
    roof: { id: "roof-1", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 0, y: 60 }] } as never,
    panels: [{ id: "p1", roofId: "roof-1", cx: 20, cy: 20, wPx: 10, hPx: 16 }] as never,
    obstacles: [{ points: [{ x: 40, y: 20 }, { x: 60, y: 20 }, { x: 60, y: 40 }, { x: 40, y: 40 }] }],
    fields: [{
      key: "t:r0-0:c0-0",
      displayId: "T1",
      color: "#2dd4bf",
      outlinePx: [{ x: 10, y: 10 }, { x: 30, y: 10 }, { x: 30, y: 40 }, { x: 10, y: 40 }],
      lengthM: 5,
      widthM: 4,
      moduleCount: 1,
      lengthLimitM: 17.6,
      widthLimitM: 17.6,
      valid: true,
      thermalSeparationGapM: 0.14,
    }],
    separationGapM: 0.14,
    backgroundImageUrl: "invalid://satellite-unavailable",
  });
  assert.ok(bytes.length > 1_000);
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 2);
  assert.deepEqual(pdf.getPage(0).getSize(), { width: 841.89, height: 595.28 });
});

test("obstacles use a dedicated X hatch and export stays committed-only in CanvasStage", () => {
  const zone = readFileSync(new URL("../../src/components_v2/zones/MovableZone.tsx", import.meta.url), "utf8");
  const stage = readFileSync(new URL("../../src/components_v2/canvas/CanvasStage.tsx", import.meta.url), "utf8");
  assert.match(zone, /zone-hatch-/);
  assert.match(zone, /fillPatternImage/);
  assert.doesNotMatch(zone, /hatch\.map/);
  assert.match(stage, /!thermalFieldsArePreview/);
  assert.match(stage, /Bitte Änderungen zuerst anwenden/);
  const pdfSource = readFileSync(new URL("../../src/components_v2/modules/thermalFields/thermalFieldPdf.ts", import.meta.url), "utf8");
  assert.match(pdfSource, /PRINT\.white/);
  assert.match(pdfSource, /HINDERNIS_HATCH_SPACING/);
  assert.match(pdfSource, /Thermischer Trennabstand:/);
});

test("Hindernis hatch is nine times denser and remains stable in output space", () => {
  assert.equal(HINDERNIS_HATCH_SPACING, 2);
  assert.equal(18 / HINDERNIS_HATCH_SPACING, 9);
  for (const stageScale of [0.5, 1, 2, 4]) {
    const sourceCellScreenSize = 4 * resolveHindernisHatchPatternScale(stageScale) * stageScale;
    assert.ok(Math.abs(sourceCellScreenSize - HINDERNIS_HATCH_SPACING) < 1e-12);
  }
});
