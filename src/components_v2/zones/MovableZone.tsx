"use client";

import React from "react";
import type Konva from "konva";
import { Group, Line } from "react-konva";

import type { Pt } from "@/types/planner";
import { translateRoofOwnedPolygon } from "@/lib/planning-core/geometry-v2";
import type { Zone } from "../state/slices/zonesSlice";
import { history } from "../state/history";
import { plannerTheme } from "../theme/plannerTheme";
import { createLatestFrameScheduler, type FrameScheduler } from "../canvas/performance/latestFrameScheduler";
import ZoneHandlesKonva from "./ZoneHandlesKonva";

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
  snapRadiusImg,
  onSelect,
  onChange,
}: {
  zone: Zone;
  selected: boolean;
  interactive: boolean;
  ownerRoofPoints: Pt[];
  imgW: number;
  imgH: number;
  toImg: (sx: number, sy: number) => Pt;
  snapRadiusImg: number;
  onSelect: () => void;
  onChange: (patch: Partial<Zone>) => void;
}) {
  const groupRef = React.useRef<Konva.Group | null>(null);
  const stageRef = React.useRef<Konva.Stage | null>(null);
  const startPointerRef = React.useRef<Pt | null>(null);
  const startPointsRef = React.useRef<Pt[] | null>(null);
  const finalPointsRef = React.useRef<Pt[] | null>(null);
  const frameRef = React.useRef<FrameScheduler<Pt> | null>(null);
  const movingRef = React.useRef(false);

  const endMove = React.useCallback((commit: boolean) => {
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
  }, [onChange]);

  const startMove = React.useCallback((event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
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
    movingRef.current = true;

    frameRef.current = createLatestFrameScheduler((point: Pt) => {
      const origin = startPointerRef.current;
      const points = startPointsRef.current;
      if (!origin || !points) return;
      const delta = { x: point.x - origin.x, y: point.y - origin.y };
      const result = translateRoofOwnedPolygon({
        points,
        delta,
        ownerRoofPoints,
      });
      finalPointsRef.current = result.valid ? result.points : null;
      const group = groupRef.current;
      if (!group) return;
      group.position(delta);
      group.opacity(result.valid ? 1 : 0.55);
      group.getLayer()?.batchDraw();
    });

    stage.off(".zone-move");
    stage.on("mousemove.zone-move touchmove.zone-move", () => {
      const pointerPosition = stage.getPointerPosition();
      if (!pointerPosition) return;
      frameRef.current?.schedule(toImg(pointerPosition.x, pointerPosition.y));
    });
    stage.on("mouseup.zone-move touchend.zone-move pointerup.zone-move", () => endMove(true));
    stage.on("mouseleave.zone-move", () => endMove(true));
  }, [endMove, interactive, onSelect, ownerRoofPoints, toImg, zone.points]);

  React.useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !movingRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      endMove(false);
    };
    window.addEventListener("keydown", onEscape, { capture: true });
    return () => {
      window.removeEventListener("keydown", onEscape, { capture: true });
      frameRef.current?.cancel();
      stageRef.current?.off(".zone-move");
    };
  }, [endMove]);

  const RED = plannerTheme.danger;
  const fill = selected ? "rgba(255, 95, 86, 0.24)" : plannerTheme.dangerSoft;
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
      {interactive && (
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
          onClick={(event) => { event.cancelBubble = true; onSelect(); }}
          onTap={(event) => { event.cancelBubble = true; onSelect(); }}
          onMouseEnter={(event) => event.target.getStage()?.container()?.style.setProperty("cursor", "move")}
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
