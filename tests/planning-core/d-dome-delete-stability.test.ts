import assert from "node:assert/strict";
import test from "node:test";

import { usePlannerV2Store } from "../../src/components_v2/state/plannerV2Store";
import { history } from "../../src/components_v2/state/history";
import {
  resolveOutwardBlockArrowAzimuths,
} from "../../src/components_v2/modules/panels/moduleSlope";
import {
  ADVANCED_BLOCK_ENGINE_VERSION,
  ADVANCED_INPUT_SCHEMA_VERSION,
  K2_D_DOME_ADAPTER_VERSION,
  K2_D_DOME_SYSTEM_ID,
  K2_S_DOME_ADAPTER_VERSION,
  K2_S_DOME_SYSTEM_ID,
  SURFACE_PLANNING_SCHEMA_VERSION,
  type AdvancedPanelMetadata,
  type AdvancedSurfacePlanningV1,
} from "../../src/lib/planning-core/advanced";
import {
  GEOMETRY_V2_ENGINE_VERSION,
} from "../../src/lib/planning-core/geometry-v2";
import { stabilizeOpposingPanelFaceIdentities } from "../../src/lib/planning/opposingPanelFaceIdentity";
import type { PanelInstance, RoofArea } from "../../src/types/planner";

function legacyDDomePanel(block: number, slotIndex: 0 | 1): PanelInstance {
  return {
    id: `block-${block}:slot-${slotIndex}`,
    roofId: "roof-ddome",
    cx: block * 10 + (slotIndex === 0 ? -1 : 1),
    cy: 5,
    wPx: 1,
    hPx: 2,
    angleDeg: slotIndex === 0 ? 0 : 180,
    orientation: "landscape",
    panelId: "module",
    advanced: {
      systemId: K2_D_DOME_SYSTEM_ID,
      adapterVersion: K2_D_DOME_ADAPTER_VERSION,
      layoutMode: "advanced",
      advancedEngineVersion: ADVANCED_BLOCK_ENGINE_VERSION,
      geometryEngineVersion: GEOMETRY_V2_ENGINE_VERSION,
      blockKey: `block-${block}`,
      slotIndex,
      nominalTiltDeg: 10,
      effectiveTiltDeg: 10,
    } as AdvancedPanelMetadata,
  };
}

function arrows(panels: readonly PanelInstance[]) {
  return resolveOutwardBlockArrowAzimuths(panels.map((panel) => ({
    id: panel.id,
    blockKey: panel.advanced?.blockKey,
    slotIndex: panel.advanced?.slotIndex,
    moduleFaceAzimuthDeg: panel.advanced?.moduleFaceAzimuthDeg,
    cx: panel.cx,
    cy: panel.cy,
  })));
}

function roofWithDDomeConfig(): RoofArea {
  const surfacePlanning: AdvancedSurfacePlanningV1 = {
    schemaVersion: SURFACE_PLANNING_SCHEMA_VERSION,
    mode: "advanced",
    surface: { kind: "flat", slopeDeg: 0 },
    advanced: {
      inputSchemaVersion: ADVANCED_INPUT_SCHEMA_VERSION,
      advancedEngineVersion: ADVANCED_BLOCK_ENGINE_VERSION,
      geometryEngineVersion: GEOMETRY_V2_ENGINE_VERSION,
      module: {
        panelSpecId: "module",
        widthM: 1,
        heightM: 2,
        orientation: "landscape",
      },
      system: {
        systemId: K2_D_DOME_SYSTEM_ID,
        adapterVersion: K2_D_DOME_ADAPTER_VERSION,
        rowSpaceM: 1,
        primaryFaceAzimuthDeg: 270,
      },
      layout: {
        marginM: 0.2,
        phaseX: 0,
        phaseY: 0,
        anchorX: "start",
        anchorY: "start",
      },
    },
  };
  return {
    id: "roof-ddome",
    name: "D1",
    roofKind: "flat",
    points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }],
    surfacePlanning,
  };
}

