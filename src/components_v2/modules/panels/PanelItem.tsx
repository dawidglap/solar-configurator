// src/components_v2/canvas/panels/PanelItem.tsx
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
  onSelect?: (id?: string, opts?: { additive?: boolean }) => void;
};

const DRAG_THRESHOLD_PX = 3; // piccola soglia per distinguere click vs drag
const INTERACTIVE_NAME = 'interactive-panel';

export const PanelItem: React.FC<PanelItemProps> = React.memo(
  ({ id, cx, cy, wPx, hPx, rotationDeg, selected, image, onStartDrag, onSelect }) => {
    const downRef = React.useRef<{ x: number; y: number; active: boolean } | null>(null);
    const didDragRef = React.useRef(false);

    const onMouseDown = (e: any) => {
      const ev = e?.evt;
      if (!ev) return;
      downRef.current = { x: ev.clientX, y: ev.clientY, active: true };
      didDragRef.current = false;
    };

    const onMouseMove = (e: any) => {
      const ev = e?.evt;
      const d = downRef.current;
      if (!ev || !d || !d.active) return;
      const dx = ev.clientX - d.x;
      const dy = ev.clientY - d.y;
      if (dx * dx + dy * dy >= DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) {
        // supera la soglia → avvia drag controllato dal nostro hook
        didDragRef.current = true;
        d.active = false;
        onStartDrag(id, e);
      }
    };

    const onMouseUp = () => {
      // chiude la finestra "down"; il click (se non c'è stato drag) verrà inviato dopo da Konva
      if (downRef.current) downRef.current.active = false;
    };

    const onTouchStart = (e: any) => {
      const t = e?.evt?.touches?.[0];
      if (!t) return;
      downRef.current = { x: t.clientX, y: t.clientY, active: true };
      didDragRef.current = false;
    };

    const onTouchMove = (e: any) => {
      const t = e?.evt?.touches?.[0];
      const d = downRef.current;
      if (!t || !d || !d.active) return;
      const dx = t.clientX - d.x;
      const dy = t.clientY - d.y;
      if (dx * dx + dy * dy >= DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) {
        didDragRef.current = true;
        d.active = false;
        onStartDrag(id, e);
      }
    };

    const onTouchEnd = () => {
      if (downRef.current) downRef.current.active = false;
    };

    const base = {
      x: cx,
      y: cy,
      width: wPx,
      height: hPx,
      offsetX: wPx / 2,
      offsetY: hPx / 2,
      rotation: rotationDeg,

      // importante: contrassegna come interattivo per non far fare "clear" allo Stage
      name: INTERACTIVE_NAME,
      listening: true,

      // niente draggable Konva (drag gestito dal nostro hook)
      draggable: false,

      // gestione press/move per decidere se avviare drag
      onMouseDown,
      onMouseMove,
      onMouseUp,
      onTouchStart,
      onTouchMove,
      onTouchEnd,

      // Click desktop → selezione additiva con Shift/Ctrl/Cmd (se NON c'è stato drag)
      onClick: (e: any) => {
        if (didDragRef.current) {
          // abbiamo già fatto drag: sopprimiamo il click finale
          didDragRef.current = false;
          return;
        }
        const k = e?.evt;
        const additive = !!(k && (k.shiftKey || k.ctrlKey || k.metaKey));
        onSelect?.(id, { additive });
      },

      // Tap mobile → selezione singola
      onTap: () => {
        if (didDragRef.current) {
          didDragRef.current = false;
          return;
        }
        onSelect?.(id, { additive: false });
      },
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
