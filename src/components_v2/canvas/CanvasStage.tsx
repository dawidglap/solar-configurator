'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Stage, Layer, Image as KonvaImage, Line } from 'react-konva';

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

  // draft del riempi-area
  const [fillDraft, setFillDraft] = useState<{ a: Pt; b: Pt } | null>(null);

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
const baseGridDegRounded = Math.round(baseGridDeg * 100) / 100;
const gridDeg = baseGridDegRounded + (gridMods.gridAngleDeg || 0);


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
      addZone({ id: nanoid(), roofId: selectedId, type: 'riservata', points: poly4 });
    },
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

      <OverlayRightToggle />

<AnimatePresence>
  {rightOpen && (
    <motion.div
      key="left-panel"
      initial={{ x: -12, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: -12, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 24 }}
      className="absolute z-[300] pointer-events-auto flex"
      style={{
        top: 'calc(var(--tb, 48px) + 8px)',
        bottom: '12px',
        // ⬇️ ora si allinea automaticamente in base allo stato della sidebar
        left: '-2px',
      }}
    >
      <RightPropertiesPanelOverlay />
    </motion.div>
  )}
</AnimatePresence>


      <OverlayLeftToggle />
      <LeftLayersOverlay />

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
            !draggingVertex &&
            !draggingPanel
          }
          onDragMove={onDragMove}
          onWheel={onWheel}
          // handler di disegno SOLO in building
          onMouseMove={drawingEnabled ? onStageMouseMove : undefined}
          onClick={drawingEnabled ? onStageClick : undefined}
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
                  coverageRatio={gridMods.coverageRatio ?? 1}
                />
              )}

            <SonnendachOverlayKonva />

            {/* Roofs */}
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
                interactive={l.id === selectedId}
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

              {/* ⬇️ Anteprima moduli DENTRO il rettangolo fill-area */}
{step === 'modules' &&
  tool === 'fill-area' &&
  fillDraft &&
  selectedRoof &&
  selPanel &&
  snap.mppImage && (() => {
    const { a, b } = fillDraft;
  const angleDeg = gridDeg;

    const t = (angleDeg * Math.PI) / 180;

    const ux = { x: Math.cos(t),  y: Math.sin(t)  };
    const uy = { x: -Math.sin(t), y: Math.cos(t) };

    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const w = vx * ux.x + vy * ux.y;
    const h = vx * uy.x + vy * uy.y;

    const p1 = { x: a.x,                 y: a.y };
    const p2 = { x: a.x + w * ux.x,      y: a.y + w * ux.y };
    const p3 = { x: p2.x + h * uy.x,     y: p2.y + h * uy.y };
    const p4 = { x: a.x + h * uy.x,      y: a.y + h * uy.y };
    const rectPoly = [p1, p2, p3, p4];

    return (
      <ModulesPreview
        // usiamo la falda selezionata per leggere eventuali zone/margini,
        // ma il "target" da riempire è il poligono del rettangolo:
        roofId={selectedRoof.id}
        polygon={rectPoly}
        mppImage={snap.mppImage}
        azimuthDeg={angleDeg}
        orientation={modules.orientation}
        panelSizeM={{ w: selPanel.widthM, h: selPanel.heightM }}
        spacingM={modules.spacingM}
        marginM={modules.marginM}
        textureUrl="/images/panel.webp"
        phaseX={gridMods.gridPhaseX || 0}
        phaseY={gridMods.gridPhaseY || 0}
        anchorX={(gridMods.gridAnchorX as any) || 'start'}
        anchorY={(gridMods.gridAnchorY as any) || 'start'}
        coverageRatio={1} // qui riempiamo tutto il rettangolo
      />
    );
  })()}


            {/* ⬇️ Rubber-band fill-area RUOTATO: SOLO in modules + fill-area */}
            {step === 'modules' && tool === 'fill-area' && fillDraft && selectedRoof && (() => {
              const { a, b } = fillDraft;

              // angolo totale = azimuth falda + eventuale rotazione griglia
const angleDeg = gridDeg;

              const t = (angleDeg * Math.PI) / 180;

              // assi ruotati
              const ux = { x: Math.cos(t),  y: Math.sin(t)  };
              const uy = { x: -Math.sin(t), y: Math.cos(t) };

              // proietta il vettore AB sugli assi ruotati → width/height (possono essere negativi)
              const vx = b.x - a.x;
              const vy = b.y - a.y;
              const w = vx * ux.x + vy * ux.y; // componente lungo ux
              const h = vx * uy.x + vy * uy.y; // componente lungo uy

              // ricostruisci i 4 vertici ruotati
              const p1 = { x: a.x,                 y: a.y };
              const p2 = { x: a.x + w * ux.x,      y: a.y + w * ux.y };
              const p3 = { x: p2.x + h * uy.x,     y: p2.y + h * uy.y };
              const p4 = { x: a.x + h * uy.x,      y: a.y + h * uy.y };

              const points = [p1.x,p1.y, p2.x,p2.y, p3.x,p3.y, p4.x,p4.y];

              return (
                <Line
                  points={points}
                  closed
                  stroke="#111827"
                  strokeWidth={1}
                  dash={[8, 6]}
                  fill="rgba(17,24,39,0.06)"
                  listening={false}
                />
              );
            })()}

            {/* Pannelli reali */}
            <PanelsLayer
              layers={layers}
              textureUrl="/images/panel.webp"
              selectedPanelId={selectedPanelInstId}
              onSelect={setSelectedPanelInstId}
              stageToImg={toImgCoords}
              onAnyDragStart={() => setDraggingPanel(true)}
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
        onDelete={(id) => {
          deletePanel(id);
          setSelectedPanelInstId(undefined);
        }}
        onDuplicate={(id) => {
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
    </div>
  );
}
