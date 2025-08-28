'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Stage,
  Layer,
  Image as KonvaImage,
} from 'react-konva';

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
import DrawingOverlay from './DrawingOverlay';
import RoofHudOverlay from './RoofHudOverlay';
import { useContainerSize } from './hooks/useContainerSize';




// ---------- helpers ----------
type Pt = { x: number; y: number };

function polygonAreaPx2(pts: Pt[]) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y);
  }
  return Math.abs(a / 2);
}

function dist(a: Pt, b: Pt) {
  const dx = a.x - b.x, dy = a.y - b.y;
  return Math.hypot(dx, dy);
}


// rettangolo + azimut coerente con il bordo A→B (gronda) e il segno dell’altezza (C)
function rectFrom3WithAz(A: Pt, B: Pt, C: Pt): { poly: Pt[]; azimuthDeg: number } {
  const vx = B.x - A.x, vy = B.y - A.y;
  const len = Math.hypot(vx, vy) || 1;

  // normale unitaria alla base A→B
  const nx = -vy / len, ny = vx / len;

  // proiezione (C - B) sulla normale → altezza signed
  const hx = C.x - B.x, hy = C.y - B.y;
  const h = hx * nx + hy * ny;

  // offset verso il lato opposto del rettangolo
  const off = { x: nx * h, y: ny * h };
  const D = { x: A.x + off.x, y: A.y + off.y };
  const C2 = { x: B.x + off.x, y: B.y + off.y };

  // direzione "verso la gronda" (downslope) = opposta alla direzione di costruzione
  const sign = Math.sign(h) || 1;
  const dirToEaves = { x: -sign * nx, y: -sign * ny };

  // converti vettore immagine → azimut (0=N, 90=E); nota y cresce verso il basso
  const az = (Math.atan2(dirToEaves.x, -dirToEaves.y) * 180) / Math.PI;
  const azimuthDeg = ((az % 360) + 360) % 360;

  return { poly: [A, B, C2, D], azimuthDeg };
}


export default function CanvasStage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const size = useContainerSize(containerRef);
  const snap = usePlannerV2Store(s => s.snapshot);
  const view = usePlannerV2Store(s => s.view);
  const setView = usePlannerV2Store(s => s.setView);
  const tool = usePlannerV2Store(s => s.tool);
  const layers = usePlannerV2Store(s => s.layers);
  const addRoof = usePlannerV2Store(s => s.addRoof);
  const select = usePlannerV2Store(s => s.select);
  const selectedId = usePlannerV2Store(s => s.selectedId);
  const rightOpen = usePlannerV2Store(s => s.ui.rightPanelOpen);
  const modules = usePlannerV2Store(s => s.modules);
  
  // modalità forma del tetto selezionato
const [shapeMode, setShapeMode] = useState<'normal' | 'trapezio'>('normal');
// blocca il pan mentre trascini un vertice
const [draggingVertex, setDraggingVertex] = useState(false);
// drag pannelli (blocca pan stage)
const [draggingPanel, setDraggingPanel] = useState(false);

// selezione pannello
const [selectedPanelInstId, setSelectedPanelInstId] = useState<string | undefined>(undefined);

const SHOW_AREA_LABELS = false;            // <— tenerlo su false


// tetto selezionato comodo
const selectedRoof = useMemo(
  () => layers.find(l => l.id === selectedId) ?? null,
  [layers, selectedId]
);

const hasPanelsOnSelected = useMemo(
  () => !!selectedId && usePlannerV2Store.getState().panels.some(p => p.roofId === selectedId),
  [selectedId, layers] // layers cambia quando selezioni/cancelli tetti; basta a ri-renderizzare
);

const step = usePlannerV2Store(s => s.step);
const selPanel = usePlannerV2Store(s => s.getSelectedPanel());
const panelTextureUrl = '/images/panel.webp'; // 

// quando cambio selezione, torno a "normale"
useEffect(() => { setShapeMode('normal'); }, [selectedId]);

  // --- carica immagine
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!snap.url) { setImg(null); return; }
    const i = new Image();
    i.crossOrigin = 'anonymous';
    i.onload = () => setImg(i);
    i.src = snap.url;
    return () => setImg(null);
  }, [snap.url]);

  // --- osserva dimensioni contenitore


  // --- calcola fit + centra immagine (min zoom = fit)
