'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Stage, Layer, Image as KonvaImage } from 'react-konva';

import { Pt, polygonAreaPx2 } from '../canvas/geom';
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
import { rectFrom3WithAz } from '../canvas/geom';
import { Line } from 'react-konva';



export default function CanvasStage() {
  // 1) ref contenitore
  const containerRef = useRef<HTMLDivElement>(null);

  // 2) store selectors (PRIMA di usare setView)
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


  // 3) size e immagine di base (ORA puoi usare setView)
  const size = useContainerSize(containerRef);

  // callback STABILE per inizializzare view al COVER
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

  // modalità forma del tetto selezionato
  const [shapeMode, setShapeMode] = useState<'normal' | 'trapezio'>('normal');
  // blocca il pan mentre trascini un vertice
  const [draggingVertex, setDraggingVertex] = useState(false);
  // drag pannelli (blocca pan stage)
  const [draggingPanel, setDraggingPanel] = useState(false);

  // selezione pannello
  const [selectedPanelInstId, setSelectedPanelInstId] = useState<string | undefined>(undefined);
  const deletePanel = usePlannerV2Store((s) => s.deletePanel);


  const SHOW_AREA_LABELS = false; // tenerlo su false

  // tetto selezionato comodo
  const selectedRoof = useMemo(
    () => layers.find((l) => l.id === selectedId) ?? null,
    [layers, selectedId]
  );

  const hasPanelsOnSelected = useMemo(
    () => !!selectedId && usePlannerV2Store.getState().panels.some((p) => p.roofId === selectedId),
    [selectedId, layers]
  );

  const step = usePlannerV2Store((s) => s.step);
  const selPanel = usePlannerV2Store((s) => s.getSelectedPanel());
  const panelTextureUrl = '/images/panel.webp';

  // quando cambio selezione, torno a "normale"
  useEffect(() => {
    setShapeMode('normal');
  }, [selectedId]);

  const { canDrag, onWheel, onDragMove } = useStagePanZoom({
    img,
    size,
    view,
    setView,
  });

  // ---------- coordinate stage -> immagine ----------
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

  // ---------- DISEGNO: gestito dall'hook ----------
  const { drawingPoly, rectDraft, mouseImg, onStageMouseMove, onStageClick, onStageDblClick } =
    useDrawingTools({
      tool,
      layers,
      addRoof,
      select,
      toImgCoords,
      onZoneCommit: (poly4: Pt[]) => {
      
       if (!selectedId) return; // serve una falda selezionata
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

  const cursor =
    tool === 'draw-roof' || tool === 'draw-rect'
      ? 'crosshair'
      : canDrag && !draggingVertex
      ? 'grab'
      : 'default';

  const layerScale = view.scale || view.fitScale || 1;

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
            <KonvaImage image={img} width={img.naturalWidth} height={img.naturalHeight} listening={false} />

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
              imgW={snap.width ?? img?.naturalWidth ?? 0}
              imgH={snap.height ?? img?.naturalHeight ?? 0}
              onHandlesDragStart={() => setDraggingVertex(true)}
              onHandlesDragEnd={() => setDraggingVertex(false)}
              areaLabel={areaLabel}
            />
            {/* Zone vietate (solo sulla falda selezionata per non affollare) */}
{layers.map((l) => (
  <ZonesLayer key={l.id} roofId={l.id} interactive={l.id === selectedId} />
))}
{/* Anteprima zona riservata durante il disegno (rettangolo) */}
{tool === 'draw-reserved' && rectDraft && rectDraft.length >= 1 && mouseImg && (
  (() => {
    const A = rectDraft[0];
    const B = rectDraft[1] ?? mouseImg;   // se manca B, usa mouse come B
    const C = mouseImg;                    // terzo punto mobile
    // rettangolo d'anteprima
    const { poly } = rectFrom3WithAz(A, B, C);
    const flat = poly.flatMap(p => [p.x, p.y]);
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
  })()
)}

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

            {/* overlay di disegno (preview poligono/rettangolo) */}
            <DrawingOverlays
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

      {/* HUD del tetto selezionato (toggle trapezio/normal, etichette, ecc.) */}
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
