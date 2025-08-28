'use client';

import React from 'react';
import { Image as KonvaImage, Rect } from 'react-konva';

export type PanelItemProps = {
  id: string;
  cx: number;
  cy: number;
  wPx: number;
  hPx: number;
  rotationDeg: number;
  selected: boolean;
  image?: HTMLImageElement | null;
  onStartDrag: (panelId: string, e: any) => void;
  onSelect?: (id?: string) => void;
};

export const PanelItem: React.FC<PanelItemProps> = React.memo(
  ({ id, cx, cy, wPx, hPx, rotationDeg, selected, image, onStartDrag, onSelect }) => {
    const base = {
      x: cx,
      y: cy,
      width: wPx,
      height: hPx,
      offsetX: wPx / 2,
      offsetY: hPx / 2,
      rotation: rotationDeg,
      onMouseDown: (e: any) => onStartDrag(id, e),
      onTouchStart: (e: any) => onStartDrag(id, e),
      onClick: () => onSelect?.(id),
      onTap: () => onSelect?.(id),
    } as const;

    return (
      <>
        {image ? (
          <KonvaImage image={image} opacity={1} {...(base as any)} />
        ) : (
          <Rect fill="#0f172a" opacity={0.95} {...(base as any)} />
        )}

        {selected && (
          <Rect
            x={cx}
            y={cy}
            width={wPx}
            height={hPx}
            offsetX={wPx / 2}
            offsetY={hPx / 2}
            rotation={rotationDeg}
            stroke="#60a5fa"
            strokeWidth={0.5}
            listening={false}
          />
        )}
      </>
    );
  }
);
PanelItem.displayName = 'PanelItem';
