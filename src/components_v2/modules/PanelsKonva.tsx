// src/components_v2/canvas/PanelsKonva.tsx
'use client';

import React from 'react';
import { Group } from 'react-konva';
import { usePlannerV2Store } from '../state/plannerV2Store';

import type { Pt } from './panels/math';
import { longestEdgeAngle, angleDiffDeg } from './panels/math';
import { usePanelDragSnap } from './panels/usePanelDragSnap';
import { PanelItem } from './panels/PanelItem';
import { Guides } from './panels/Guides';
import { RoofMarginBand } from './panels/RoofMarginBand';
import { isInReservedZone } from '../zones/utils';

const SNAP_STAGE_PX = 6;

export default function PanelsKonva(props: {
  roofId: string;
  roofPolygon: Pt[];
  textureUrl?: string;
  selectedPanelId?: string; // compat singolo
  onSelect?: (id?: string, opts?: { additive?: boolean }) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  stageToImg?: (x: number, y: number) => Pt;
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

  // ─── Store ──────────────────────────────────────────────────
  const allPanels = usePlannerV2Store((s) => s.panels);
  const updatePanel = usePlannerV2Store((s) => s.updatePanel);

  // ⬇️ multiselezione + API batch
  const selectedIds = usePlannerV2Store((s) => s.selectedPanelIds);
  const selectedSet = React.useMemo(() => new Set(selectedIds), [selectedIds]);
  const updatePanelsBulk = usePlannerV2Store((s) => s.updatePanelsBulk);

  const panels = React.useMemo(
    () => allPanels.filter((p) => p.roofId === roofId),
    [allPanels, roofId]
  );

  // ─── Snap / scale ───────────────────────────────────────────
  const stageScale = usePlannerV2Store((s) => s.view.scale || s.view.fitScale || 1);
  const snapPxImg = React.useMemo(() => SNAP_STAGE_PX / (stageScale || 1), [stageScale]);

  const marginM = usePlannerV2Store((s) => s.modules.marginM) ?? 0;
  const mpp = usePlannerV2Store((s) => s.snapshot.mppImage) ?? 1;
  const edgeMarginPx = React.useMemo(() => (mpp ? marginM / mpp : 0), [marginM, mpp]);
  const spacingM = usePlannerV2Store((s) => s.modules.spacingM) ?? 0;
  const gapPx = React.useMemo(() => (mpp ? spacingM / mpp : 0), [spacingM, mpp]);

  // ─── Texture opzionale ──────────────────────────────────────
  const [img, setImg] = React.useState<HTMLImageElement | null>(null);
  React.useEffect(() => {
    if (!textureUrl) { setImg(null); return; }
    const i = new Image();
    i.crossOrigin = 'anonymous';
    i.onload = () => setImg(i);
    i.src = textureUrl;
    return () => setImg(null);
  }, [textureUrl]);

  // ─── Clip falda ─────────────────────────────────────────────
  const clipFunc = React.useCallback((ctx: any) => {
    if (!roofPolygon.length) return;
    ctx.beginPath();
    ctx.moveTo(roofPolygon[0].x, roofPolygon[0].y);
    for (let i = 1; i < roofPolygon.length; i++) ctx.lineTo(roofPolygon[i].x, roofPolygon[i].y);
    ctx.closePath();
  }, [roofPolygon]);

  // ─── Angolo default ─────────────────────────────────────────
  const roofAzimuthDeg = usePlannerV2Store((s) => s.layers.find((l) => l.id === roofId)?.azimuthDeg);
  const polyAngleDeg = React.useMemo(() => (longestEdgeAngle(roofPolygon) * 180) / Math.PI, [roofPolygon]);

  const defaultAngleDeg = React.useMemo(() => {
    if (typeof roofAzimuthDeg === 'number') {
      const eavesCanvasDeg = -roofAzimuthDeg + 90;
      return angleDiffDeg(eavesCanvasDeg, polyAngleDeg) > 5 ? polyAngleDeg : eavesCanvasDeg;
    }
    return polyAngleDeg;
  }, [roofAzimuthDeg, polyAngleDeg]);

  // ─── Assi locali u/v ────────────────────────────────────────
  const theta = (defaultAngleDeg * Math.PI) / 180;
  const ex = { x: Math.cos(theta), y: Math.sin(theta) };
  const ey = { x: -Math.sin(theta), y: Math.cos(theta) };
  const project = (pt: Pt) => ({ u: pt.x * ex.x + pt.y * ex.y, v: pt.x * ey.x + pt.y * ey.y });
  const fromUV = (u: number, v: number): Pt => ({ x: u * ex.x + v * ey.x, y: u * ex.y + v * ey.y });

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
  }, [roofPolygon, theta]);

  // ─── Drag SINGLE con snap (quello esistente) ────────────────
  const { startDrag: startDragSingle, hintU, hintV } = usePanelDragSnap({
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
    snapPxImg,
    edgeMarginPx,
    gapPx,
    reservedGuard: (cx: number, cy: number) => !isInReservedZone({ x: cx, y: cy }, roofId),
  });

  // ─── Drag di GRUPPO con snap + guide ────────────────────────
  const [groupHintU, setGroupHintU] = React.useState<number | undefined>(undefined);
  const [groupHintV, setGroupHintV] = React.useState<number | undefined>(undefined);

  // helper: point-in-polygon (ray casting)
  function pointInPolygon(pt: { x: number; y: number }, poly: Pt[]) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x, yi = poly[i].y;
      const xj = poly[j].x, yj = poly[j].y;
      const intersect =
        yi > pt.y !== yj > pt.y &&
        pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi + 1e-12) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  // anti-overlap semplice: confronto su “dischi” (radius ≈ min(w,h)/2 + gap)
  const wouldOverlap = (cx: number, cy: number, movedId: string) => {
    const moved = panels.find(p => p.id === movedId);
    if (!moved) return false;
    const rMoved = Math.min(moved.wPx, moved.hPx) * 0.5 + gapPx * 0.5;

    for (const other of panels) {
      if (other.id === movedId) continue;
      if (selectedSet.has(other.id)) continue; // i selezionati mantengono distanze relative
      const rOther = Math.min(other.wPx, other.hPx) * 0.5 + gapPx * 0.5;
      const dx = cx - other.cx;
      const dy = cy - other.cy;
      if (dx * dx + dy * dy < (rMoved + rOther) * (rMoved + rOther)) {
        return true;
      }
    }
    return false;
  };

  const startDragGroup = React.useCallback((panelId: string, e: any) => {
    if (!stageToImg) return;
    const st = e?.target?.getStage?.();
    if (!st) return;
    const ns = '.group-panels';
    st.off(ns);

    // snapshot posizioni iniziali (solo selezionati su questa falda)
    const startPos = new Map<string, { cx: number; cy: number; w: number; h: number }>();
    let refU: number | null = null;
    let refV: number | null = null;
    let pitchU = 0;
    let pitchV = 0;

    for (const p of panels) {
      if (!selectedSet.has(p.id)) continue;
      startPos.set(p.id, { cx: p.cx, cy: p.cy, w: p.wPx, h: p.hPx });

      // riferimento per snap/guide: usa il primo selezionato
      if (refU == null || refV == null) {
        const uv0 = project({ x: p.cx, y: p.cy }); // ← FIX: usa {x,y}, non {cx,cy}
        refU = uv0.u;
        refV = uv0.v;
        // passo “light”: modulo + gap
        pitchU = Math.max(1, p.wPx + gapPx);
        pitchV = Math.max(1, p.hPx + gapPx);
      }
    }
    if (startPos.size === 0) return;

    const pos0 = st.getPointerPosition();
    if (!pos0) return;
    const p0 = stageToImg(pos0.x, pos0.y);

    onDragStart?.();
    setGroupHintU(undefined);
    setGroupHintV(undefined);

    st.on('mousemove' + ns + ' touchmove' + ns, () => {
      const cur = st.getPointerPosition();
      if (!cur) return;
      const p1 = stageToImg(cur.x, cur.y);

      // delta base in immagine
      let dx = p1.x - p0.x;
      let dy = p1.y - p0.y;

      // reset guide
      let nextHintU: number | undefined = undefined;
      let nextHintV: number | undefined = undefined;

      // snap del delta in u/v + (possibili) guide
      if (pitchU > 0 || pitchV > 0) {
        const du = dx * ex.x + dy * ex.y;
        const dv = dx * ey.x + dy * ey.y;

        let duSnap = du;
        let dvSnap = dv;

        if (pitchU > 0) {
          const q = Math.round(du / pitchU) * pitchU;
          if (Math.abs(du - q) <= snapPxImg) {
            duSnap = q;
            if (refU != null) nextHintU = refU + duSnap;
          }
        }
        if (pitchV > 0) {
          const q = Math.round(dv / pitchV) * pitchV;
          if (Math.abs(dv - q) <= snapPxImg) {
            dvSnap = q;
            if (refV != null) nextHintV = refV + dvSnap;
          }
        }

        dx = duSnap * ex.x + dvSnap * ey.x;
        dy = duSnap * ex.y + dvSnap * ey.y;
      }

      // VINCOLI: tutti i nuovi centri dentro falda + fuori reserved + NO OVERLAP
      for (const [id, s] of startPos) {
        const nx = s.cx + dx;
        const ny = s.cy + dy;
        if (!pointInPolygon({ x: nx, y: ny }, roofPolygon)) return;
        if (isInReservedZone({ x: nx, y: ny }, roofId)) return;
        if (wouldOverlap(nx, ny, id)) return;
      }

      // applica frame (come nel tuo single, ma a tutti)
      setGroupHintU(nextHintU);
      setGroupHintV(nextHintV);

      updatePanelsBulk((p) => {
        if (!selectedSet.has(p.id)) return;
        const s = startPos.get(p.id);
        if (!s) return;
        return { cx: s.cx + dx, cy: s.cy + dy };
      });
    });

    const end = () => {
      st.off(ns);
      setGroupHintU(undefined);
      setGroupHintV(undefined);
      onDragEnd?.();
    };
    st.on('mouseup' + ns + ' touchend' + ns + ' pointerup' + ns + ' mouseleave' + ns, end);
  }, [
    panels,
    selectedSet,
    stageToImg,
    onDragStart,
    onDragEnd,
    updatePanelsBulk,
    roofPolygon,
    roofId,
    gapPx,
    ex.x, ex.y, ey.x, ey.y,
    snapPxImg,
  ]);

  // Router unico: se multi-selezione attiva e include il pannello, usa drag di gruppo
  const onStartDragUnified = React.useCallback((panelId: string, e: any) => {
    if (selectedSet.size > 1 && selectedSet.has(panelId)) {
      startDragGroup(panelId, e);
    } else {
      startDragSingle(panelId, e);
    }
  }, [selectedSet, startDragGroup, startDragSingle]);

  return (
    <Group clipFunc={clipFunc} listening>
      <RoofMarginBand polygon={roofPolygon} marginPx={edgeMarginPx} />

      {panels.map((p) => {
        const hasAngle = typeof p.angleDeg === 'number' && Math.abs(p.angleDeg) > 1e-6;
        const rotationDeg = hasAngle ? (p.angleDeg as number) : defaultAngleDeg;

        const isSelected = selectedSet.has(p.id) || p.id === selectedPanelId; // compat singolo

        return (
          <PanelItem
            key={p.id}
            id={p.id}
            cx={p.cx}
            cy={p.cy}
            wPx={p.wPx}
            hPx={p.hPx}
            rotationDeg={rotationDeg}
            selected={isSelected}
            image={img}
            onStartDrag={onStartDragUnified}   // ← switch single/group
            onSelect={onSelect}
          />
        );
      })}

      {/* guide: gruppo se presenti, altrimenti singolo */}
      <Guides hintU={groupHintU ?? hintU} hintV={groupHintV ?? hintV} />
    </Group>
  );
}
