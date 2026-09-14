"use client";

import { useSyncExternalStore } from "react";
import { Group, Line } from "react-konva";

import ModuleSprite from "../ModuleSprite";
import { plannerTheme } from "../../theme/plannerTheme";
import type { TransientFillDraftChannel } from "./transientFillDraft";

export default function FillAreaPreviewLayer({ channel }: { channel: TransientFillDraftChannel }) {
  const draft = useSyncExternalStore(
    channel.subscribe,
    channel.getSnapshot,
    channel.getServerSnapshot,
  );
  if (!draft) return null;

  return (
    <Group listening={false}>
      {draft.poly.length >= 3 && (
        <Line
          points={draft.poly.flatMap((point) => [point.x, point.y])}
          closed
          stroke={plannerTheme.guideLine}
          strokeWidth={0.8}
          dash={[6, 4]}
          opacity={0.6}
          listening={false}
          perfectDrawEnabled={false}
        />
      )}
      <Group opacity={0.5} listening={false}>
        {draft.rects.map((rect, index) => (
          <ModuleSprite
            key={index}
            x={rect.cx}
            y={rect.cy}
            w={rect.wPx}
            h={rect.hPx}
            rotationDeg={rect.angleDeg}
            textureUrl="/images/panel.webp"
          />
        ))}
      </Group>
    </Group>
  );
}