// --- calcola cover + centra immagine (min zoom = cover)
useEffect(() => {
  if (!img || !size.w || !size.h) return;

  // COVER invece di FIT:
  // prima era: const fit = Math.min(size.w / img.naturalWidth, size.h / img.naturalHeight);
  const cover = Math.max(size.w / img.naturalWidth, size.h / img.naturalHeight);

  const sw = img.naturalWidth * cover;
  const sh = img.naturalHeight * cover;

  // centra l’immagine
  const ox = (size.w - sw) / 2;
  const oy = (size.h - sh) / 2;

  setView({ fitScale: cover, scale: cover, offsetX: ox, offsetY: oy });
}, [img, size.w, size.h, setView]);


  // --- clamp util
  const clampOffset = useCallback((scale: number, ox: number, oy: number) => {
    if (!img) return { x: 0, y: 0 };
    const sw = img.naturalWidth * scale;
    const sh = img.naturalHeight * scale;

    if (sw <= size.w) ox = (size.w - sw) / 2;
    if (sh <= size.h) oy = (size.h - sh) / 2;

    const minX = Math.min(0, size.w - sw);
    const maxX = 0;
    const minY = Math.min(0, size.h - sh);
    const maxY = 0;

    ox = Math.max(minX, Math.min(maxX, ox));
    oy = Math.max(minY, Math.min(maxY, oy));
    return { x: ox, y: oy };
  }, [img, size.w, size.h]);

  const clampScale = useCallback((s: number) => {
    const min = view.fitScale || 1;
    const max = (view.fitScale || 1) * 8;
    return Math.max(min, Math.min(max, s));
  }, [view.fitScale]);

  // --- zoom wheel (ancorato al cursore, min = fit)
  const onWheel = (e: any) => {
    e.evt.preventDefault();
    if (!img) return;

    const stage = e.target.getStage();
    const pointer = stage.getPointerPosition();
    const oldScale = view.scale || (view.fitScale || 1);
    const raw = e.evt.deltaY > 0 ? oldScale / 1.1 : oldScale * 1.1;
    const newScale = clampScale(raw);

    const worldX = (pointer.x - (view.offsetX || 0)) / oldScale;
    const worldY = (pointer.y - (view.offsetY || 0)) / oldScale;

    let newOX = pointer.x - worldX * newScale;
    let newOY = pointer.y - worldY * newScale;

    const cl = clampOffset(newScale, newOX, newOY);
    setView({ scale: newScale, offsetX: cl.x, offsetY: cl.y });
  };

  // --- pan dragging (draggable solo se immagine > contenitore)
  const canDrag = useMemo(() => {
    const s = view.scale || (view.fitScale || 1);
    if (!img) return false;
    return img.naturalWidth * s > size.w || img.naturalHeight * s > size.h;
  }, [img, size.w, size.h, view.scale, view.fitScale]);

  const onDragMove = (e: any) => {
    const ox = e.target.x();
    const oy = e.target.y();
    const s = view.scale || (view.fitScale || 1);
    const cl = clampOffset(s, ox, oy);
    e.target.position({ x: cl.x, y: cl.y });
    setView({ offsetX: cl.x, offsetY: cl.y });
  };

  // ---------- DISEGNO: POLIGONO ----------
  const [drawingPoly, setDrawingPoly] = useState<Pt[] | null>(null);
  const [mouseImg, setMouseImg] = useState<Pt | null>(null);

  // ---------- DISEGNO: RETTANGOLO 3-CLICK ----------
  const [rectDraft, setRectDraft] = useState<Pt[] | null>(null); // 0=A, 1=B, (C sarà mouse/3° click)

  // converte coordinate stage -> immagine (px immagine)
  const toImgCoords = useCallback((stageX: number, stageY: number): Pt => {
    const s = view.scale || (view.fitScale || 1);
    return {
      x: (stageX - (view.offsetX || 0)) / s,
      y: (stageY - (view.offsetY || 0)) / s,
    };
  }, [view.scale, view.fitScale, view.offsetX, view.offsetY]);

  const onStageMouseMove = (e: any) => {
    const pos = e.target.getStage().getPointerPosition();
    if (!pos) return;
    setMouseImg(toImgCoords(pos.x, pos.y));
  };

  const closeIfNearStart = (pts: Pt[], current: Pt) => {
    if (pts.length < 3) return false;
    const thr = 10; // px immagine
    return dist(pts[0], current) <= thr;
  };

  const finishPolygon = (pts: Pt[]) => {
    if (pts.length < 3) { setDrawingPoly(null); return; }
    const id = 'roof_' + Date.now().toString(36);
    const name = `Dach ${layers.filter(l => l.id.startsWith('roof_')).length + 1}`;
    addRoof({ id, name, points: pts });
    select(id);
    setDrawingPoly(null);
  };

