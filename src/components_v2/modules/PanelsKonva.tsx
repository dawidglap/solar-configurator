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
import { legacyPointInPolygon } from '@/lib/planning-core/legacy-standard/collision';
import { plannerTheme } from '../theme/plannerTheme';
import { createLatestFrameScheduler, type FrameScheduler } from '../canvas/performance/latestFrameScheduler';

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
  const hasPlanningDraft = usePlannerV2Store((s) => Boolean(s.roofPlanningDrafts[roofId]));
  const rawUpdatePanel = usePlannerV2Store((s) => s.updatePanel);
  const updatePanelsBulk = usePlannerV2Store((s) => s.updatePanelsBulk);
  const allZones = usePlannerV2Store((s) => s.zones);
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
  const snapPxImg = React.useMemo(() => SNAP_STAGE_PX * invScale, [invScale]);

  // margine progetto → px immagine
  const marginM = usePlannerV2Store((s) => s.modules.marginM) ?? 0;
  const mpp = usePlannerV2Store((s) => s.snapshot.mppImage) ?? 1;
  const edgeMarginPx = React.useMemo(() => (mpp ? marginM / mpp : 0), [marginM, mpp]);
  const spacingM = usePlannerV2Store((s) => s.modules.spacingM) ?? 0;
  const spacingXM = usePlannerV2Store((s) => s.modules.spacingXM) ?? spacingM;
  const spacingYM = usePlannerV2Store((s) => s.modules.spacingYM) ?? spacingM;
  const gapPx = React.useMemo(() => (mpp ? spacingM / mpp : 0), [spacingM, mpp]);
  const gapXPx = React.useMemo(() => (mpp ? spacingXM / mpp : 0), [spacingXM, mpp]);
  const gapYPx = React.useMemo(() => (mpp ? spacingYM / mpp : 0), [spacingYM, mpp]);
  const reservedPolygons = React.useMemo(
    () => allZones
      .filter((zone) => zone.roofId === roofId && zone.type === 'riservata')
      .map((zone) => zone.points),
    [allZones, roofId],
  );
  const isReservedCenter = React.useCallback(
    (cx: number, cy: number) => reservedPolygons.some((polygon) =>
      legacyPointInPolygon({ x: cx, y: cy }, polygon),
    ),
    [reservedPolygons],
  );

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
  const project = React.useCallback(
    (pt: Pt) => ({ u: pt.x * ex.x + pt.y * ex.y, v: pt.x * ey.x + pt.y * ey.y }),
    [ex.x, ex.y, ey.x, ey.y],
  );
  const fromUV = React.useCallback(
    (u: number, v: number): Pt => ({ x: u * ex.x + v * ey.x, y: u * ex.y + v * ey.y }),
    [ex.x, ex.y, ey.x, ey.y],
  );

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
  }, [roofPolygon, project]);

  const normalizePanelCandidate = React.useCallback(
    (id: string, proposedCx: number, proposedCy: number): Pt | null => {
      const panel = allPanels.find((p) => p.id === id);
      if (!panel) return null;

      let nextCx = proposedCx;
      let nextCy = proposedCy;

      if (typeof nextCx === 'number' && typeof nextCy === 'number') {
        const uv = project({ x: nextCx, y: nextCy });

        const hw = panel.wPx / 2;
        const hh = panel.hPx / 2;
        const m = edgeMarginPx;

        // limiti in UV considerando:
        // - bordo falda
        // - randabstand (m)
        // - metà dimensione pannello
        let u = uv.u;
        let v = uv.v;

        const minU = uvBounds.minU + m + hw;
        const maxU = uvBounds.maxU - m - hw;
        const minV = uvBounds.minV + m + hh;
        const maxV = uvBounds.maxV - m - hh;

        if (u < minU) u = minU;
        if (u > maxU) u = maxU;
        if (v < minV) v = minV;
        if (v > maxV) v = maxV;

        const corrected = fromUV(u, v);
        nextCx = corrected.x;
        nextCy = corrected.y;

        // se dopo la correzione il centro cade in una zona riservata → non aggiornare
        if (isReservedCenter(nextCx, nextCy)) return null;
      }

      return { x: nextCx, y: nextCy };
    },
    [allPanels, project, fromUV, uvBounds, edgeMarginPx, isReservedCenter]
  );

  const updatePanel = React.useCallback(
    (id: string, patch: Partial<PanelInst>) => {
      const panel = allPanels.find((p) => p.id === id);
      if (!panel) {
        rawUpdatePanel(id, patch as any);
        return;
      }

      const normalized = normalizePanelCandidate(
        id,
        patch.cx ?? panel.cx,
        patch.cy ?? panel.cy,
      );
      if (!normalized) return;

      rawUpdatePanel(id, { ...patch, cx: normalized.x, cy: normalized.y } as any);
    },
    [allPanels, rawUpdatePanel, normalizePanelCandidate]
  );



  // drag singolo (immutato)
  const { startDrag, hintURef, hintVRef } = usePanelDragSnap({
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
    gapXPx,
    gapYPx,
    reservedGuard: (cx, cy) => !isReservedCenter(cx, cy),
    normalizeCandidate: normalizePanelCandidate,
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
  const isInsideBounds = React.useCallback(
    (p: PanelInst, cx: number, cy: number) => {
      const uv = project({ x: cx, y: cy });
      const hw = p.wPx / 2;
      const hh = p.hPx / 2;
      const m = edgeMarginPx;

      const minU = uvBounds.minU + m + hw;
      const maxU = uvBounds.maxU - m - hw;
      const minV = uvBounds.minV + m + hh;
      const maxV = uvBounds.maxV - m - hh;

      if (uv.u < minU || uv.u > maxU) return false;
      if (uv.v < minV || uv.v > maxV) return false;
      if (isInReservedZone({ x: cx, y: cy }, roofId)) return false;
      return true;
    },
    [edgeMarginPx, project, uvBounds, roofId]
  );


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

        const minU = meHW + thw + gapXPx;
        const minV = meHH + thh + gapYPx;

        const du = Math.abs(meUV.u - tUV.u);
        const dv = Math.abs(meUV.v - tUV.v);
        if (du < minU && dv < minV) return true; // overlap
      }
    }
    return false;
  }, [panels, selectedSet, project, defaultAngleDeg, gapXPx, gapYPx]);

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
    nodes: Map<string, any>;
    selectionNodes: Map<string, any>;
    final: { id: string; cx: number; cy: number }[] | null;
    frame: FrameScheduler<Pt>;
  } | null>(null);

  const cancelGroupDrag = React.useCallback(() => {
    const state = dragStateRef.current;
    if (!state) return false;
    state.stage.off('.groupDrag');
    state.frame.cancel();
    state.init.forEach((initial) => {
      state.nodes.get(initial.id)?.position({ x: initial.cx, y: initial.cy });
      state.selectionNodes.get(initial.id)?.position({ x: initial.cx, y: initial.cy });
    });
    state.nodes.values().next().value?.getLayer?.()?.batchDraw?.();
    dragStateRef.current = null;
    setGroupHintU(null);
    setGroupHintV(null);
    onDragEnd?.();
    return true;
  }, [onDragEnd]);

  React.useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !cancelGroupDrag()) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };
    window.addEventListener('keydown', onEscape, { capture: true });
    return () => {
      window.removeEventListener('keydown', onEscape, { capture: true });
      cancelGroupDrag();
    };
  }, [cancelGroupDrag]);

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

    const nodes = new Map<string, any>();
    const selectionNodes = new Map<string, any>();
    selectedPanels.forEach((panel) => {
      const node = stage.findOne(`#panel-node-${panel.id}`);
      if (node) nodes.set(panel.id, node);
      const selectionNode = stage.findOne(`#panel-selection-${panel.id}`);
      if (selectionNode) selectionNodes.set(panel.id, selectionNode);
    });

    const onFrame = (curImg: Pt) => {
      const st = dragStateRef.current;
      if (!st || !st.inProgress) return;

      const dImgX = curImg.x - st.startImg.x;
      const dImgY = curImg.y - st.startImg.y;

      const anchorInit = st.init.find(i => i.id === st.anchorId)!;
      const anchorCandUV = project({
        x: anchorInit.cx + dImgX,
        y: anchorInit.cy + dImgY,
      });

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

      const dU = snapped.bestU - st.anchorInitUV.u;
      const dV = snapped.bestV - st.anchorInitUV.v;
      const proposed = st.init.map(i => {
        const pNew = fromUV(i.u + dU, i.v + dV);
        return { id: i.id, cx: pNew.x, cy: pNew.y };
      });

      for (const q of proposed) {
        const pp = panels.find(x => x.id === q.id)!;
        if (!isInsideBounds(pp, q.cx, q.cy)) return;
      }
      if (anyOverlapWithNonSelected(proposed)) return;

      st.final = proposed;
      proposed.forEach((position) => {
        st.nodes.get(position.id)?.position({ x: position.cx, y: position.cy });
        st.selectionNodes.get(position.id)?.position({ x: position.cx, y: position.cy });
      });
      st.nodes.values().next().value?.getLayer?.()?.batchDraw?.();
    };

    const frame = createLatestFrameScheduler(onFrame);
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
      nodes,
      selectionNodes,
      final: null,
      frame,
    };

    const ns = '.groupDrag';
    setGroupHintU(null); setGroupHintV(null);

    const onMove = () => {
      const st = dragStateRef.current;
      if (!st || !st.inProgress) return;

      const pt = st.stage.getPointerPosition();
      if (!pt) return;
      st.frame.schedule(stageToImg(pt.x, pt.y));
    };

    const onEnd = () => {
      const st = dragStateRef.current;
      if (!st) return;
      st.frame.flush();
      st.inProgress = false;
      st.stage.off('mousemove' + ns);
      st.stage.off('touchmove' + ns);
      st.stage.off('mouseup' + ns);
      st.stage.off('touchend' + ns);
      if (st.final) {
        const patches = Object.fromEntries(
          st.final.map((position) => [position.id, { cx: position.cx, cy: position.cy }]),
        );
        updatePanelsBulk(patches);
      }
      st.frame.cancel();
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
    updatePanelsBulk, onDragStart, onDragEnd,
  ]);

  

