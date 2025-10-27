'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Stage, Layer, Image as KonvaImage, Line, Rect , Group} from 'react-konva';
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
import CanvasHotkeys from './CanvasHotekeys';
import ModuleSprite from '../modules/ModuleSprite';



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

  // --- ROTAZIONE MANUALE ---
// const [rotateDeg, setRotateDeg] = useState(0);
const contentGroupRef = useRef<any>(null);

// Hotkeys: [ e ] per ±1°, Shift+[ / Shift+] per ±10°
useEffect(() => {
  const onKey = (ev: KeyboardEvent) => {
    // ignora se stai scrivendo
    const isTyping = (el: HTMLElement | null) => {
      if (!el) return false;
      const tag = el.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea') return true;
      if ((el as any).isContentEditable) return true;
      if (el.closest?.('input,textarea,[contenteditable="true"],[data-stop-hotkeys="true"]')) return true;
      return false;
    };
    if (isTyping(ev.target as HTMLElement | null) ||
        isTyping(document.activeElement as HTMLElement | null)) return;

    if (ev.key === '[' || ev.key === ']') {
      ev.preventDefault();
      const step = ev.shiftKey ? 10 : 1;
      setRotateDeg(d => d + (ev.key === ']' ? step : -step));
    }
  };
  window.addEventListener('keydown', onKey, { capture: true });
  return () => window.removeEventListener('keydown', onKey, { capture: true } as any);
}, []);



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

  const onKey = (ev: KbEvt) => {
    // ⛔️ NON reagire se il focus è su un campo di input / editor
    const isTyping = (el: HTMLElement | null) => {
      if (!el) return false;
      const tag = el.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea') return true;
      if ((el as any).isContentEditable) return true;
      if (el.closest?.('input,textarea,[contenteditable="true"],[data-stop-hotkeys="true"]')) return true;
      return false;
    };
    if (isTyping(ev.target as HTMLElement | null) ||
        isTyping(document.activeElement as HTMLElement | null)) {
      return;
    }

    const st  = usePlannerV2Store.getState();
    const key = ev.key;

    // ---------- DELETE con PRIORITÀ ----------
    if (key === 'Delete' || key === 'Backspace') {

      // 1) ZONA selezionata → elimina SOLO la zona (con guardie)
      if (st.selectedZoneId) {
        const zoneId = st.selectedZoneId;
        const z = (st as any).zones?.find?.((zz: any) => zz.id === zoneId);
        const roofId = z?.roofId as string | undefined;

        // disinnesca altri handler
        st.setSelectedPanels?.([]);
        st.clearPanelSelection?.();
        st.select?.(undefined); // rimuovi temporaneamente la selezione falda

        plannerHistory.push('delete zone');
        st.removeZone?.(zoneId);
        st.selectZone?.(undefined);

        // blocca completamente la propagazione
        ev.preventDefault();
        ev.stopPropagation();
        ev.stopImmediatePropagation?.();

        // ripristina selezione falda nel tick successivo
        if (roofId) {
          setTimeout(() => {
            const S = usePlannerV2Store.getState();
            S.select?.(roofId);
          }, 0);
        }
        return;
      }

      // 2) PANNELLI selezionati → elimina SOLO i pannelli
      if (Array.isArray(st.selectedPanelIds) && st.selectedPanelIds.length > 0) {
        plannerHistory.push('delete panels');
        if (st.deletePanelsBulk) st.deletePanelsBulk(st.selectedPanelIds);
        else st.selectedPanelIds.forEach((id: string) => st.deletePanel?.(id));
        st.setSelectedPanels?.([]);
        ev.preventDefault();
        ev.stopPropagation();
        ev.stopImmediatePropagation?.();
        return;
      }

      
 // 3) FALDA selezionata → elimina la falda
if (st.selectedId) {

  // ⛔️ Blocco: in modalità "modules" non si possono eliminare falde
  if (st.step === 'modules') {
    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation?.();
    return;
  }

  plannerHistory.push('delete roof');
  const del =
    (st as any).deleteRoof   // legacy
    ?? st.removeRoof         // current
    ?? st.deleteLayer;       // fallback

  del?.(st.selectedId);
  st.select?.(undefined);
  ev.preventDefault();
  ev.stopPropagation();
  ev.stopImmediatePropagation?.();
  return;
}

    }

    // ---------- ESC con PRIORITÀ ----------
    if (key === 'Escape') {
      if (st.selectedZoneId) {
        st.setSelectedZone?.(undefined);
        ev.preventDefault();
        ev.stopPropagation();
        ev.stopImmediatePropagation?.();
        return;
      }
      if (st.clearPanelSelection) {
        st.clearPanelSelection();
        ev.preventDefault();
        ev.stopPropagation();
        ev.stopImmediatePropagation?.();
        return;
      }
      if (st.selectedId) {
        st.select?.(undefined);
        ev.preventDefault();
        ev.stopPropagation();
        ev.stopImmediatePropagation?.();
        return;
      }
    }
  };

  // capture:true → la guardia corre PRIMA degli altri listener
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

