"use client";

import { Circle, Group, Path } from "react-konva";

import type { Snapshot } from "@/types/planner";
import { plannerTheme } from "../theme/plannerTheme";
import {
  resolveLocationMarkerPoint,
  type AddressCoordinates,
} from "./locationMarkerModel";

export default function LocationMarkerKonva({
  snapshot,
  address,
  viewportScale,
  canvasRotationDeg,
}: {
  snapshot: Snapshot;
  address: AddressCoordinates;
  viewportScale: number;
  canvasRotationDeg: number;
}) {
  const point = resolveLocationMarkerPoint(snapshot, address);
  if (!point) return null;

  const inverseScale = 1 / Math.max(viewportScale, 0.01);

  return (
    <Group
      name="location-marker-upright"
      x={point.x}
      y={point.y}
      scaleX={inverseScale}
      scaleY={inverseScale}
      rotation={-canvasRotationDeg}
      listening={false}
      perfectDrawEnabled={false}
    >
      <Path
        data="M 0 0 C -2 -5 -13 -14 -13 -22 A 13 13 0 1 1 13 -22 C 13 -14 2 -5 0 0 Z"
        fill={plannerTheme.primary}
        stroke="rgba(255,255,255,0.92)"
        strokeWidth={2}
        shadowColor="rgba(0,0,0,0.72)"
        shadowBlur={7}
        shadowOffsetY={2}
        shadowOpacity={0.9}
        listening={false}
      />
      <Circle
        x={0}
        y={-22}
        radius={4.25}
        fill="#ffffff"
        stroke="rgba(7,27,51,0.20)"
        strokeWidth={1}
        listening={false}
      />
    </Group>
  );
}
