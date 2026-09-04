"use client";

import React from "react";
import { Group, Line, Rect, Text } from "react-konva";
import type Konva from "konva";
import { nanoid } from "nanoid";
import toast from "react-hot-toast";

import {
  GENERIC_EAST_WEST_SYSTEM_ID,
  K2_D_DOME_SYSTEM_ID,
  resolveSurfacePlanning,
  type AdvancedSurfacePlanningV1,
} from "@/lib/planning-core/advanced";
import { resolveRoofEdgeMarginM } from "@/lib/planning/roofProperties";
import { plannerTheme } from "../theme/plannerTheme";
import { resolveRoofFallAzimuth } from "../roof/roofOrientation";
import ModuleSprite from "./ModuleSprite";
import ModuleSlopeArrow from "./panels/ModuleSlopeArrow";
import { resolveModuleDownhillAzimuth } from "./panels/moduleSlope";
import { usePlannerV2Store } from "../state/plannerV2Store";
import {
  resolveStandardAutoLayoutCanvasAngle,
} from "./legacyStandardApplicationPolicy";
import {
  buildAdvancedManualCandidate,
  buildStandardManualCandidate,
  materializeManualAdvancedPanels,
  resolveManualAdvancedBlockDefinition,
  regroupK2PanelsAfterManualAdd,
  snapAdvancedManualCenter,
  snapStandardManualCenter,
  type ManualPlacementCandidate,
} from "./manualPlacement";
import {
  buildStandardPanelMetadata,
  buildStandardSurfacePlanning,
  resolveStandardTiltInput,
} from "./advanced/advancedPlanningApplication";
import {
  endManualPlacement,
  useManualPlacementSession,
} from "./manualPlacementSession";

type Props = {
  imageWidth: number;
  imageHeight: number;
  toImgCoords: (stageX: number, stageY: number) => { x: number; y: number };
};

function pointerImage(
  event: Konva.KonvaEventObject<MouseEvent | TouchEvent>,
  toImgCoords: Props["toImgCoords"],
) {
  const point = event.target.getStage()?.getPointerPosition();
  return point ? toImgCoords(point.x, point.y) : null;
}