// --- ROTAZIONE: utils + handlers ---
const wrapDeg = (d: number) => {
  // normalizza in [-180, 180]
  const n = ((d + 180) % 360 + 360) % 360 - 180;
  return Math.round(n);
};

const [rotateDeg, setRotateDeg] = useState(0);        // se non l'hai già
const [rotInput, setRotInput] = useState<string>('0');

// mantieni l'input sincronizzato quando ruoti da bottoni/hotkeys/altro
useEffect(() => {
  setRotInput(String(rotateDeg));
}, [rotateDeg]);

const bumpRotation = (delta: number) => {
  setRotateDeg((d) => wrapDeg(d + delta));
};

const applyRotationFromInput = () => {
  const v = parseFloat(rotInput.replace(',', '.'));
  if (Number.isFinite(v)) setRotateDeg(wrapDeg(v));
  else setRotInput(String(rotateDeg)); // ripristina se input invalido
};



  // pan/zoom
  const { canDrag, onWheel, onDragMove } = useStagePanZoom({ img, size, view, setView });

  // stage -> image coords
// stage -> image coords (considera rotazione e scala/pan del gruppo)
const toImgCoords = useCallback(
  (stageX: number, stageY: number): Pt => {
    const g = contentGroupRef.current;
    if (g?.getAbsoluteTransform) {
      const inv = g.getAbsoluteTransform().copy().invert();
      const p = inv.point({ x: stageX, y: stageY });
      return { x: p.x, y: p.y };
    }
    // fallback (non dovrebbe servire)
    const s = view.scale || view.fitScale || 1;
    return { x: (stageX - (view.offsetX || 0)) / s, y: (stageY - (view.offsetY || 0)) / s };
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
     snap: tool === 'draw-reserved'
    ? { tolDeg: 3, closeRadius: 4 }   // was { tolDeg: 12, closeRadius: 12 }
    : { tolDeg: 5, closeRadius: 5 }, // also milder for roofs/rects
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
  // ⬅️ NEW: in fill-area NON deselezionare nulla
  if (tool === 'fill-area') return;

  if (drawingEnabled) {
    onStageClick?.(evt);
    return;
  }

  const st = stageRef.current?.getStage?.();
  const target = evt.target;
  const targetName = typeof target?.name === 'function' ? target.name() : '';

  const store = usePlannerV2Store.getState();

  const clickedInteractive = targetName?.includes('interactive');
  if (!clickedInteractive) {
    store.selectZone?.(undefined);
    store.clearPanelSelection?.();
  }

  if (target === st || targetName === 'bg-catcher') {
    store.select?.(undefined);
  }
}}




          onDblClick={drawingEnabled ? onStageDblClick : undefined}
          className={cursor === 'grab' ? 'cursor-grab active:cursor-grabbing' : ''}
        >
       <Layer scaleX={layerScale} scaleY={layerScale}>
  <Group
    ref={contentGroupRef}
    x={img?.naturalWidth ? img.naturalWidth / 2 : 0}
    y={img?.naturalHeight ? img.naturalHeight / 2 : 0}
    offsetX={img?.naturalWidth ? img.naturalWidth / 2 : 0}
    offsetY={img?.naturalHeight ? img.naturalHeight / 2 : 0}
    rotation={rotateDeg}
  >
    {/* base image */}
    <KonvaImage
      image={img}
      width={img.naturalWidth}
      height={img.naturalHeight}
      listening={false}
    />

<Rect
  x={0}
  y={0}
  width={img.naturalWidth}
  height={img.naturalHeight}
  fill="rgba(0,0,0,0.001)"
  listening={tool !== 'fill-area'}          // ⬅️ qui
  name="bg-catcher"
  onClick={() => {
    if (tool === 'fill-area') return;       // safety in più
    const st = usePlannerV2Store.getState();
    st.setSelectedZone?.(undefined);
    st.clearPanelSelection?.();
    st.select?.(undefined);
  }}
/>


    {/* --- TUTTO IL RESTO (ModulesPreview, SonnendachOverlayKonva, RoofShapesLayer, ZonesLayer, pannelli, anteprime, ecc.) RIMANE QUI DENTRO --- */}
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
          coverageRatio={gridMods.coverageRatio ?? 1}
        />
      )}

<SonnendachOverlayKonva />

