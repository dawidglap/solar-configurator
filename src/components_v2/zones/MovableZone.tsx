"use client";

import React from "react";
import type Konva from "konva";
import { Group, Line } from "react-konva";

import type { Pt } from "@/types/planner";
import {
  createRoofContainmentSnapshot,
  resolveContainedPolygonTranslation,
  type RoofContainmentSnapshot,
} from "@/lib/planning-core/geometry-v2";
import type { Zone } from "../state/slices/zonesSlice";
import { history } from "../state/history";
import { plannerTheme } from "../theme/plannerTheme";
import { createLatestFrameScheduler, type FrameScheduler } from "../canvas/performance/latestFrameScheduler";
import ZoneHandlesKonva from "./ZoneHandlesKonva";
import {
  HINDERNIS_HATCH_OPACITY,
  HINDERNIS_HATCH_SPACING,
  HINDERNIS_HATCH_SOURCE_CELL_SIZE,
  HINDERNIS_HATCH_STROKE_WIDTH,
  resolveHindernisHatchPatternScale,
} from "@/lib/planning/presentation/hindernisHatch";
import { createRoofSwitchGestureLatch } from "../canvas/interactionPolicy";

function createHindernisHatchPattern(color: string): HTMLImageElement | undefined {
  if (typeof document === "undefined") return undefined;
  const canvas = document.createElement("canvas");
  canvas.width = HINDERNIS_HATCH_SOURCE_CELL_SIZE;
  canvas.height = HINDERNIS_HATCH_SOURCE_CELL_SIZE;
  const context = canvas.getContext("2d");
  if (!context) return undefined;
  context.strokeStyle = color;
  context.lineWidth = HINDERNIS_HATCH_STROKE_WIDTH *
    HINDERNIS_HATCH_SOURCE_CELL_SIZE / HINDERNIS_HATCH_SPACING;
  context.beginPath();
  context.moveTo(0, 0);
  context.lineTo(HINDERNIS_HATCH_SOURCE_CELL_SIZE, HINDERNIS_HATCH_SOURCE_CELL_SIZE);
  context.moveTo(HINDERNIS_HATCH_SOURCE_CELL_SIZE, 0);
  context.lineTo(0, HINDERNIS_HATCH_SOURCE_CELL_SIZE);
  context.stroke();
  // Konva accepts any CanvasImageSource for fill patterns, while react-konva's
  // public prop currently narrows the type to HTMLImageElement.
  return canvas as unknown as HTMLImageElement;
}

function flat(points: Pt[]): number[] {
  return points.flatMap((point) => [point.x, point.y]);
}

