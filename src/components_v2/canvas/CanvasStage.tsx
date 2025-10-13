'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Stage, Layer, Image as KonvaImage, Line, Rect } from 'react-konva';
import { computeAutoLayoutRects } from '../modules/layout';
import { isInReservedZone } from '../zones/utils';

import { Pt, polygonAreaPx2, rectFrom3WithAz } from '../canvas/geom';
import { usePlannerV2Store } from '../state/plannerV2Store';

import ScaleIndicator from './ScaleIndicator';
import SonnendachOverlayKonva from './SonnendachOverlayKonva';
import OrientationHUD from './OrientationHUD';
import ModulesPreview from '../modules/ModulesPreview';
import OverlayTopToolbar from '../layout/OverlayTopToolbar';
import OverlayProgressStepper from '../layout/OverlayProgressStepper';
import CenterAddressSearchOverlay from '../layout/CenterAddressSearchOverlay';
import OverlayRightToggle from '../layout/OverlayRightToggle';
import { AnimatePresence, motion } from 'framer-motion';
import RightPropertiesPanelOverlay from '../layout/RightPropertiesPanelOverlay';
import OverlayLeftToggle from '../layout/OverlayLeftToggle';
import LeftLayersOverlay from '../layout/LeftLayersOverlay';
import PanelsLayer from '../modules/panels/PanelsLayer';
import RoofShapesLayer from './RoofShapesLayer';
import RoofHudOverlay from './RoofHudOverlay';
import { useContainerSize } from '../canvas/hooks/useContainerSize';
import { useBaseImage } from '../canvas/hooks/useBaseImage';
import { useStagePanZoom } from '../canvas/hooks/useStagePanZoom';
import { useDrawingTools } from '../canvas/hooks/useDrawingTools';
import DrawingOverlays from './DrawingOverlays';
import PanelHotkeys from '../modules/panels/PanelHotkeys';
import { nanoid } from 'nanoid';
import ZonesLayer from '../zones/ZonesLayer';
import FillAreaController from '../modules/fill/FillAreaController';
import ToolHotkeys from '../layout/ToolHotkeys';
import { history as plannerHistory } from '../state/history';
import ProjectStatsBar from '../ui/ProjectStatsBar';



// ——— ANGLES HELPERS ———
function radToDeg(r: number) { return (r * 180) / Math.PI; }
function normDeg(d: number) { const x = d % 360; return x < 0 ? x + 360 : x; }
function angleDiffDeg(a: number, b: number) {
  let d = Math.abs(normDeg(a) - normDeg(b));
  return d > 180 ? 360 - d : d;
}
function longestEdgeAngleDeg(pts: Pt[] | null | undefined) {
  if (!pts || pts.length < 2) return 0;
  let best = 0, maxLen2 = -1;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    const dx = pts[j].x - pts[i].x, dy = pts[j].y - pts[i].y;
    const len2 = dx * dx + dy * dy;
    if (len2 > maxLen2) { maxLen2 = len2; best = Math.atan2(dy, dx); }
  }
  return radToDeg(best);
}

function pointInPoly(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const inter = (yi > p.y) !== (yj > p.y) &&
      p.x < ((xj - xi) * (p.y - yi)) / ((yj - yi) || 1e-9) + xi;
    if (inter) inside = !inside;
  }
  return inside;
}


const deg2rad = (d: number) => (d * Math.PI) / 180;
function centroid(pts: Pt[]) {
  let x = 0, y = 0;
  for (const p of pts) { x += p.x; y += p.y; }
  const n = Math.max(1, pts.length);
  return { x: x / n, y: y / n };
}
function sub(a: Pt, b: Pt): Pt { return { x: a.x - b.x, y: a.y - b.y }; }
function add(a: Pt, b: Pt): Pt { return { x: a.x + b.x, y: a.y + b.y }; }
function rot(p: Pt, theta: number): Pt {
  const c = Math.cos(theta), s = Math.sin(theta);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}
function worldToLocal(p: Pt, O: Pt, theta: number): Pt { return rot(sub(p, O), -theta); }
function localToWorld(p: Pt, O: Pt, theta: number): Pt { return add(rot(p, theta), O); }