{/* ⬇️ In fill-area disattivo l’ascolto eventi di tetti + zone */}
<Group listening={tool !== 'fill-area'}>
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
</Group>

{/* Draft visivo per fill-area */}
{tool === 'fill-area' && fillDraft && (
  <Group listening={false}>
    {/* opzionale: contorno dell’area che stai riempiendo */}
    {fillDraft.poly?.length >= 3 && (
      <Line
        points={fillDraft.poly.flatMap(p => [p.x, p.y])}
        closed
        stroke="rgba(255,255,255,0.9)"
        strokeWidth={0.8}
        dash={[6, 4]}
        opacity={0.6}
        listening={false}
      />
    )}

    {/* preview con i moduli REALI al 50% */}
    <Group opacity={0.5} listening={false}>
      {fillDraft.rects.map((r, i) => (
        <ModuleSprite
          key={i}
          x={r.cx}
          y={r.cy}
          w={r.wPx}
          h={r.hPx}
          rotationDeg={r.angleDeg}
          textureUrl="/images/panel.webp"  // o il tuo textureUrl
        />
      ))}
    </Group>
  </Group>
)}




    {step === 'modules' && (
  <PanelsLayer
    layers={layers}
    textureUrl="/images/panel.webp"
    selectedPanelId={usePlannerV2Store.getState().selectedPanelId}
    onSelect={(id?: string) => {
      const S = usePlannerV2Store.getState();
      // selezione singola: aggiorna l'array di selezione (se presente nello store)
      if (S.setSelectedPanels) S.setSelectedPanels(id ? [id] : []);
    }}
    stageToImg={toImgCoords}
  />
)}


    {/* …tutto il resto che avevi (preview riservata, fill-area preview, PanelsLayer, DrawingOverlays ecc.) */}
    {step === 'building' && (
   <DrawingOverlays
  tool={tool}
  drawingPoly={drawingPoly}
  rectDraft={rectDraft}
  mouseImg={mouseImg}
  stroke={stroke}
  areaLabel={areaLabel}
  mpp={snap.mppImage}
  roofSnapDeg={baseGridDeg}
  canvasRotateDeg={rotateDeg}   // ⬅️ nuovo: snap allineati allo schermo
/>

    )}
  </Group>
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
<CanvasHotkeys />


      {/* <OrientationHUD /> */}

  <RoofHudOverlay
  selectedRoof={selectedRoof}
  view={view}
  shapeMode={shapeMode}
  onToggleShape={() => setShapeMode(prev => (prev === 'normal' ? 'trapezio' : 'normal'))}
  mpp={snap.mppImage}
  edgeColor={strokeSelected}
  imgW={img?.naturalWidth ?? 0}
  imgH={img?.naturalHeight ?? 0}
  rotateDeg={rotateDeg}
/>
{/* ROTATION HUD */}
<div className="fixed right-3 bottom-3 z-[500] bg-neutral-800/90 text-neutral-400 rounded-md shadow px-3 py-2 flex items-center gap-2"
     style={{ backdropFilter: 'blur(3px)' }}>
  <button
    className="px-2 py-1 rounded border hover:bg-neutral-700"
    onClick={() => bumpRotation(-10)}
    title="Ruota -10°"
  >−10°</button>

  <button
    className="px-2 py-1 rounded border hover:bg-neutral-700"
    onClick={() => bumpRotation(-1)}
    title="Ruota -1°"
  >−1°</button>

  <input
    type="range"
    min={-180}
    max={180}
    step={1}
    value={rotateDeg}
    onChange={(e) => setRotateDeg(wrapDeg(parseInt(e.target.value, 10)))}
    className="w-44"
  />

  <button
    className="px-2 py-1 rounded border hover:bg-neutral-700"
    onClick={() => bumpRotation(+1)}
    title="Ruota +1°"
  >+1°</button>

  <button
    className="px-2 py-1 rounded border hover:bg-neutral-700"
    onClick={() => bumpRotation(+10)}
    title="Ruota +10°"
  >+10°</button>

  <div className="flex items-center gap-1">
    <input
      type="text"
      inputMode="decimal"
      className="w-16 px-2 py-1 rounded border text-right"
      value={rotInput}
      onChange={(e) => setRotInput(e.target.value)}
      onBlur={applyRotationFromInput}
      onKeyDown={(e) => { if (e.key === 'Enter') applyRotationFromInput(); }}
      title="Inserisci gradi e premi Invio"
    />
    <span className="text-sm text-gray-600">°</span>
  </div>

  <button
    className="px-2 py-1 rounded border hover:bg-neutral-700"
    onClick={() => setRotateDeg(0)}
    title="Reset 0°"
  >Reset</button>
</div>


    </div>
  );
}
