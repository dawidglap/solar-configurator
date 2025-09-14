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

export default function CanvasStage() {
  const containerRef = useRef<HTMLDivElement>(null);

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

  const selectedRoof = useMemo(
    () => layers.find((l) => l.id === selectedId) ?? null,
    [layers, selectedId]
  );

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

  // 🔒 abilita i tool di DISEGNO solo in building
  const drawingEnabled =
    step === 'building' &&
    (tool === 'draw-roof' || tool === 'draw-rect' || tool === 'draw-reserved');

  // hook disegno: attivalo solo se drawingEnabled, altrimenti no-op
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

  // 🎯 cursore: crosshair quando disegno (building) o quando fill-area (modules)
  const cursor =
    (drawingEnabled || (step === 'modules' && tool === 'fill-area'))
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

      {!snap.url && <CenterAddressSearchOverlay />}

      <OverlayRightToggle />

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

      <OverlayLeftToggle />
      <LeftLayersOverlay />

      {img && size.w > 0 && size.h > 0 && (
        <Stage
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
          // ⬇️ handler di disegno SOLO in building
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

            {/* ⬇️ Anteprima moduli SOLO in modules (condizioni come prima) */}
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
                  azimuthDeg={(selectedRoof.azimuthDeg ?? 0) + (gridMods.gridAngleDeg || 0)}
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

            {/* Zones (render sempre ok; interazione la governerai nel layer stesso) */}
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

            {/* Overlay di disegno (preview poligono/rettangolo): SOLO in building */}
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