export default function CanvasStage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<any>(null);

  // store
  const snap = usePlannerV2Store((s) => s.snapshot);
  const view = usePlannerV2Store((s) => s.view);
  const setView = usePlannerV2Store((s) => s.setView);
  const tool = usePlannerV2Store((s) => s.tool);
  const layers = usePlannerV2Store((s) => s.layers);
  const addRoof = usePlannerV2Store((s) => s.addRoof);
  const select = usePlannerV2Store((s) => s.select);
  const selectedId = usePlannerV2Store((s) => s.selectedId);
  const rightOpen = usePlannerV2Store((s) => s.ui.rightPanelOpen);
  const modules = usePlannerV2Store((s) => s.modules);
  const duplicatePanel = usePlannerV2Store((s) => s.duplicatePanel);
  const addZone = usePlannerV2Store((s) => s.addZone);
  const step = usePlannerV2Store((s) => s.step);
  const selPanel = usePlannerV2Store((s) => s.getSelectedPanel());
  const gridMods = usePlannerV2Store((s) => s.modules);
  const roofAlign = usePlannerV2Store(s => s.roofAlign);
  const setTool = usePlannerV2Store((s) => s.setTool);

  // in cima a CanvasStage

const selectZone  = usePlannerV2Store((s) => s.selectZone); // ⬅️ nuovo


  // wrapper per soddisfare useDrawingTools che tipizza setTool come (t: string) => void
const setToolForHook = useCallback((t: string) => {
  // se hai un tipo Tool a union string, questo cast è sicuro a runtime
  setTool(t as any);
}, [setTool]);



  // size + base image
  const size = useContainerSize(containerRef);
  const handleCoverComputed = useCallback(
    (cover: number, ox: number, oy: number) => {
      setView({ fitScale: cover, scale: cover, offsetX: ox, offsetY: oy });
    },
    [setView]
  );
  const { img } = useBaseImage({
    url: snap.url ?? '',
    size,
    onCoverComputed: handleCoverComputed,
  });

  // UI states
  const [shapeMode, setShapeMode] = useState<'normal' | 'trapezio'>('normal');
  const [draggingVertex, setDraggingVertex] = useState(false);
  const [draggingPanel, setDraggingPanel] = useState(false);
  const [selectedPanelInstId, setSelectedPanelInstId] = useState<string | undefined>(undefined);
  const deletePanel = usePlannerV2Store((s) => s.deletePanel);
  const SHOW_AREA_LABELS = false;

  // inside CanvasStage, near other useCallbacks
const ignoreSelect = useCallback((_: string | undefined) => {}, []);


  // draft del riempi-area
 const [fillDraft, setFillDraft] =
  useState<{ a: Pt; b: Pt; poly: Pt[]; rects: {cx:number;cy:number;wPx:number;hPx:number;angleDeg:number}[] } | null>(null);


  const selectedRoof = useMemo(
    () => layers.find((l) => l.id === selectedId) ?? null,
    [layers, selectedId]
  );

  // angolo base griglia in COORDINATE CANVAS (come PanelsKonva)
const baseGridDeg = useMemo(() => {
  if (!selectedRoof) return 0;
  const eavesCanvasDeg = - (selectedRoof.azimuthDeg ?? 0) + 90; // azimut → canvas
  const polyDeg = longestEdgeAngleDeg(selectedRoof.points);
  return angleDiffDeg(eavesCanvasDeg, polyDeg) > 5 ? polyDeg : eavesCanvasDeg;
}, [selectedRoof?.azimuthDeg, selectedRoof?.points]);

// arrotonda per coerenza con i pannelli reali
const gridDeg = baseGridDeg + (gridMods.gridAngleDeg || 0);


// applica offset utente
// const gridDeg = (baseGridDeg + (gridMods.gridAngleDeg || 0));


  const hasPanelsOnSelected = useMemo(
    () =>
      !!selectedId &&
      usePlannerV2Store.getState().panels.some((p) => p.roofId === selectedId),
    [selectedId, layers]
  );

  // reset shapeMode on selection change
  useEffect(() => {
    setShapeMode('normal');
  }, [selectedId]);

  // subito sotto gli altri useEffect