// --- CLICK unico handler per tool diversi (no side-effects dentro updater)
const onStageClick = (e: any) => {
  const pos = e.target.getStage().getPointerPosition();
  if (!pos) return;
  const p = toImgCoords(pos.x, pos.y);

  if (tool === 'draw-roof') {
    // POLIGONO: aggiorno lo stato in modo puro, e faccio addRoof fuori dagli updater
    if (!drawingPoly || drawingPoly.length === 0) {
      setDrawingPoly([p]);
      return;
    }
    if (closeIfNearStart(drawingPoly, p)) {
      // chiudi e commit
      const pts = drawingPoly;
      const id = 'roof_' + Date.now().toString(36);
      const name = `Dach ${layers.filter(l => l.id.startsWith('roof_')).length + 1}`;
      addRoof({ id, name, points: pts });
      select(id);
      setDrawingPoly(null);
      return;
    }
    setDrawingPoly([...drawingPoly, p]);
    return;
  }

  if (tool === 'draw-rect') {
    // RETTANGOLO 3-click: stesso principio
    if (!rectDraft || rectDraft.length === 0) {
      setRectDraft([p]); // A
      return;
    }
    if (rectDraft.length === 1) {
      setRectDraft([rectDraft[0], p]); // A,B
      return;
    }
    // length === 2 → terzo click = commit
    const { poly, azimuthDeg } = rectFrom3WithAz(rectDraft[0], rectDraft[1], p);
const id = 'roof_' + Date.now().toString(36);
const name = `Dach ${layers.filter(l => l.id.startsWith('roof_')).length + 1}`;
addRoof({ id, name, points: poly, azimuthDeg, source: 'manual' });
select(id);
    setRectDraft(null);
    return;
  }

  // tool = select: click vuoto deseleziona
  if (e.target === e.target.getStage()) select(undefined);
};

// Doppio click: solo per poligono, senza updater con side-effects
const onStageDblClick = () => {
  if (tool !== 'draw-roof') return;
  if (drawingPoly && drawingPoly.length >= 3) {
    const pts = drawingPoly;
    const id = 'roof_' + Date.now().toString(36);
    const name = `Dach ${layers.filter(l => l.id.startsWith('roof_')).length + 1}`;
    addRoof({ id, name, points: pts });
    select(id);
    setDrawingPoly(null);
  } else {
    setDrawingPoly(null);
  }
};

  // ESC/ENTER gestione solo per poligono
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (tool === 'draw-roof') {
        if (ev.key === 'Escape') setDrawingPoly(null);
        if (ev.key === 'Enter' && drawingPoly && drawingPoly.length >= 3) finishPolygon(drawingPoly);
      }
      if (tool === 'draw-rect') {
        if (ev.key === 'Escape') setRectDraft(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tool, drawingPoly]);


// dopo (più “premium”, stile Reonic-like)
const stroke = '#fff';                    // colore base
const strokeSelected = '#60a5fa';         // azzurrino (tailwind sky-400)
const fill = 'rgba(246, 240, 255, 0.12)';
const strokeWidthNormal = 0.5;
const strokeWidthSelected = 0.85;  

  const areaLabel = (pts: Pt[]) => {
    if (!snap.mppImage) return null;
    const areaPx2 = polygonAreaPx2(pts);
    const m2 = areaPx2 * (snap.mppImage * snap.mppImage);
    return `${Math.round(m2)} m²`;
  };

  const cursor =
  tool === 'draw-roof' || tool === 'draw-rect'
    ? 'crosshair'
    : canDrag && !draggingVertex
      ? 'grab'
      : 'default';
  const layerScale = view.scale || (view.fitScale || 1);

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden bg-neutral-50">
      <OverlayProgressStepper />
      <OverlayTopToolbar />
      <ScaleIndicator />
{/* Barra centrale: solo prima di iniziare */}
{!snap.url && <CenterAddressSearchOverlay />}
{/* Toggle flottante del pannello destro */}
<OverlayRightToggle />
{/* Right panel overlay */}
<AnimatePresence>
  {rightOpen && (
    <motion.div
      key="right-panel"
      initial={{ x: 16, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 16, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 24 }}
      className="absolute right-3 top-28 bottom-3 z-[300] pointer-events-auto flex"
    >
      <RightPropertiesPanelOverlay />
    </motion.div>
  )}