const startMultiDrag = React.useCallback((e: any) => {
  if (!groupBBox || selectedPanels.length < 2) return;
  e.cancelBubble = true;      // blocca il pan dello Stage
  beginGroupDrag(e);          // riusa la logica già pronta
}, [groupBBox, selectedPanels.length, beginGroupDrag]);


  // ======================= RENDER =======================
 if (hasPlanningDraft) return null;

 return (
  <>
    {/* --- CLIPPED: pannelli + guide + banda margine --- */}
    <Group
      clipFunc={clipFunc}
      listening
      onMouseDown={(e) => { e.cancelBubble = true; }}
      onTouchStart={(e) => { e.cancelBubble = true; }}
    >
      <RoofMarginBand polygon={roofPolygon} marginPx={edgeMarginPx} />

      {panels.map((p) => {
        const sel =
          (selectedIds && selectedIds.length > 0 && selectedIds.includes(p.id)) ||
          (!selectedIds?.length && p.id === selectedPanelId);

        const rotationDeg =
          typeof p.angleDeg === 'number' ? p.angleDeg : defaultAngleDeg;

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

      {groupHintU || groupHintV ? (
        <Guides hintU={groupHintU} hintV={groupHintV} />
      ) : (
        <Guides hintURef={hintURef} hintVRef={hintVRef} />
      )}

    </Group>

    {/* --- UNCLIPPED OVERLAY: handle multiselect sempre visibile --- */}
    {groupBBox && (
      <Group
        x={groupBBox.x + groupBBox.w / 2}
        y={groupBBox.y + groupBBox.h + HANDLE_GAP_STAGE_PX * invScale}
         listening={true}                 // ← era false
    onMouseDown={startMultiDrag}     // ← AGGIUNTO
    onTouchStart={startMultiDrag}   // se hai la versione “draggable”, sposta qui gli handlers
      >
        <Rect
          x={-(HANDLE_STAGE_PX * invScale) / 2}
          y={-(HANDLE_STAGE_PX * invScale) / 2}
          width={HANDLE_STAGE_PX * invScale}
          height={HANDLE_STAGE_PX * invScale}
          cornerRadius={8 * invScale}
          fill={plannerTheme.textLight}
          stroke={plannerTheme.panelStroke}
          strokeWidth={1 * invScale}
          shadowColor={plannerTheme.primaryGlow}
          shadowBlur={12 * invScale}
          shadowOpacity={0.18}
          shadowOffsetY={2 * invScale}
        />
        <Line
          points={[ -(6 * invScale), 0, (6 * invScale), 0 ]}
          stroke={plannerTheme.panelFill}
          strokeWidth={1.5 * invScale}
          listening={false}
        />
        <Line
          points={[ 0, -(6 * invScale), 0, (6 * invScale) ]}
          stroke={plannerTheme.panelFill}
          strokeWidth={1.5 * invScale}
          listening={false}
        />
      </Group>
    )}
  </>
);

}