useEffect(() => {
  if (tool === 'draw-reserved') {
    setSelectedPanelInstId(undefined);
  }
}, [tool]);

// CanvasStage.tsx – vicino ad altri useEffect in alto
// CanvasStage.tsx – SOSTITUISCI il vecchio useEffect con questo
useEffect(() => {
  type KbEvt = KeyboardEvent & { stopImmediatePropagation?: () => void };

  const onKey = (ev: KeyboardEvent) => {
    const e = ev as KbEvt;
    const st = usePlannerV2Store.getState();
    const key = e.key;

    // ---------- DELETE con PRIORITÀ ----------
    if (key === 'Delete' || key === 'Backspace') {
      
// 1) ZONA selezionata → elimina SOLO la zona
// 1) ZONA selezionata → elimina SOLO la zona (con guardie)
if (st.selectedZoneId) {
  const zoneId = st.selectedZoneId;
  const z = (st as any).zones?.find?.((zz: any) => zz.id === zoneId);
  const roofId = z?.roofId as string | undefined;

  // ⬇️ prima di tutto, "disinnesca" gli altri hotkey handler:
  // - svuota selezione pannelli
  st.setSelectedPanels?.([]);
  st.clearPanelSelection?.();

  // - rimuovi temporaneamente la selezione della falda
  //   (così eventuali handler roof-delete non vedono selectedId)
  st.select?.(undefined);

  plannerHistory.push('delete zone');
  st.removeZone?.(zoneId);
  st.selectZone?.(undefined);

  // blocca completamente la propagazione
  e.preventDefault();
  e.stopPropagation();
  (e as any).stopImmediatePropagation?.();

  // ripristina la selezione della falda (se esiste) NEL TICK SUCCESSIVO
  if (roofId) {
    setTimeout(() => {
      const S = usePlannerV2Store.getState();
      S.select?.(roofId);
    }, 0);
  }
  return;
}



      // 2) Pannelli selezionati? → elimina SOLO i pannelli
      if (Array.isArray(st.selectedPanelIds) && st.selectedPanelIds.length > 0) {
        plannerHistory.push('delete panels');
        if (st.deletePanelsBulk) st.deletePanelsBulk(st.selectedPanelIds);
        else st.selectedPanelIds.forEach((id: string) => st.deletePanel?.(id));
        st.setSelectedPanels?.([]);
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();
        return;
      }

      // 3) Falda selezionata? → elimina la falda
      if (st.selectedId) {
        plannerHistory.push('delete roof');
        st.deleteRoof?.(st.selectedId) || st.removeRoof?.(st.selectedId) || st.deleteLayer?.(st.selectedId);
        st.select?.(undefined);
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();
        return;
      }
    }

    // ---------- ESC con PRIORITÀ ----------
    if (key === 'Escape') {
      if (st.selectedZoneId) {
        st.setSelectedZone?.(undefined);
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();
        return;
      }
      if (st.clearPanelSelection) {
        st.clearPanelSelection();
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();
        return;
      }
      if (st.selectedId) {
        st.select?.(undefined);
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();
        return;
      }
    }
  };

  // capture:true → questo handler corre PRIMA di altri (es. PanelHotkeys)
  window.addEventListener('keydown', onKey, { capture: true });
  return () => window.removeEventListener('keydown', onKey, { capture: true } as any);
}, []);


// CanvasStage.tsx – subito dopo la definizione di stageRef
useEffect(() => {
  const stage = stageRef.current?.getStage?.();
  const container: HTMLDivElement | undefined = stage?.container?.();
  if (!container) return;

  // rende il container focusabile e focus al primo click
  container.tabIndex = 0;
  const focusOnPointer = () => container.focus();
  container.addEventListener('mousedown', focusOnPointer, { passive: true });
  container.addEventListener('touchstart', focusOnPointer, { passive: true });

  return () => {
    container.removeEventListener('mousedown', focusOnPointer);
    container.removeEventListener('touchstart', focusOnPointer);
  };
}, []);




  // pan/zoom
  const { canDrag, onWheel, onDragMove } = useStagePanZoom({ img, size, view, setView });

  // stage -> image coords
  const toImgCoords = useCallback(
    (stageX: number, stageY: number): Pt => {
      const s = view.scale || view.fitScale || 1;
      return {
        x: (stageX - (view.offsetX || 0)) / s,
        y: (stageY - (view.offsetY || 0)) / s,
      };
    },
    [view.scale, view.fitScale, view.offsetX, view.offsetY]
  );

  // abilita i tool di disegno solo in building
  const drawingEnabled =
    step === 'building' &&
    (tool === 'draw-roof' || tool === 'draw-rect' || tool === 'draw-reserved');

  // hook disegno tetto/zone (solo building)
