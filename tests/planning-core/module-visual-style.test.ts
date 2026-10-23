import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (relativePath: string) => readFileSync(
  new URL(`../../${relativePath}`, import.meta.url),
  "utf8",
);

test("all 2D module renderers use the shared flat black and silver visual tokens", () => {
  const theme = source("src/components_v2/theme/plannerTheme.ts");
  const sprite = source("src/components_v2/modules/ModuleSprite.tsx");
  const committed = source("src/components_v2/modules/panels/PanelItem.tsx");
  const standardPreview = source("src/components_v2/modules/ModulesPreview.tsx");
  const advancedPreview = source("src/components_v2/modules/advanced/AdvancedPreviewLayer.tsx");

  assert.match(theme, /surface:\s*'#050505'/);
  assert.match(theme, /frame:\s*'#c3c8ce'/);
  for (const renderer of [sprite, committed, standardPreview, advancedPreview]) {
    assert.match(renderer, /plannerModuleVisual\.surface/);
    assert.match(renderer, /plannerModuleVisual\.frame/);
    assert.doesNotMatch(renderer, /panel\.webp|fillPatternImage|KonvaImage/);
  }
  assert.match(committed, /stroke=\{plannerModuleVisual\.frame\}[\s\S]*listening=\{false\}/);
});

test("manual, fill and canvas paths no longer inject a panel texture", () => {
  const files = [
    "src/components_v2/canvas/CanvasStage.tsx",
    "src/components_v2/modules/ManualPlacementLayer.tsx",
    "src/components_v2/modules/fill/FillAreaPreviewLayer.tsx",
    "src/components_v2/modules/PanelsKonva.tsx",
    "src/components_v2/modules/panels/PanelsLayer.tsx",
  ];
  files.forEach((file) => {
    const contents = source(file);
    assert.doesNotMatch(contents, /panel\.webp|textureUrl|usePanelTexture/);
  });
});

test("3D keeps black top surfaces, silver frames and a selection-only outline", () => {
  const canvas = source("src/components_v2/three/Planner3DCanvas.tsx");
  assert.match(canvas, /panelSurfaceGeometry/);
  assert.match(canvas, /panelFrameGeometry/);
  assert.match(canvas, /color=\{plannerModuleVisual\.surface\}/);
  assert.match(canvas, /color=\{plannerModuleVisual\.frameSide3d\}/);
  assert.match(canvas, /color=\{plannerModuleVisual\.frame\}/);
  assert.match(canvas, /color=\{plannerModuleVisual\.selected\}/);
  assert.doesNotMatch(canvas, /TextureLoader|useTexture|map=/);
});
