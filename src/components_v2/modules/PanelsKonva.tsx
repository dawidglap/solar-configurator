'use client';

import React from 'react';
import { Group } from 'react-konva';
import { usePlannerV2Store } from '../state/plannerV2Store';

import type { Pt } from './panels/math';
import { longestEdgeAngle, angleDiffDeg } from './panels/math';
import { usePanelDragSnap } from './panels/usePanelDragSnap';
import { PanelItem } from './panels/PanelItem';
import { Guides } from './panels/Guides';

// ---------- costanti snap (pixel SCHERMO) ----------
const SNAP_STAGE_PX = 6; // quanto “tira” lo snap sullo schermo (modifica qui)

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
    roofId,
    roofPolygon,
    textureUrl,
    selectedPanelId,
    onSelect,
    onDragStart,
    onDragEnd,
    stageToImg,
  } = props;

  // --- store
  const allPanels = usePlannerV2Store((s) => s.panels);
  const updatePanel = usePlannerV2Store((s) => s.updatePanel);
  const panels = React.useMemo(() => allPanels.filter((p) => p.roofId === roofId), [allPanels, roofId]);

  // --- scale corrente (per convertire px schermo → px immagine per lo snap)
  const stageScale = usePlannerV2Store((s) => s.view.scale || s.view.fitScale || 1);
  const snapPxImg = React.useMemo(() => SNAP_STAGE_PX / (stageScale || 1), [stageScale]);

  // --- texture pannello (opzionale)
  const [img, setImg] = React.useState<HTMLImageElement | null>(null);
  React.useEffect(() => {
    if (!textureUrl) {
      setImg(null);
      return;
    }
    const i = new Image();
    i.crossOrigin = 'anonymous';
    i.onload = () => setImg(i);
    i.src = textureUrl;
    return () => setImg(null);
  }, [textureUrl]);

  // --- clip della falda
  const clipFunc = React.useCallback(
    (ctx: any) => {
      if (!roofPolygon.length) return;
      ctx.beginPath();
      ctx.moveTo(roofPolygon[0].x, roofPolygon[0].y);
      for (let i = 1; i < roofPolygon.length; i++) ctx.lineTo(roofPolygon[i].x, roofPolygon[i].y);
      ctx.closePath();
    },
    [roofPolygon]
  );

  // --- angolo falda: pannelli PARALLELI alla gronda ⇒ -azimuth + 90
  const roofAzimuthDeg = usePlannerV2Store((s) => s.layers.find((l) => l.id === roofId)?.azimuthDeg);
  const polyAngleDeg = React.useMemo(() => (longestEdgeAngle(roofPolygon) * 180) / Math.PI, [roofPolygon]);

  const defaultAngleDeg = React.useMemo(() => {
    if (typeof roofAzimuthDeg === 'number') {
      const eavesCanvasDeg = -roofAzimuthDeg + 90;
      return angleDiffDeg(eavesCanvasDeg, polyAngleDeg) > 5 ? polyAngleDeg : eavesCanvasDeg;
    }
    return polyAngleDeg;
  }, [roofAzimuthDeg, polyAngleDeg]);

  // --- assi locali falda (u // gronda, v ⟂)
  const theta = (defaultAngleDeg * Math.PI) / 180;
  const ex = { x: Math.cos(theta), y: Math.sin(theta) }; // u axis
  const ey = { x: -Math.sin(theta), y: Math.cos(theta) }; // v axis
  const project = (pt: Pt) => ({ u: pt.x * ex.x + pt.y * ex.y, v: pt.x * ey.x + pt.y * ey.y });
  const fromUV = (u: number, v: number): Pt => ({ x: u * ex.x + v * ey.x, y: u * ex.y + v * ey.y });

  // --- bounds UV della falda (per linee guida)
  const uvBounds = React.useMemo(() => {
    let minU = Infinity,
      maxU = -Infinity,
      minV = Infinity,
      maxV = -Infinity;
    for (const p of roofPolygon) {
      const uv = project(p);
      if (uv.u < minU) minU = uv.u;
      if (uv.u > maxU) maxU = uv.u;
      if (uv.v < minV) minV = uv.v;
      if (uv.v > maxV) maxV = uv.v;
    }
    return { minU, maxU, minV, maxV };
  }, [roofPolygon, theta]);

  // --- hook: drag + snap + hint lines
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
    snapPxImg, // soglia in px immagine
  });

  return (
    <Group clipFunc={clipFunc} listening>
      {panels.map((p) => {
        const sel = p.id === selectedPanelId;
        const hasAngle = typeof p.angleDeg === 'number' && Math.abs(p.angleDeg) > 1e-6;
        const rotationDeg = hasAngle ? (p.angleDeg as number) : defaultAngleDeg;

        return (
          <PanelItem
            key={p.id}
            id={p.id}
            cx={p.cx}
            cy={p.cy}
            wPx={p.wPx}
            hPx={p.hPx}
            rotationDeg={rotationDeg}
            selected={sel}
            image={img}
            onStartDrag={startDrag}
            onSelect={onSelect}
          />
        );
      })}

      {/* linee guida snap */}
      <Guides hintU={hintU} hintV={hintV} />
    </Group>
  );
}