const {
  drawingPoly,
  rectDraft,
  mouseImg,
  onStageMouseMove,
  onStageClick,
  onStageDblClick,
} = useDrawingTools({
  tool: drawingEnabled ? tool : 'select',
  layers,
  addRoof,
  select,
  toImgCoords,
    onZoneCommit: (poly4: Pt[]) => {
      if (!selectedId) return;
      plannerHistory.push('add reserved zone'); 
      addZone({ id: nanoid(), roofId: selectedId, type: 'riservata', points: poly4 });
      selectZone(undefined); 
    },
    snap: { tolDeg: 12, closeRadius: 12 }, 
    setTool: setToolForHook,

  });

  // stile tetti
  const stroke = '#fff';
  const strokeSelected = '#60a5fa';
  const fill = 'rgba(246, 240, 255, 0.12)';
  const strokeWidthNormal = 0.5;
  const strokeWidthSelected = 0.85;

  const areaLabel = (pts: Pt[]) => {
    if (!snap.mppImage) return null;
    const areaPx2 = polygonAreaPx2(pts);
    const m2 = areaPx2 * (snap.mppImage * snap.mppImage);
    return `${Math.round(m2)} m²`;
  };

  // cursore
  const cursor =
    (drawingEnabled || (step === 'modules' && tool === 'fill-area'))
      ? 'crosshair'
      : canDrag && !draggingVertex
      ? 'grab'
      : 'default';

  useEffect(() => {
    const el = stageRef.current?.getStage?.()?.container?.();
    if (!el) return;
    if (drawingEnabled || (step === 'modules' && tool === 'fill-area')) {
      el.style.cursor = 'crosshair';
    } else if (canDrag && !draggingVertex) {
      el.style.cursor = 'grab';
    } else {
      el.style.cursor = 'default';
    }
  }, [drawingEnabled, step, tool, canDrag, draggingVertex]);

  const layerScale = view.scale || view.fitScale || 1;

  return (
    <div
  ref={containerRef}
  className={`relative h-full w-full overflow-hidden ${snap?.url ? 'bg-neutral-50' : 'bg-transparent'}`}
>
      <OverlayProgressStepper />
      <OverlayTopToolbar />
      <ScaleIndicator />

      {/* {!snap.url && <CenterAddressSearchOverlay />} */}

      {/* <OverlayRightToggle /> */}

<div
  className="fixed z-[310] pointer-events-auto"
  style={{
    left: 'calc(var(--sb, 64px) -2px)',   // subito a destra della sidebar
    top:  'calc(var(--tb, 48px) + 41px)',   // sotto la topbar
    bottom: '0px',
    width: 'var(--propW, 280px)',
  }}
>
  <RightPropertiesPanelOverlay />
</div>


      
      

      {img && size.w > 0 && size.h > 0 && (
        <Stage
          ref={stageRef}
          width={size.w}
          height={size.h}
          x={view.offsetX || 0}
          y={view.offsetY || 0}
      draggable={
  canDrag &&
  tool !== 'draw-roof' &&
  tool !== 'draw-rect' &&
  tool !== 'draw-reserved' &&  
  tool !== 'fill-area' && 
  !draggingVertex &&
  !draggingPanel
}

          onDragMove={onDragMove}
          onWheel={onWheel}
          // handler di disegno SOLO in building
          onMouseMove={(evt: any) => {
  if (tool === 'fill-area') {
    const el = stageRef.current?.getStage?.()?.container?.();
    if (el) el.style.cursor = 'crosshair';
    return; // non inoltrare agli handler di building
  }
  if (drawingEnabled) onStageMouseMove?.(evt);
}}
onMouseEnter={tool === 'fill-area' ? () => {
  const el = stageRef.current?.getStage?.()?.container?.();
  if (el) el.style.cursor = 'crosshair';
} : undefined}

onClick={(evt: any) => {
  if (drawingEnabled) {
    onStageClick?.(evt);
    return;
  }

  const st = stageRef.current?.getStage?.();
  const target = evt.target;
  const targetName = typeof target?.name === 'function' ? target.name() : '';

  const store = usePlannerV2Store.getState();

  // 1) se NON ho cliccato su un nodo "interactive", deseleziono zona + pannelli
  const clickedInteractive = targetName?.includes('interactive');
  if (!clickedInteractive) {
    store.selectZone?.(undefined);
    store.clearPanelSelection?.();
  }

  // 2) se ho cliccato il vuoto (Stage) o il background catcher, deseleziono anche la falda
  if (target === st || targetName === 'bg-catcher') {
    store.select?.(undefined);
  }
}}



          onDblClick={drawingEnabled ? onStageDblClick : undefined}
          className={cursor === 'grab' ? 'cursor-grab active:cursor-grabbing' : ''}
        >
          <Layer scaleX={layerScale} scaleY={layerScale}>
            {/* base image */}
            <KonvaImage
              image={img}
              width={img.naturalWidth}
              height={img.naturalHeight}
              listening={false}
            />

            {/* background click-catcher: deseleziona zona/pannelli/falda quando clicchi sul vuoto */}
<Rect
  x={0}
  y={0}
  width={img.naturalWidth}
  height={img.naturalHeight}
  fill="rgba(0,0,0,0.001)"
  listening
  name="bg-catcher"
  onClick={() => {
    const st = usePlannerV2Store.getState();
    st.setSelectedZone?.(undefined);
    st.clearPanelSelection?.();
    st.select?.(undefined);
  }}
/>


            {/* Anteprima moduli SOLO in modules */}
            {step === 'modules' &&
              selectedRoof &&
              selPanel &&
              snap.mppImage &&
              modules.showGrid &&
              !hasPanelsOnSelected && (
   <ModulesPreview
  roofId={selectedRoof.id}
  polygon={selectedRoof.points}
  mppImage={snap.mppImage}
  azimuthDeg={gridDeg}  
  orientation={modules.orientation}
  panelSizeM={{ w: selPanel.widthM, h: selPanel.heightM }}
  spacingM={modules.spacingM}
  marginM={modules.marginM}
  textureUrl="/images/panel.webp"
  phaseX={gridMods.gridPhaseX || 0}
  phaseY={gridMods.gridPhaseY || 0}
  anchorX={(gridMods.gridAnchorX as any) || 'start'}
  anchorY={(gridMods.gridAnchorY as any) || 'start'}
  coverageRatio={gridMods.coverageRatio ?? 1}   // 👈 importante
/>
              )}

            <SonnendachOverlayKonva />

            {/* Roofs */}
            <RoofShapesLayer
              layers={layers}
              selectedId={selectedId}
              onSelect={tool === 'fill-area' ? ignoreSelect : select}
              showAreaLabels={SHOW_AREA_LABELS}
              stroke={stroke}
              strokeSelected={strokeSelected}
              fill={fill}
              strokeWidthNormal={strokeWidthNormal}
              strokeWidthSelected={strokeWidthSelected}
              shapeMode={shapeMode}
              toImg={toImgCoords}
              imgW={snap.width ?? img?.naturalWidth ?? 0}
              imgH={snap.height ?? img?.naturalHeight ?? 0}
              onHandlesDragStart={() => setDraggingVertex(true)}
              onHandlesDragEnd={() => setDraggingVertex(false)}
              areaLabel={areaLabel}
            />

            {/* Zones */}
            {layers.map((l) => (
              <ZonesLayer
                key={l.id}
                roofId={l.id}
                interactive={l.id === selectedId && tool !== 'fill-area'} 
                shapeMode={shapeMode}
                toImg={toImgCoords}
                imgW={snap.width ?? img?.naturalWidth ?? 0}
                imgH={snap.height ?? img?.naturalHeight ?? 0}
              />
            ))}

            {/* Anteprima zona riservata: SOLO in building */}
            {step === 'building' &&
              tool === 'draw-reserved' &&
              rectDraft &&
              rectDraft.length >= 1 &&
              mouseImg && (() => {
                const A = rectDraft[0];
                const B = rectDraft[1] ?? mouseImg;
                const C = mouseImg;
                const { poly } = rectFrom3WithAz(A, B, C);
                const flat = poly.flatMap((p) => [p.x, p.y]);
                return (
                  <Line
                    points={flat}
                    closed
                    stroke="#ff5f56"
                    strokeWidth={1.5}
                    dash={[10, 6]}
                    fill="rgba(255,95,86,0.10)"
                    listening={false}
                  />
                );
              })()}

{step === 'modules' && tool === 'fill-area' && fillDraft && (() => {
  const outlinePts = fillDraft.poly.flatMap(p => [p.x, p.y]);
  return (
    <>
      <Line points={outlinePts} closed stroke="#10b981" strokeWidth={1} listening={false} />
      {fillDraft.rects.map((r, i) => (
        <Rect
          key={i}
          x={r.cx}
          y={r.cy}
          width={r.wPx}
          height={r.hPx}
          offsetX={r.wPx/2}
          offsetY={r.hPx/2}
          rotation={r.angleDeg}
          fill="#2b4b7c"
          opacity={0.85}
          listening={false}
        />
      ))}
    </>
  );
})()}





          

            {/* Pannelli reali */}
            <PanelsLayer
              layers={layers}
              textureUrl="/images/panel.webp"
              selectedPanelId={selectedPanelInstId}
onSelect={(id) => {
    setSelectedPanelInstId(id);
    if (!id) return;
    const st = usePlannerV2Store.getState();
    st.select?.(undefined);            // deseleziona falda
    st.selectZone?.(undefined);   // deseleziona eventuale zona
  }}

              stageToImg={toImgCoords}
              onAnyDragStart={() => {
  setDraggingPanel(true);
  const st = usePlannerV2Store.getState();
  st.select?.(undefined);
  st.selectZone?.(undefined);
}}

              onAnyDragEnd={() => setDraggingPanel(false)}
            />

            {/* Overlay di disegno: SOLO in building */}
            {step === 'building' && (
           <DrawingOverlays
  tool={tool}
  drawingPoly={drawingPoly}
  rectDraft={rectDraft}
  mouseImg={mouseImg}
  stroke={stroke}
  areaLabel={areaLabel}
  mpp={snap.mppImage}   // ⬅️ nuovo
   roofSnapDeg={baseGridDeg} 
/>

            )}

{step === 'modules' && tool === 'fill-area' && img && (
  <Rect
    x={0}
    y={0}
    width={img.naturalWidth}
    height={img.naturalHeight}
    fill="rgba(0,0,0,0.01)"  // quasi invisibile, ma cattura gli eventi
    listening={true}
  />
)}


          </Layer>
        </Stage>
      )}

      {/* Controller che emette il draft del rettangolo */}
      {step === 'modules' && tool === 'fill-area' && (
        <FillAreaController
          stageRef={stageRef}
          toImgCoords={toImgCoords}
          onDraftChange={setFillDraft}
        />
      )}
      <ToolHotkeys />

    <PanelHotkeys
  selectedPanelId={selectedPanelInstId}
  disabled={tool !== 'select'}
  onDelete={(id) => {
    plannerHistory.push('delete panel');        // 👈 snapshot
    deletePanel(id);
    setSelectedPanelInstId(undefined);
  }}
  onDuplicate={(id) => {
    plannerHistory.push('duplicate panel');     // 👈 snapshot
    const nid = duplicatePanel(id);
    if (nid) setSelectedPanelInstId(nid);
  }}
/>


      <OrientationHUD />

      <RoofHudOverlay
        selectedRoof={selectedRoof}
        view={view}
        shapeMode={shapeMode}
        onToggleShape={() => setShapeMode((prev) => (prev === 'normal' ? 'trapezio' : 'normal'))}
        mpp={snap.mppImage}
        edgeColor={strokeSelected}
      />
      {/* <ProjectStatsBar /> */}
    </div>
  );
}