test("single delete snapshots the legacy pair direction onto either survivor", () => {
  for (const deletedSlot of [0, 1] as const) {
    const pair = [legacyDDomePanel(0, 0), legacyDDomePanel(0, 1)];
    const before = arrows(pair);
    const stabilized = stabilizeOpposingPanelFaceIdentities(pair);
    const survivor = stabilized.find((panel) => panel.advanced?.slotIndex !== deletedSlot)!;
    const after = arrows([survivor]);
    assert.equal(after.get(survivor.id), before.get(survivor.id));
    assert.equal(survivor.advanced?.slotIndex, deletedSlot === 0 ? 1 : 0);
  }
});

test("bulk delete across ten pairs preserves every non-deleted block face", () => {
  const panels = Array.from({ length: 10 }, (_, block) => [
    legacyDDomePanel(block, 0),
    legacyDDomePanel(block, 1),
  ]).flat();
  const before = arrows(panels);
  const deletedIds = new Set([
    panels[0].id,
    legacyDDomePanel(4, 1).id,
    legacyDDomePanel(7, 0).id,
  ]);
  const survivors = stabilizeOpposingPanelFaceIdentities(panels)
    .filter((panel) => !deletedIds.has(panel.id));
  const after = arrows(survivors);
  for (const survivor of survivors) {
    assert.equal(after.get(survivor.id), before.get(survivor.id));
  }
});

test("an already orphaned legacy slot derives once from the persisted D-Dome config", () => {
  const orphan = legacyDDomePanel(0, 1);
  const [stabilized] = stabilizeOpposingPanelFaceIdentities([orphan], [roofWithDDomeConfig()]);
  assert.equal(stabilized.advanced?.slotIndex, 1);
  assert.equal(stabilized.advanced?.moduleFaceAzimuthDeg, 90);
});

test("store delete, JSON refresh, undo and redo retain block slot and face identity", () => {
  const previous = usePlannerV2Store.getState();
  const pair = [legacyDDomePanel(0, 0), legacyDDomePanel(0, 1)];
  try {
    usePlannerV2Store.setState({
      layers: [roofWithDDomeConfig()],
      panels: pair,
      selectedPanelIds: [pair[1].id],
    });
    history.clear();
    history.push("delete D-Dome slot");
    usePlannerV2Store.getState().deletePanel(pair[1].id);

    const [survivor] = usePlannerV2Store.getState().panels;
    assert.equal(survivor.id, pair[0].id);
    assert.equal(survivor.advanced?.slotIndex, 0);
    assert.equal(survivor.advanced?.moduleFaceAzimuthDeg, 270);
    const refreshed = JSON.parse(JSON.stringify(survivor)) as PanelInstance;
    assert.equal(arrows([refreshed]).get(refreshed.id), 270);

    history.undo();
    assert.deepEqual(usePlannerV2Store.getState().panels.map((panel) => panel.id), pair.map((panel) => panel.id));
    history.redo();
    const [redoSurvivor] = usePlannerV2Store.getState().panels;
    assert.equal(redoSurvivor.advanced?.moduleFaceAzimuthDeg, 270);
  } finally {
    history.clear();
    usePlannerV2Store.setState({
      layers: previous.layers,
      panels: previous.panels,
      selectedPanelIds: previous.selectedPanelIds,
    });
  }
});

test("S-Dome metadata is outside the opposing-face normalization", () => {
  const panel = legacyDDomePanel(0, 0);
  panel.advanced = {
    ...panel.advanced!,
    systemId: K2_S_DOME_SYSTEM_ID,
    adapterVersion: K2_S_DOME_ADAPTER_VERSION,
  } as AdvancedPanelMetadata;
  const [unchanged] = stabilizeOpposingPanelFaceIdentities([panel], [roofWithDDomeConfig()]);
  assert.equal(unchanged, panel);
});