</AnimatePresence>
{/* Toggle flottante del pannello sinistro */}
<OverlayLeftToggle />
{/* Left panel overlay */}
<LeftLayersOverlay />
      {img && size.w > 0 && size.h > 0 && (
        <Stage
          width={size.w}
          height={size.h}
          x={view.offsetX || 0}
          y={view.offsetY || 0}
          draggable={canDrag && tool !== 'draw-roof' && tool !== 'draw-rect' && !draggingVertex && !draggingPanel}
          onDragMove={onDragMove}
          onWheel={onWheel}
          onMouseMove={onStageMouseMove}
          onClick={onStageClick}
          onDblClick={onStageDblClick}
          className={cursor === 'grab' ? 'cursor-grab active:cursor-grabbing' : ''}
        >
          <Layer scaleX={layerScale} scaleY={layerScale}>
            {/* sfondo immagine */}
            <KonvaImage
              image={img}
              width={img.naturalWidth}
              height={img.naturalHeight}
              listening={false}
            />
{step === 'modules' && selectedRoof && selPanel && snap.mppImage && modules.showGrid && !hasPanelsOnSelected && (
  <ModulesPreview
    polygon={selectedRoof.points}
    mppImage={snap.mppImage}
    azimuthDeg={selectedRoof.azimuthDeg ?? 0}
    orientation={modules.orientation}
    panelSizeM={{ w: selPanel.widthM, h: selPanel.heightM }}
    spacingM={modules.spacingM}
    marginM={modules.marginM}
    textureUrl="/images/panel.webp"
  />
)}
            <SonnendachOverlayKonva />
            {/* tetti esistenti */}
<RoofShapesLayer
  layers={layers}
  selectedId={selectedId}
  onSelect={select}
  showAreaLabels={SHOW_AREA_LABELS}
  stroke={stroke}
  strokeSelected={strokeSelected}
  fill={fill}
  strokeWidthNormal={strokeWidthNormal}
  strokeWidthSelected={strokeWidthSelected}
  shapeMode={shapeMode}
  toImg={toImgCoords}
  imgW={snap.width ?? (img?.naturalWidth ?? 0)}
  imgH={snap.height ?? (img?.naturalHeight ?? 0)}
  onHandlesDragStart={() => setDraggingVertex(true)}
  onHandlesDragEnd={() => setDraggingVertex(false)}
  areaLabel={areaLabel}
/>
{/* Pannelli reali */}
<PanelsLayer
  layers={layers}
  textureUrl={panelTextureUrl}
  selectedPanelId={selectedPanelInstId}
  onSelect={setSelectedPanelInstId}
  stageToImg={toImgCoords}
  onAnyDragStart={() => setDraggingPanel(true)}
  onAnyDragEnd={() => setDraggingPanel(false)}
/>
<DrawingOverlay
  tool={tool}
  drawingPoly={drawingPoly}
  rectDraft={rectDraft}
  mouseImg={mouseImg}
  stroke={stroke}
  areaLabel={areaLabel}
/>
          </Layer>
        </Stage>       
      )}
      <OrientationHUD />
      {/* Toggle modalità forma (posizionato sopra il centroide del tetto selezionato) */}
<RoofHudOverlay
  selectedRoof={selectedRoof}
  view={view}
  shapeMode={shapeMode}
  onToggleShape={() => setShapeMode(prev => (prev === 'normal' ? 'trapezio' : 'normal'))}
  mpp={snap.mppImage}
  edgeColor={strokeSelected}
/>
    </div>
  );
}

