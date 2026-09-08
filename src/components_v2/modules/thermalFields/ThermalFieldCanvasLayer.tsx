"use client";

import React from "react";
import { Group, Line, Rect, Text } from "react-konva";

import type { Pt } from "@/types/planner";
import {
  buildThermalBreakDisplays,
  type ThermalFieldDisplay,
} from "./thermalFieldDisplay";

function centroid(points: readonly Pt[]): Pt {
  const count = Math.max(1, points.length);
  return points.reduce(
    (sum, point) => ({ x: sum.x + point.x / count, y: sum.y + point.y / count }),
    { x: 0, y: 0 },
  );
}

export default function ThermalFieldCanvasLayer({
  fields,
  selectedKey,
  canvasRotationDeg,
  viewportScale,
  onSelect,
}: {
  fields: readonly ThermalFieldDisplay[];
  selectedKey?: string;
  canvasRotationDeg: number;
  viewportScale: number;
  onSelect: (key: string) => void;
}) {
  const inverseScale = 1 / Math.max(viewportScale, 0.0001);
  const breaks = React.useMemo(() => buildThermalBreakDisplays(fields), [fields]);
  return (
    <Group>
      {fields.map((field) => {
        const selected = field.key === selectedKey;
        const center = centroid(field.outlinePx);
        return (
          <Group key={field.key}>
            <Line
              points={field.outlinePx.flatMap((point) => [point.x, point.y])}
              closed
              stroke={field.color}
              strokeWidth={selected ? 3.25 : 2.25}
              strokeScaleEnabled={false}
              opacity={selected ? 1 : 0.82}
              fill={selected ? `${field.color}14` : `${field.color}09`}
              listening={false}
              perfectDrawEnabled={false}
            />
            <Group
              x={center.x}
              y={center.y}
              rotation={-canvasRotationDeg}
              scaleX={inverseScale}
              scaleY={inverseScale}
              onClick={(event) => {
                event.cancelBubble = true;
                onSelect(field.key);
              }}
              onTap={(event) => {
                event.cancelBubble = true;
                onSelect(field.key);
              }}
              name="interactive thermal-field-label"
            >
              <Rect
                x={-18}
                y={-12}
                width={36}
                height={24}
                cornerRadius={12}
                fill="rgba(12, 18, 28, 0.92)"
                stroke={field.color}
                strokeWidth={selected ? 2 : 1.25}
                shadowColor="rgba(0,0,0,0.35)"
                shadowBlur={4}
              />
              <Text
                x={-18}
                y={-6}
                width={36}
                align="center"
                text={field.displayId}
                fill="#f8fafc"
                fontSize={12}
                fontStyle="bold"
                listening={false}
              />
            </Group>
          </Group>
        );
      })}
      {breaks.map((item) => {
        const middle = { x: (item.start.x + item.end.x) / 2, y: (item.start.y + item.end.y) / 2 };
        return (
          <Group key={item.key} listening={false}>
            <Line points={[item.start.x, item.start.y, item.end.x, item.end.y]} stroke="#f59e0b" strokeWidth={1.5} strokeScaleEnabled={false} dash={[4, 3]} listening={false} />
            <Group x={middle.x} y={middle.y} rotation={-canvasRotationDeg} scaleX={inverseScale} scaleY={inverseScale} listening={false}>
              <Rect x={-27} y={-9} width={54} height={18} cornerRadius={9} fill="rgba(12,18,28,0.9)" stroke="#f59e0b" strokeWidth={1} listening={false} />
              <Text x={-27} y={-5} width={54} align="center" text={`${Math.round(item.gapM * 1000)} mm`} fill="#f8fafc" fontSize={10} listening={false} />
            </Group>
          </Group>
        );
      })}
    </Group>
  );
}
