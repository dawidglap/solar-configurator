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
import {
  buildDirectAdvancedRoofLayout,
  createInitialAdvancedPlanning,
  setAdvancedMountingOrientation,
} from "../../src/components_v2/modules/advanced/advancedPlanningApplication";
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

test("real generated store flow keeps every survivor metadata and rendered arrow after two deletes", () => {
  const previous = usePlannerV2Store.getState();
  const roof: RoofArea = {
    id: "roof-real-ui",
    name: "D1",
    roofKind: "flat",
    referenceEdgeIndex: 0,
    tiltDeg: 0,
    points: [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 180 }, { x: 0, y: 180 }],
  };
  const panelSpec = {
    id: "panel-real-ui",
    brand: "Fixture",
    model: "M440",
    wp: 440,
    widthM: 1.134,
    heightM: 1.722,
    priceChf: 0,
  };
  const modules = {
    gridAngleDeg: 0,
    orientation: "landscape" as const,
    spacingM: 0.019,
    marginM: 0.2,
    showGrid: false,
    placingSingle: false,
  };
  const config = setAdvancedMountingOrientation({
    config: createInitialAdvancedPlanning({ panel: panelSpec, standardModules: modules }),
    orientation: "east-west",
  });
  const generated = buildDirectAdvancedRoofLayout({
    roof,
    config,
    mppImage: 0.1,
    zones: [],
    snowGuards: [],
    layoutRunId: "real-ui-delete",
    createPanelId: (index) => `real-ui-panel-${index}`,
  });
  assert.ok(generated);
  assert.ok(generated.panels.length >= 10);

  const renderedArrows = (panels: readonly PanelInstance[]) =>
    resolveOutwardBlockArrowAzimuths(panels.map((panel) => ({
      id: panel.id,
      blockKey: panel.advanced?.blockKey,
      slotIndex: panel.advanced?.slotIndex,
      moduleFaceAzimuthDeg: panel.advanced?.moduleFaceAzimuthDeg,
      cx: panel.cx,
      cy: panel.cy,
    })));
  const metadata = (panel: PanelInstance) => ({
    id: panel.id,
    blockKey: panel.advanced?.blockKey,
    slotIndex: panel.advanced?.slotIndex,
    moduleFaceAzimuthDeg: panel.advanced?.moduleFaceAzimuthDeg,
    angleDeg: panel.angleDeg,
  });

  try {
    const committedPanels = generated.panels;
    const committedRoof = { ...roof, surfacePlanning: generated.config };
    usePlannerV2Store.setState({
      layers: [committedRoof],
      panels: committedPanels,
      selectedId: roof.id,
      selectedPanelIds: [],
    });
    const beforeMetadata = new Map(committedPanels.map((panel) => [panel.id, metadata(panel)]));
    const beforeArrows = renderedArrows(committedPanels);
    const deletedIds = [committedPanels[1].id, committedPanels[8].id];

    usePlannerV2Store.getState().deletePanelsBulk(deletedIds);
    const survivors = usePlannerV2Store.getState().panels;
    const afterArrows = renderedArrows(survivors);

    assert.equal(survivors.length, committedPanels.length - 2);
    for (const survivor of survivors) {
      assert.deepEqual(metadata(survivor), beforeMetadata.get(survivor.id));
      assert.equal(afterArrows.get(survivor.id), beforeArrows.get(survivor.id));
    }

    const refreshed = JSON.parse(JSON.stringify(survivors)) as PanelInstance[];
    const refreshedArrows = renderedArrows(refreshed);
    for (const survivor of refreshed) {
      assert.equal(refreshedArrows.get(survivor.id), beforeArrows.get(survivor.id));
    }
  } finally {
    usePlannerV2Store.setState({
      layers: previous.layers,
      panels: previous.panels,
      selectedId: previous.selectedId,
      selectedPanelIds: previous.selectedPanelIds,
    });
  }
});