export default function MovableZone({
  zone,
  selected,
  interactive,
  ownerRoofPoints,
  imgW,
  imgH,
  toImg,
  stageScale,
  snapRadiusImg,
  onSelect,
  onRoutePointerDown,
  onChange,
}: {
  zone: Zone;
  selected: boolean;
  interactive: boolean;
  ownerRoofPoints: Pt[];
  imgW: number;
  imgH: number;
  toImg: (sx: number, sy: number) => Pt;
  stageScale: number;
  snapRadiusImg: number;
  onSelect: () => void;
  onRoutePointerDown?: (event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => "continue" | "consume" | "ignore";
  onChange: (patch: Partial<Zone>) => void;
}) {
  const groupRef = React.useRef<Konva.Group | null>(null);
  const stageRef = React.useRef<Konva.Stage | null>(null);
  const startPointerRef = React.useRef<Pt | null>(null);
  const startPointsRef = React.useRef<Pt[] | null>(null);
  const finalPointsRef = React.useRef<Pt[] | null>(null);
  const lastValidDeltaRef = React.useRef<Pt | null>(null);
  const containmentSnapshotRef = React.useRef<RoofContainmentSnapshot | null>(null);
  const frameRef = React.useRef<FrameScheduler<Pt> | null>(null);
  const movingRef = React.useRef(false);
  const roofSwitchLatchRef = React.useRef(createRoofSwitchGestureLatch());

  const endMove = React.useCallback((commit: boolean) => {
    if (!movingRef.current) return;
    frameRef.current?.flush();
    stageRef.current?.off(".zone-move");
    const group = groupRef.current;
    group?.position({ x: 0, y: 0 });
    group?.opacity(1);
    group?.getLayer()?.batchDraw();
    if (commit && finalPointsRef.current) {
      history.push("move reserved zone");
      onChange({ points: finalPointsRef.current });
    }
    frameRef.current?.cancel();
    movingRef.current = false;
    startPointerRef.current = null;
    startPointsRef.current = null;
    finalPointsRef.current = null;
    lastValidDeltaRef.current = null;
    containmentSnapshotRef.current = null;
  }, [onChange]);

  const startMove = React.useCallback((event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    roofSwitchLatchRef.current.reset();
    const route = onRoutePointerDown?.(event) ?? "continue";
    if (route === "ignore") return;
    if (route === "consume") {
      roofSwitchLatchRef.current.markRoofSwitch();
      event.cancelBubble = true;
      event.evt.preventDefault?.();
      return;
    }
    if (!interactive || ("button" in event.evt && event.evt.button !== 0)) return;
    event.cancelBubble = true;
    onSelect();
    const stage = event.target.getStage?.() as Konva.Stage | null;
    const pointer = stage?.getPointerPosition();
    if (!stage || !pointer) return;
    const start = toImg(pointer.x, pointer.y);
    stageRef.current = stage;
    startPointerRef.current = start;
    startPointsRef.current = zone.points.map((point) => ({ ...point }));
    finalPointsRef.current = null;
    containmentSnapshotRef.current = createRoofContainmentSnapshot(ownerRoofPoints);
    lastValidDeltaRef.current = { x: 0, y: 0 };
    movingRef.current = true;

    frameRef.current = createLatestFrameScheduler((point: Pt) => {
      const origin = startPointerRef.current;
      const points = startPointsRef.current;
      const snapshot = containmentSnapshotRef.current;
      if (!origin || !points || !snapshot) return;
      const requestedDelta = { x: point.x - origin.x, y: point.y - origin.y };
      const result = resolveContainedPolygonTranslation({
        points,
        requestedDelta,
        previousValidDelta: lastValidDeltaRef.current ?? undefined,
        snapshot,
      });
      finalPointsRef.current = result.valid ? result.points : null;
      const group = groupRef.current;
      if (!group) return;
      if (result.valid) lastValidDeltaRef.current = result.delta;
      group.position(result.valid ? result.delta : (lastValidDeltaRef.current ?? { x: 0, y: 0 }));
      group.opacity(1);
      group.getLayer()?.batchDraw();
    });

    stage.off(".zone-move");
    stage.on("mousemove.zone-move touchmove.zone-move", () => {
      const pointerPosition = stage.getPointerPosition();
      if (!pointerPosition) return;
      frameRef.current?.schedule(toImg(pointerPosition.x, pointerPosition.y));
    });
    stage.on("mouseup.zone-move touchend.zone-move pointerup.zone-move", () => endMove(true));
    stage.on("pointercancel.zone-move touchcancel.zone-move", () => endMove(false));
    stage.on("mouseleave.zone-move", () => endMove(true));
  }, [endMove, interactive, onRoutePointerDown, onSelect, ownerRoofPoints, toImg, zone.points]);

  const selectAfterGesture = React.useCallback((event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (roofSwitchLatchRef.current.consumeFollowup()) {
      event.cancelBubble = true;
      return;
    }
    if (interactive) {
      event.cancelBubble = true;
      onSelect();
    }
  }, [interactive, onSelect]);

  React.useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !movingRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      endMove(false);
    };
    const onBlur = () => endMove(false);
    window.addEventListener("keydown", onEscape, { capture: true });
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onEscape, { capture: true });
      window.removeEventListener("blur", onBlur);
      frameRef.current?.cancel();
      stageRef.current?.off(".zone-move");
    };
  }, [endMove]);

  const RED = plannerTheme.danger;
  const fill = selected ? "rgba(255, 95, 86, 0.24)" : plannerTheme.dangerSoft;
  const hatchPattern = React.useMemo(() => createHindernisHatchPattern(RED), [RED]);
  const hatchPatternScale = resolveHindernisHatchPatternScale(stageScale);
  return (
    <Group ref={groupRef} id={`zone-group-${zone.id}`}>
      <Line
        points={flat(zone.points)}
        closed
        fill={fill}
        stroke={RED}
        strokeWidth={selected ? 1 : 0.25}
        lineJoin="round"
        lineCap="round"
        listening={false}
        perfectDrawEnabled={false}
      />
      <Line
        name="zone-hatch-dense"
        points={flat(zone.points)}
        closed
        listening={false}
        fillPatternImage={hatchPattern}
        fillPatternRepeat="repeat"
        fillPatternScaleX={hatchPatternScale}
        fillPatternScaleY={hatchPatternScale}
        opacity={selected ? HINDERNIS_HATCH_OPACITY + 0.07 : HINDERNIS_HATCH_OPACITY}
        perfectDrawEnabled={false}
      />
      {(interactive || onRoutePointerDown) && (
        <Line
          points={flat(zone.points)}
          closed
          stroke="transparent"
          strokeWidth={14}
          hitStrokeWidth={14}
          listening
          name="zone-hit interactive"
          onMouseDown={startMove}
          onTouchStart={startMove}
          onClick={selectAfterGesture}
          onTap={selectAfterGesture}
          onMouseEnter={(event) => {
            if (interactive) event.target.getStage()?.container()?.style.setProperty("cursor", "move");
          }}
          onMouseLeave={(event) => event.target.getStage()?.container()?.style.removeProperty("cursor")}
        />
      )}
      {interactive && selected && zone.shapeKind !== "rectangle" && (
        <ZoneHandlesKonva
          points={zone.points}
          ownerRoofPoints={ownerRoofPoints}
          imgW={imgW}
          imgH={imgH}
          toImg={toImg}
          snapRadiusImg={snapRadiusImg}
          onChange={(points) => onChange({ points })}
        />
      )}
    </Group>
  );
}
