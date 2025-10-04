// src/components_v2/canvas/PanelsKonva.tsx
'use client';

import React from 'react';
import { Group, Rect, Line } from 'react-konva';
import { usePlannerV2Store } from '../state/plannerV2Store';

import type { Pt } from './panels/math';
import { longestEdgeAngle, angleDiffDeg } from './panels/math';
import { usePanelDragSnap, buildGuidesCommon, snapUVToGuides, type PanelInst as HookPanel } from '../modules/panels/usePanelDragSnap';
import { PanelItem } from './panels/PanelItem';
import { Guides } from './panels/Guides';
import { RoofMarginBand } from './panels/RoofMarginBand';
import { isInReservedZone } from '../zones/utils';

const SNAP_STAGE_PX = 6;            // snap forza (px schermo)
const HANDLE_STAGE_PX = 24;         // lato handle (px schermo)
const HANDLE_GAP_STAGE_PX = 12;     // distanza sotto al gruppo (px schermo)

type PanelInst = HookPanel & { panelId: string };

export default function PanelsKonva(props: {
  roofId: string;
  roofPolygon: Pt[];
  textureUrl?: string;
  selectedPanelId?: string;               // legacy compat (fallback)
  onSelect?: (id?: string, opts?: { additive?: boolean }) => void;
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
  const allPanels = usePlannerV2Store((s) => s.panels) as PanelInst[];
  const updatePanel = usePlannerV2Store((s) => s.updatePanel);
  const panels = React.useMemo(
    () => allPanels.filter((p) => p.roofId === roofId),
    [allPanels, roofId]
  );

  // multiselezione
  const selectedIds = usePlannerV2Store((s) => s.selectedPanelIds || []);
  const selectedSet = React.useMemo(() => new Set(selectedIds), [selectedIds]);

  // scale corrente
  const stageScale = usePlannerV2Store((s) => s.view.scale || s.view.fitScale || 1);
  const invScale = 1 / (stageScale || 1);
  const snapPxImg = React.useMemo(() => SNAP_STAGE_PX * invScale, [stageScale]);

  // margine progetto → px immagine
  const marginM = usePlannerV2Store((s) => s.modules.marginM) ?? 0;
  const mpp = usePlannerV2Store((s) => s.snapshot.mppImage) ?? 1;
  const edgeMarginPx = React.useMemo(() => (mpp ? marginM / mpp : 0), [marginM, mpp]);
  const spacingM = usePlannerV2Store((s) => s.modules.spacingM) ?? 0;
  const gapPx = React.useMemo(() => (mpp ? spacingM / mpp : 0), [spacingM, mpp]);

  // texture pannello (opzionale)
  const [img, setImg] = React.useState<HTMLImageElement | null>(null);
  React.useEffect(() => {
    if (!textureUrl) { setImg(null); return; }
    const i = new Image();
    i.crossOrigin = 'anonymous';
    i.onload = () => setImg(i);
    i.src = textureUrl;
    return () => setImg(null);
  }, [textureUrl]);

  // clip falda
  const clipFunc = React.useCallback((ctx: any) => {
    if (!roofPolygon.length) return;
    ctx.beginPath();
    ctx.moveTo(roofPolygon[0].x, roofPolygon[0].y);
    for (let i = 1; i < roofPolygon.length; i++) ctx.lineTo(roofPolygon[i].x, roofPolygon[i].y);
    ctx.closePath();
  }, [roofPolygon]);

  // angolo falda => defaultAngleDeg
  const roofAzimuthDeg = usePlannerV2Store((s) => s.layers.find((l) => l.id === roofId)?.azimuthDeg);
  const polyAngleDeg = React.useMemo(() => (longestEdgeAngle(roofPolygon) * 180) / Math.PI, [roofPolygon]);
  const defaultAngleDeg = React.useMemo(() => {
    if (typeof roofAzimuthDeg === 'number') {
      const eavesCanvasDeg = -roofAzimuthDeg + 90;
      return angleDiffDeg(eavesCanvasDeg, polyAngleDeg) > 5 ? polyAngleDeg : eavesCanvasDeg;
    }
    return polyAngleDeg;
  }, [roofAzimuthDeg, polyAngleDeg]);

  // assi locali falda
  const theta = (defaultAngleDeg * Math.PI) / 180;
  const ex = { x: Math.cos(theta), y: Math.sin(theta) }; // u axis
  const ey = { x: -Math.sin(theta), y: Math.cos(theta) }; // v axis
  const project = (pt: Pt) => ({ u: pt.x * ex.x + pt.y * ex.y, v: pt.x * ey.x + pt.y * ey.y });
  const fromUV = (u: number, v: number): Pt => ({ x: u * ex.x + v * ey.x, y: u * ex.y + v * ey.y });

  // bounds UV falda
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

  // drag singolo (immutato)
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
    snapPxImg,
    edgeMarginPx,
    gapPx,
    reservedGuard: (cx, cy) => !isInReservedZone({ x: cx, y: cy }, roofId),
  });

  // selected panels (incl. compat singola)
  const useLegacySingle =
    (!selectedIds || selectedIds.length === 0) && typeof selectedPanelId === 'string';
  const selectedPanels = React.useMemo(() => {
    if (useLegacySingle) return panels.filter((p) => p.id === selectedPanelId);
    return panels.filter((p) => selectedSet.has(p.id));
  }, [panels, selectedSet, useLegacySingle, selectedPanelId]);

  // bbox gruppo (per handle)
  const groupBBox = React.useMemo(() => {
    if (selectedPanels.length < 2) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of selectedPanels) {
      const angle = typeof p.angleDeg === 'number' ? p.angleDeg : defaultAngleDeg;
      const t = (angle * Math.PI) / 180;
      const c = Math.cos(t), s = Math.sin(t);
      const hx = p.wPx / 2, hy = p.hPx / 2;
      const corners = [
        { x: -hx, y: -hy }, { x: +hx, y: -hy }, { x: +hx, y: +hy }, { x: -hx, y: +hy },
      ].map(q => ({ x: p.cx + q.x * c - q.y * s, y: p.cy + q.x * s + q.y * c }));
      for (const q of corners) {
        if (q.x < minX) minX = q.x;
        if (q.y < minY) minY = q.y;
        if (q.x > maxX) maxX = q.x;
        if (q.y > maxY) maxY = q.y;
      }
    }
    if (!isFinite(minX)) return null;
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }, [selectedPanels, defaultAngleDeg]);

  // helpers
  const isInsideBounds = React.useCallback((p: PanelInst, cx: number, cy: number) => {
    const m = edgeMarginPx;
    const uv = project({ x: cx, y: cy });
    if (uv.u < uvBounds.minU + m || uv.u > uvBounds.maxU - m) return false;
    if (uv.v < uvBounds.minV + m || uv.v > uvBounds.maxV - m) return false;
    if (isInReservedZone({ x: cx, y: cy }, roofId)) return false;
    return true;
  }, [edgeMarginPx, project, uvBounds, roofId]);

  const anyOverlapWithNonSelected = React.useCallback((cand: { id: string; cx: number; cy: number }[]) => {
    // controlla overlap rettangoli paralleli su U/V con gap
    const nonSel = panels.filter(p => !selectedSet.has(p.id));
    for (const c of cand) {
      const me = panels.find(p => p.id === c.id)!;
      const meUV = project({ x: c.cx, y: c.cy });
      const meHW = me.wPx / 2, meHH = me.hPx / 2;

      for (const t of nonSel) {
        const tAngle = (typeof t.angleDeg === 'number' ? t.angleDeg : defaultAngleDeg) || 0;
        // considera snap solo per pannelli paralleli (come nel singolo)
        if (Math.min(angleDiffDeg(tAngle, defaultAngleDeg), Math.abs(angleDiffDeg(tAngle, defaultAngleDeg) - 180)) > 5) continue;

        const tUV = project({ x: t.cx, y: t.cy });
        const thw = t.wPx / 2, thh = t.hPx / 2;

        const minU = meHW + thw + gapPx;
        const minV = meHH + thh + gapPx;

        const du = Math.abs(meUV.u - tUV.u);
        const dv = Math.abs(meUV.v - tUV.v);
        if (du < minU && dv < minV) return true; // overlap
      }
    }
    return false;
  }, [panels, selectedSet, project, defaultAngleDeg, gapPx]);

  // hint lines per il drag di gruppo
  const [groupHintU, setGroupHintU] = React.useState<number[] | null>(null);
  const [groupHintV, setGroupHintV] = React.useState<number[] | null>(null);

  // stato drag di gruppo
  const dragStateRef = React.useRef<{
    stage: any;
    startImg: Pt;
    inProgress: boolean;
    init: { id: string; cx: number; cy: number; u: number; v: number }[];
    anchorId: string;
    anchorInitUV: { u: number; v: number; hw: number; hh: number };
    guides: { uCenters: number[]; uEdges: number[]; vCenters: number[]; vEdges: number[] };
  } | null>(null);

  const beginGroupDrag = React.useCallback((e: any) => {
    if (!groupBBox || selectedPanels.length < 2 || !stageToImg) return;

    const stage = e.target.getStage?.();
    const pos = stage?.getPointerPosition?.();
    if (!stage || !pos) return;

    const startImg = stageToImg(pos.x, pos.y);

    // ancora = primo selezionato
    const anchor = selectedPanels[0];
    const anchorUV = project({ x: anchor.cx, y: anchor.cy });
    const anchorHW = anchor.wPx / 2;
    const anchorHH = anchor.hPx / 2;

    // guide: escludi tutto il gruppo
    const guides = buildGuidesCommon({
      allPanels,
      roofId,
      defaultAngleDeg,
      project,
      uvBounds,
      edgeMarginPx,
      excludeIds: new Set(selectedPanels.map(p => p.id)),
    });

    dragStateRef.current = {
      stage,
      startImg,
      inProgress: true,
      init: selectedPanels.map(p => {
        const uv = project({ x: p.cx, y: p.cy });
        return { id: p.id, cx: p.cx, cy: p.cy, u: uv.u, v: uv.v };
      }),
      anchorId: anchor.id,
      anchorInitUV: { u: anchorUV.u, v: anchorUV.v, hw: anchorHW, hh: anchorHH },
      guides,
    };

    const ns = '.groupDrag';
    setGroupHintU(null); setGroupHintV(null);

    const onMove = () => {
      const st = dragStateRef.current;
      if (!st || !st.inProgress) return;

      const pt = st.stage.getPointerPosition();
      if (!pt) return;
      const curImg = stageToImg(pt.x, pt.y);

      const dImgX = curImg.x - st.startImg.x;
      const dImgY = curImg.y - st.startImg.y;

      // candidato: sposto l'ANCORA di (dx,dy) in immagine → UV
      const anchorCandUV = project({
        x: st.init.find(i => i.id === st.anchorId)!.cx + dImgX,
        y: st.init.find(i => i.id === st.anchorId)!.cy + dImgY,
      });

      // snap identico al singolo (su ANCORA), con stesse hint lines
      const snapped = snapUVToGuides({
        curU: anchorCandUV.u,
        curV: anchorCandUV.v,
        hw: st.anchorInitUV.hw,
        hh: st.anchorInitUV.hh,
        guides: st.guides,
        snapPxImg,
        fromUV,
        uvBounds,
      });

      setGroupHintU(snapped.hintU);
      setGroupHintV(snapped.hintV);

      // ΔUV finale (dopo snap) rispetto all'UV iniziale dell'ancora
      const dU = snapped.bestU - st.anchorInitUV.u;
      const dV = snapped.bestV - st.anchorInitUV.v;

      // nuova posizione in IMG per ogni pannello selezionato (rigido)
      const proposed = st.init.map(i => {
        const pNew = fromUV(i.u + dU, i.v + dV);
        return { id: i.id, cx: pNew.x, cy: pNew.y };
      });

      // vincoli: bounds + reserved + overlap con non selezionati
      for (const q of proposed) {
        const pp = panels.find(x => x.id === q.id)!;
        if (!isInsideBounds(pp, q.cx, q.cy)) return; // blocca il movimento
      }
      if (anyOverlapWithNonSelected(proposed)) return;

      // applica
      for (const q of proposed) {
        updatePanel(q.id, { cx: q.cx, cy: q.cy });
      }
    };

    const onEnd = () => {
      const st = dragStateRef.current;
      if (!st) return;
      st.inProgress = false;
      st.stage.off('mousemove' + ns);
      st.stage.off('touchmove' + ns);
      st.stage.off('mouseup' + ns);
      st.stage.off('touchend' + ns);
      dragStateRef.current = null;
      setGroupHintU(null); setGroupHintV(null);
      onDragEnd?.();
    };

    stage.on('mousemove' + ns + ' touchmove' + ns, onMove);
    stage.on('mouseup' + ns + ' touchend' + ns, onEnd);
    onDragStart?.();
  }, [
    groupBBox, selectedPanels, stageToImg, allPanels, roofId,
    defaultAngleDeg, project, uvBounds, edgeMarginPx, snapPxImg,
    fromUV, panels, isInsideBounds, anyOverlapWithNonSelected,
    updatePanel, onDragStart, onDragEnd,
  ]);

  const handlePos = React.useMemo(() => {
    if (!groupBBox || selectedPanels.length < 2) return null;
    return {
      x: groupBBox.x + groupBBox.w / 2,
      y: groupBBox.y + groupBBox.h + HANDLE_GAP_STAGE_PX * invScale,
    };
  }, [groupBBox, invScale, selectedPanels.length]);

  // ======================= RENDER =======================
  return (
    <Group clipFunc={clipFunc} listening>
      <RoofMarginBand polygon={roofPolygon} marginPx={edgeMarginPx} />

      {panels.map((p) => {
        const sel = (selectedIds?.length ? selectedSet.has(p.id) : p.id === selectedPanelId);
        const rotationDeg = (typeof p.angleDeg === 'number') ? p.angleDeg : defaultAngleDeg;
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

      {/* guides snap: singolo + gruppo (stesso stile) */}
      <Guides hintU={hintU} hintV={hintV} />
      <Guides hintU={groupHintU} hintV={groupHintV} />

      {/* handle gruppo (visuale + mousedown) */}
      {handlePos && (
        <Group
          x={handlePos.x}
          y={handlePos.y}
          listening
          onMouseDown={beginGroupDrag}
          onTouchStart={beginGroupDrag}
        >
          <Rect
            x={-(HANDLE_STAGE_PX * invScale) / 2}
            y={-(HANDLE_STAGE_PX * invScale) / 2}
            width={HANDLE_STAGE_PX * invScale}
            height={HANDLE_STAGE_PX * invScale}
            cornerRadius={8 * invScale}
            fill="rgba(255,255,255,0.95)"
            stroke="rgba(0,0,0,0.08)"
            strokeWidth={1 * invScale}
            shadowColor="black"
            shadowBlur={12 * invScale}
            shadowOpacity={0.18}
            shadowOffsetY={2 * invScale}
          />
          <Line
            points={[ -(6 * invScale), 0, (6 * invScale), 0 ]}
            stroke="rgba(20,20,20,0.9)"
            strokeWidth={1.5 * invScale}
          />
          <Line
            points={[ 0, -(6 * invScale), 0, (6 * invScale) ]}
            stroke="rgba(20,20,20,0.9)"
            strokeWidth={1.5 * invScale}
          />
        </Group>
      )}
    </Group>
  );
}