export default function ManualPlacementLayer({
  imageWidth,
  imageHeight,
  toImgCoords,
}: Props) {
  const session = useManualPlacementSession();
  const layers = usePlannerV2Store((state) => state.layers);
  const panels = usePlannerV2Store((state) => state.panels);
  const zones = usePlannerV2Store((state) => state.zones);
  const snowGuards = usePlannerV2Store((state) => state.snowGuards);
  const snapshot = usePlannerV2Store((state) => state.snapshot);
  const modules = usePlannerV2Store((state) => state.modules);
  const selectedPanel = usePlannerV2Store((state) => state.getSelectedPanel());
  const catalogPanels = usePlannerV2Store((state) => state.catalogPanels);
  const drafts = usePlannerV2Store((state) => state.roofPlanningDrafts);
  const commitRoofLayout = usePlannerV2Store((state) => state.commitRoofLayout);
  const addPanelsForRoof = usePlannerV2Store((state) => state.addPanelsForRoof);
  const setSelectedPanels = usePlannerV2Store((state) => state.setSelectedPanels);
  const setSelectedPanel = usePlannerV2Store((state) => state.setSelectedPanel);
  const setModules = usePlannerV2Store((state) => state.setModules);
  const stageScale = usePlannerV2Store((state) => state.view.scale || state.view.fitScale || 1);
  const [candidate, setCandidate] = React.useState<ManualPlacementCandidate | null>(null);
  const latestPointer = React.useRef<{ x: number; y: number; disableSnap: boolean } | null>(null);
  const frameRef = React.useRef<number | null>(null);

  const roof = session ? layers.find((item) => item.id === session.roofId) : undefined;
  const roofDraft = roof ? drafts[roof.id] : undefined;
  const standardDraft = roofDraft?.targetMode === "standard"
    ? roofDraft
    : undefined;
  const standardModules = standardDraft?.modules ?? modules;
  const standardPanel = standardDraft
    ? catalogPanels.find((panel) => panel.id === standardDraft.panelSpecId)
    : selectedPanel;
  const advancedConfig = React.useMemo<AdvancedSurfacePlanningV1 | null>(() => {
    if (!roof) return null;
    const draft = drafts[roof.id];
    if (draft?.targetMode === "advanced") return draft.config;
    const resolved = resolveSurfacePlanning(roof.surfacePlanning);
    return resolved.status === "supported-advanced" ? resolved.config : null;
  }, [drafts, roof]);
  const definition = React.useMemo(
    () => (advancedConfig ? resolveManualAdvancedBlockDefinition(advancedConfig) : null),
    [advancedConfig],
  );

  const computeAt = React.useCallback((raw: { x: number; y: number; disableSnap: boolean }) => {
    if (!session || !roof || !snapshot.mppImage) return null;
    if (session.kind === "advanced-block") {
      if (!advancedConfig || !definition) return null;
      const centerPx = snapAdvancedManualCenter({
        pointerPx: raw,
        roofId: roof.id,
        panels,
        definition,
        mppImage: snapshot.mppImage,
        activationThresholdPx: 12 / Math.max(stageScale, 0.01),
        disableSnap: raw.disableSnap,
      });
      return buildAdvancedManualCandidate({
        centerPx,
        roof,
        config: advancedConfig,
        mppImage: snapshot.mppImage,
        zones,
        snowGuards,
        panels,
      });
    }
    if (!standardPanel) return null;
    const angleDeg = resolveStandardAutoLayoutCanvasAngle({
      roofId: roof.id,
      roofPolygon: roof.points,
      legacyRoofAzimuthDeg: roof.azimuthDeg,
      gridAngleDeg: standardModules.gridAngleDeg,
      perRoofAngles: standardModules.perRoofAngles,
      referenceEdgeIndex: roof.referenceEdgeIndex,
    });
    const widthM = standardModules.orientation === "portrait" ? standardPanel.widthM : standardPanel.heightM;
    const heightM = standardModules.orientation === "portrait" ? standardPanel.heightM : standardPanel.widthM;
    const spacingX = standardModules.spacingXM ?? standardModules.spacingM;
    const spacingY = standardModules.spacingYM ?? standardModules.spacingM;
    const centerPx = snapStandardManualCenter({
      pointerPx: raw,
      roofId: roof.id,
      panels,
      angleDeg,
      widthPx: widthM / snapshot.mppImage,
      heightPx: heightM / snapshot.mppImage,
      gapXPx: spacingX / snapshot.mppImage,
      gapYPx: spacingY / snapshot.mppImage,
      activationThresholdPx: 12 / Math.max(stageScale, 0.01),
      disableSnap: raw.disableSnap,
    });
    return buildStandardManualCandidate({
      centerPx,
      roof,
      panel: standardPanel,
      orientation: standardModules.orientation,
      angleDeg,
      marginM: resolveRoofEdgeMarginM(roof, standardModules.marginM),
      gapXM: spacingX,
      gapYM: spacingY,
      mppImage: snapshot.mppImage,
      zones,
      snowGuards,
      panels,
    });
  }, [advancedConfig, definition, panels, roof, session, snapshot.mppImage, snowGuards, stageScale, standardModules, standardPanel, zones]);

  const schedule = React.useCallback((point: { x: number; y: number; disableSnap: boolean }) => {
    latestPointer.current = point;
    if (frameRef.current != null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const latest = latestPointer.current;
      if (latest) setCandidate(computeAt(latest));
    });
  }, [computeAt]);

  React.useEffect(() => {
    setCandidate(null);
    latestPointer.current = null;
  }, [session?.roofId, session?.kind]);

  React.useEffect(() => () => {
    if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
  }, []);

  React.useEffect(() => {
    if (!session) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      endManualPlacement();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [session]);

  if (!session || !roof) return null;

  const commit = (placement: ManualPlacementCandidate | null) => {
    if (!placement?.valid) return;
    if (session.kind === "standard-module") {
      if (!standardPanel || placement.modules.length !== 1) return;
      const placedModule = placement.modules[0];
      const moduleTilt = standardDraft?.moduleTilt ?? resolveStandardTiltInput(roof.surfacePlanning);
      const standardMetadata = buildStandardPanelMetadata({
        roofSlopeDeg: roof.tiltDeg,
        moduleTilt,
      });
      const persistedStandardPlanning = resolveSurfacePlanning(roof.surfacePlanning);
      const standardThermalFieldLimits = standardDraft?.thermalFieldLimits ??
        (persistedStandardPlanning.status === "supported-standard"
          ? persistedStandardPlanning.config.thermalFieldLimits
          : undefined);
      const panelId = nanoid();
      const panel = {
        id: panelId,
        roofId: roof.id,
        cx: placedModule.cx,
        cy: placedModule.cy,
        wPx: placedModule.wPx,
        hPx: placedModule.hPx,
        angleDeg: placedModule.angleDeg,
        orientation: standardModules.orientation,
        panelId: standardPanel.id,
        ...(standardMetadata ? {
          standard: {
            ...standardMetadata,
            ...(standardThermalFieldLimits
              ? { thermalFieldKey: `${roof.id}:manual:${panelId}` }
              : {}),
          },
        } : {}),
      } as const;
      if (standardDraft) {
        const existing = usePlannerV2Store
          .getState()
          .panels.filter((item) => item.roofId === roof.id);
        commitRoofLayout({
          roofId: roof.id,
          panels: [...existing, panel],
          surfacePlanning: buildStandardSurfacePlanning({
            roof,
            moduleTilt,
            thermalFieldLimits: standardThermalFieldLimits,
          }),
        });
        setSelectedPanel(standardPanel.id);
        setModules(standardModules);
      } else {
        addPanelsForRoof(roof.id, [panel]);
      }
      setSelectedPanels([panel.id]);
      toast.success("Modul hinzugefügt");
      return;
    }
    if (!advancedConfig) return;
    const runId = `manual-${nanoid()}`;
    const blockKey = `${roof.id}:${runId}:block:0`;
    // A freely positioned block is a deterministic standalone field in V1.
    // Existing field membership and all physical coordinates remain untouched.
    const montageFieldKey = `${roof.id}:${runId}:field:0`;
    const thermalFieldKey = advancedConfig.thermalFieldLimits
      ? `${roof.id}:${runId}:thermal:0`
      : undefined;
    const added = materializeManualAdvancedPanels({
      candidate: placement,
      roofId: roof.id,
      config: advancedConfig,
      layoutRunId: runId,
      blockKey,
      montageFieldKey,
      thermalFieldKey,
      createPanelId: (slotIndex) => `${roof.id}_${runId}_${slotIndex}`,
    });
    if (!added.length) return;
    const existing = usePlannerV2Store.getState().panels.filter((panel) => panel.roofId === roof.id);
    const regrouped = regroupK2PanelsAfterManualAdd({
      panels: [...existing, ...added],
      roof,
      config: advancedConfig,
      mppImage: snapshot.mppImage!,
    });
    commitRoofLayout({
      roofId: roof.id,
      panels: regrouped,
      surfacePlanning: advancedConfig,
    });
    setSelectedPanels(added.map((panel) => panel.id));
    toast.success(added.length === 2 ? "K2 Block hinzugefügt" : "Modul hinzugefügt");
  };

  const valid = candidate?.valid ?? false;
  const stroke = valid ? plannerTheme.primary : plannerTheme.danger;
  const inverseScale = 1 / Math.max(stageScale, 0.01);
  const blockCenter = candidate?.blockFootprintPx.length
    ? candidate.blockFootprintPx.reduce(
        (sum, point) => ({
          x: sum.x + point.x / candidate.blockFootprintPx.length,
          y: sum.y + point.y / candidate.blockFootprintPx.length,
        }),
        { x: 0, y: 0 },
      )
    : null;
  const opposingSystem = advancedConfig?.advanced.system.systemId === K2_D_DOME_SYSTEM_ID ||
    advancedConfig?.advanced.system.systemId === GENERIC_EAST_WEST_SYSTEM_ID;
  const helperText = valid ? "Klicken zum Platzieren" : "Position nicht möglich";
  const helperAnchor = candidate?.blockFootprintPx.reduce(
    (top, point) => point.y < top.y ? point : top,
    candidate.blockFootprintPx[0] ?? { x: 0, y: 0 },
  );
  return (
    <Group>
      <Rect
        width={imageWidth}
        height={imageHeight}
        fill="rgba(0,0,0,0.001)"
        name="interactive-manual-placement"
        onMouseMove={(event) => {
          const point = pointerImage(event, toImgCoords);
          if (point) schedule({ ...point, disableSnap: event.evt.shiftKey });
        }}
        onMouseEnter={(event) => {
          const container = event.target.getStage()?.container();
          if (container) container.style.cursor = "crosshair";
        }}
        onTouchMove={(event) => {
          const point = pointerImage(event, toImgCoords);
          if (point) schedule({ ...point, disableSnap: false });
        }}
        onClick={(event) => {
          if (event.evt.button !== 0) return;
          event.cancelBubble = true;
          // Commit exactly the candidate currently rendered as the ghost.
          // Pointer movement will publish the next candidate on the next frame.
          commit(candidate);
        }}
      />
      {candidate && (
        <Group listening={false} opacity={valid ? 0.72 : 0.42}>
          {candidate.modules.map((module) => {
            const downhillAzimuthDeg = session.kind === "standard-module"
              ? resolveModuleDownhillAzimuth({
                  kind: "pitched",
                  roofFallAzimuthDeg: resolveRoofFallAzimuth(roof),
                })
              : opposingSystem && blockCenter
                ? resolveModuleDownhillAzimuth({
                    kind: "flat-opposing",
                    blockCenterPx: blockCenter,
                    moduleCenterPx: { x: module.cx, y: module.cy },
                    moduleFaceAzimuthDeg: module.faceAzimuthDeg,
                  })
                : resolveModuleDownhillAzimuth({
                    kind: "flat-south",
                    moduleFaceAzimuthDeg: module.faceAzimuthDeg,
                  });
            return (
              <Group key={module.slotIndex} listening={false}>
                <ModuleSprite
                  x={module.cx}
                  y={module.cy}
                  w={module.wPx}
                  h={module.hPx}
                  rotationDeg={module.angleDeg}
                  textureUrl="/images/panel.webp"
                />
                <ModuleSlopeArrow
                  cx={module.cx}
                  cy={module.cy}
                  wPx={module.wPx}
                  hPx={module.hPx}
                  azimuthDeg={downhillAzimuthDeg}
                />
              </Group>
            );
          })}
          <Line
            points={candidate.blockFootprintPx.flatMap((point) => [point.x, point.y])}
            closed
            stroke={stroke}
            strokeWidth={1.5}
            dash={valid ? undefined : [5, 3]}
          />
          {helperAnchor && (
            <Group
              x={helperAnchor.x}
              y={helperAnchor.y - 34 * inverseScale}
              listening={false}
            >
              <Rect
                x={-4 * inverseScale}
                y={-3 * inverseScale}
                width={142 * inverseScale}
                height={29 * inverseScale}
                fill="rgba(15, 23, 42, 0.92)"
                stroke={stroke}
                strokeWidth={0.8 * inverseScale}
                cornerRadius={5 * inverseScale}
                listening={false}
              />
              <Text
                text={`${helperText}\nEsc zum Beenden`}
                fill={plannerTheme.textLight}
                fontSize={11 * inverseScale}
                lineHeight={1.15}
                listening={false}
              />
            </Group>
          )}
        </Group>
      )}
    </Group>
  );
}
