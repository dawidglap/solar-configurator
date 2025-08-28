'use client';

import type { Pt } from './panels/math';
import { longestEdgeAngle, angleDiffDeg } from './panels/math';
import { usePanelDragSnap } from './panels/usePanelDragSnap';



import React from 'react';
import { Group, Image as KonvaImage, Rect, Line as KonvaLine } from 'react-konva';
import { usePlannerV2Store } from '../state/plannerV2Store';



// ---------- costanti snap (pixel SCHERMO) ----------
const SNAP_STAGE_PX = 6; // quanto “tira” lo snap sullo schermo (modifica qui)

// ---------- helpers ----------


export default function PanelsKonva(props: {
  roofId: string;
  roofPolygon: Pt[];
  textureUrl?: string;
  selectedPanelId?: string;
  onSelect?: (id?: string) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  stageToImg?: (x: number, y: number) => Pt; // Stage → Img
}) {
  const {
    roofId, roofPolygon, textureUrl,
    selectedPanelId, onSelect, onDragStart, onDragEnd,
    stageToImg
  } = props;

  // 1) store
  const allPanels   = usePlannerV2Store((s) => s.panels);
  const updatePanel = usePlannerV2Store((s) => s.updatePanel);
  const panels = React.useMemo(
    () => allPanels.filter(p => p.roofId === roofId),
    [allPanels, roofId]
  );

  // scale attuale (per convertire 10px schermo → px immagine)
  const stageScale = usePlannerV2Store(s => (s.view.scale || s.view.fitScale || 1));
  const snapPxImg = React.useMemo(() => SNAP_STAGE_PX / (stageScale || 1), [stageScale]);

  // 2) texture
  const [img, setImg] = React.useState<HTMLImageElement | null>(null);
  React.useEffect(() => {
    if (!textureUrl) { setImg(null); return; }
    const i = new Image();
    i.crossOrigin = 'anonymous';
    i.onload = () => setImg(i);
    i.src = textureUrl;
    return () => setImg(null);
  }, [textureUrl]);

  // 3) clip memoizzato
  const clipFunc = React.useCallback((ctx: any) => {
    if (!roofPolygon.length) return;
    ctx.beginPath();
    ctx.moveTo(roofPolygon[0].x, roofPolygon[0].y);
    for (let i = 1; i < roofPolygon.length; i++) ctx.lineTo(roofPolygon[i].x, roofPolygon[i].y);
    ctx.closePath();
  }, [roofPolygon]);

  // 4) angolo falda: pannelli PARALLELI alla gronda ⇒ -azimuth + 90
  const roofAzimuthDeg = usePlannerV2Store(
    (s) => s.layers.find((l) => l.id === roofId)?.azimuthDeg
  );
  const polyAngleDeg = React.useMemo(
    () => (longestEdgeAngle(roofPolygon) * 180) / Math.PI,
    [roofPolygon]
  );
  const defaultAngleDeg = React.useMemo(() => {
    if (typeof roofAzimuthDeg === 'number') {
      const eavesCanvasDeg = -roofAzimuthDeg + 90;
      return angleDiffDeg(eavesCanvasDeg, polyAngleDeg) > 5 ? polyAngleDeg : eavesCanvasDeg;
    }
    return polyAngleDeg;
  }, [roofAzimuthDeg, polyAngleDeg]);

  // 5) assi locali della falda (u // gronda, v ⟂)
  const theta = (defaultAngleDeg * Math.PI) / 180;
  const ex = { x: Math.cos(theta),  y: Math.sin(theta)  }; // u axis
  const ey = { x: -Math.sin(theta), y: Math.cos(theta)  }; // v axis
  const project = (pt: Pt) => ({ u: pt.x * ex.x + pt.y * ex.y, v: pt.x * ey.x + pt.y * ey.y });
  const fromUV  = (u: number, v: number): Pt => ({ x: u * ex.x + v * ey.x, y: u * ex.y + v * ey.y });

  // bounds UV della falda (per disegnare linee guida lungo tutta la larghezza/altezza)
  const uvBounds = React.useMemo(() => {
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const p of roofPolygon) {
      const uv = project(p);
      if (uv.u < minU) minU = uv.u;
      if (uv.u > maxU) maxU = uv.u;
      if (uv.v < minV) minV = uv.v;
      if (uv.v > maxV) maxV = uv.v;
    }
    return { minU, maxU, minV, maxV };
  }, [roofPolygon, theta]); // dipende dall’orientamento falda

  // Hook: drag + snap + hint lines
const { startDrag, hintU, hintV } = usePanelDragSnap({
  defaultAngleDeg,
  project,
  fromUV,
  uvBounds,
  allPanels,
  roofId,
  stageToImg,
  updatePanel,
  onSelect,
  onDragStart,
  onDragEnd,
  snapPxImg, // soglia già convertita in px immagine
});




  return (
    <Group clipFunc={clipFunc} listening>
      {panels.map((p) => {
        const sel = p.id === selectedPanelId;

        // se l'istanza ha un angolo valido, lo uso; altrimenti angolo falda
        const hasAngle = typeof p.angleDeg === 'number' && Math.abs(p.angleDeg) > 1e-6;
        const rotationDeg = hasAngle ? (p.angleDeg as number) : defaultAngleDeg;

        const base = {
          key: p.id,
          x: p.cx,
          y: p.cy,
          width: p.wPx,
          height: p.hPx,
          offsetX: p.wPx / 2,
          offsetY: p.hPx / 2,
          rotation: rotationDeg,
          onMouseDown: (e: any) => startDrag(p.id, e),
          onTouchStart: (e: any) => startDrag(p.id, e),
          onClick: () => onSelect?.(p.id),
          onTap: () => onSelect?.(p.id),
        } as const;

        return (
          <React.Fragment key={p.id}>
            {img ? (
              <KonvaImage image={img} opacity={1} {...(base as any)} />
            ) : (
              <Rect fill="#0f172a" opacity={0.95} {...(base as any)} />
            )}

            {sel && (
              <Rect
                x={p.cx}
                y={p.cy}
                width={p.wPx}
                height={p.hPx}
                offsetX={p.wPx / 2}
                offsetY={p.hPx / 2}
                rotation={rotationDeg}
                stroke="#60a5fa"
                strokeWidth={0.5}
                // dash={[2, 2]}
                listening={false}
              />
            )}
          </React.Fragment>
        );
      })}

      {/* linee guida snap (sopra ai pannelli) */}
      {hintU && (
        <KonvaLine
          points={hintU}
          stroke="#D3DAD9"
          dash={[1, 1]}
          strokeWidth={0.3}
          opacity={0.6}
          listening={false}
        />
      )}
      {hintV && (
        <KonvaLine
          points={hintV}
          stroke="#D3DAD9"
          dash={[1, 1]}
          strokeWidth={0.53}
          opacity={0.6}
          listening={false}
        />
      )}
    </Group>
  );
}
