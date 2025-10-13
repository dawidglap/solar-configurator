// src/components_v2/modules/ModulesPanel.tsx
'use client';

import React, { useCallback } from 'react';
import { usePlannerV2Store } from '../state/plannerV2Store';
import RoofAreaInfo from '../ui/RoofAreaInfo';
import DetectedRoofsImport from '../panels/DetectedRoofsImport';
import { MdViewModule } from 'react-icons/md';
import OrientationToggle from '../layout/TopToolbar/OrientationToggle';

// ⬇️ funzioni esistenti per autolayout e filtri ostacoli
import { computeAutoLayoutRects } from '../modules/layout';
import { overlapsReservedRect } from '../zones/utils';

type Pt = { x: number; y: number };

const inputBase =
  'w-full h-8 rounded-xl border border-neutral-200 bg-neutral-50/90 px-2 text-[11px] leading-none outline-none ' +
  'focus:ring-1 focus:ring-neutral-400 focus:border-neutral-300 transition';

const labelSm = 'block text-[10px] font-medium uppercase tracking-wide text-neutral-600';

export default function ModulesPanel() {
  // --- Layers / selezione tetto ---
  const layers       = usePlannerV2Store(s => s.layers);
  const selectedId   = usePlannerV2Store(s => s.selectedId);
  const select       = usePlannerV2Store(s => s.select);
  const delLayer     = usePlannerV2Store(s => s.deleteLayer);
  const mpp          = usePlannerV2Store(s => s.snapshot.mppImage);
  const detected     = usePlannerV2Store(s => s.detectedRoofs);

  // --- Moduli / pannelli ---
  const panels             = usePlannerV2Store(s => s.panels);
  const modules            = usePlannerV2Store(s => s.modules);
  const setModules         = usePlannerV2Store(s => s.setModules);
  const selSpec            = usePlannerV2Store(s => s.getSelectedPanel());
  const snapshot           = usePlannerV2Store(s => s.snapshot);
  const addPanelsForRoof   = usePlannerV2Store(s => s.addPanelsForRoof);
  const clearPanelsForRoof = usePlannerV2Store(s => s.clearPanelsForRoof);

  // --- Catalogo PV (spostato qui dalla topbar) ---
  const catalogPanels    = usePlannerV2Store(s => s.catalogPanels);
  const selectedPanelId  = usePlannerV2Store(s => s.selectedPanelId);
  const setSelectedPanel = usePlannerV2Store(s => s.setSelectedPanel);

  /** Re-layout immediato della falda selezionata (usato dal toggle orientamento) */
  const relayoutSelectedRoof = useCallback((nextOrientation?: 'portrait' | 'landscape') => {
    if (!selectedId || !selSpec || !snapshot?.mppImage) return;

    const roof = layers.find(l => l.id === selectedId);
    if (!roof?.points?.length) return;

    // calcolo angolo canvas come in CanvasStage / topbar
    const eavesCanvasDeg = -(roof.azimuthDeg ?? 0) + 90;

    // angolo lato più lungo poligono
    let polyDeg = 0, len2 = -1;
    for (let i = 0; i < roof.points.length; i++) {
      const j = (i + 1) % roof.points.length;
      const dx = roof.points[j].x - roof.points[i].x;
      const dy = roof.points[j].y - roof.points[i].y;
      const L2 = dx * dx + dy * dy;
      if (L2 > len2) { len2 = L2; polyDeg = Math.atan2(dy, dx) * 180 / Math.PI; }
    }
    const norm = (d: number) => { const x = d % 360; return x < 0 ? x + 360 : x; };
    const diff = Math.abs(norm(eavesCanvasDeg - polyDeg));
    const small = diff > 180 ? 360 - diff : diff;
    const baseCanvasDeg = small > 5 ? polyDeg : eavesCanvasDeg;
    const azimuthDeg = baseCanvasDeg + (modules.gridAngleDeg || 0);

    const spacingM = typeof modules.spacingM === 'number' ? modules.spacingM : 0.02; // default interno
    const orientation = (nextOrientation ?? modules.orientation) as 'portrait' | 'landscape';

    // rettangoli autolayout
    const rectsAll = computeAutoLayoutRects({
      polygon: roof.points,
      mppImage: snapshot.mppImage!,
      azimuthDeg,
      orientation,
      panelSizeM: { w: selSpec.widthM, h: selSpec.heightM },
      spacingM,
      marginM: modules.marginM,                // ← rispetta i 20 cm (0.2) di default o quanto scelto
      phaseX: modules.gridPhaseX ?? 0,
      phaseY: modules.gridPhaseY ?? 0,
      anchorX: (modules.gridAnchorX as 'start'|'center'|'end') ?? 'start',
      anchorY: (modules.gridAnchorY as 'start'|'center'|'end') ?? 'start',
      coverageRatio: modules.coverageRatio ?? 1,
    });

    // filtra contro Hindernis (nessuna intersezione, neppure parziale)
    const rects = rectsAll.filter(r =>
      !overlapsReservedRect(
        { cx: r.cx, cy: r.cy, w: r.wPx, h: r.hPx, angleDeg: r.angleDeg },
        selectedId,
        0 // usa 0 px per essere più rigidi sul contatto
      )
    );
    if (!rects.length) { clearPanelsForRoof(selectedId); return; }

    // sostituisci i pannelli esistenti con i nuovi
    clearPanelsForRoof(selectedId);
    const now = Date.now().toString(36);
    const instances = rects.map((r, idx) => ({
      id: `${selectedId}_p_${now}_${idx}`,
      roofId: selectedId,
      cx: r.cx, cy: r.cy,
      wPx: r.wPx, hPx: r.hPx,
      angleDeg: r.angleDeg,
      orientation,
      panelId: selSpec.id,
    }));
    addPanelsForRoof(selectedId, instances);
  }, [
    selectedId, selSpec, snapshot?.mppImage, layers,
    modules.gridAngleDeg, modules.marginM, modules.gridPhaseX, modules.gridPhaseY,
    modules.gridAnchorX, modules.gridAnchorY, modules.coverageRatio,
    modules.spacingM, modules.orientation,
    addPanelsForRoof, clearPanelsForRoof
  ]);

  return (
    <div className="w-full max-w-[240px] space-y-4 p-2">
      {/* === EBENEN (tabella compatta) === */}
      <div className="px-0">
        <div className={`${labelSm} mb-2 text-neutral-600`}>
          Ebenen{layers.length ? ` (${layers.length})` : ''}
        </div>

        {detected?.length > 0 && (
          <div className="mb-2">
            <div className="mb-1 text-[10px] font-medium text-neutral-700">Erkannte Dächer</div>
            <DetectedRoofsImport />
          </div>
        )}

        {layers.length === 0 ? (
          <p className="px-1 py-1 text-[11px] text-neutral-600">Noch keine Ebenen.</p>
        ) : (
          <div className="text-[10px]">
            {/* Header */}
            <div className="grid grid-cols-[36px_36px_56px_60px_18px] items-center px-1 py-1 text-neutral-500">
              <div className="font-medium">D</div>
              <div className="flex items-center gap-1"><MdViewModule className="h-3 w-3" /></div>
              <div className="text-right font-medium">m²</div>
              <div className="text-right font-medium">kWp</div>
              <div />
            </div>

            {/* Righe */}
            <ul className="divide-y divide-neutral-200">
              {layers.map((l, i) => {
                const roofId = l.id;
                const active = selectedId === roofId;

                const count = panels.filter(p => p.roofId === roofId).length;
                const kWp   = selSpec ? (selSpec.wp / 1000) * count : 0;

                return (
                  <li key={roofId}>
                    <div
                      className={[
                        'grid grid-cols-[36px_36px_56px_60px_18px] items-center px-1 py-1 h-6',
                        active ? 'bg-neutral-900 text-white' : 'hover:bg-neutral-50 text-neutral-900'
                      ].join(' ')}
                    >
                      {/* D1/D2... */}
                      <button
                        onClick={() => select(roofId)}
                        title={l.name ?? `D${i + 1}`}
                        aria-label={`Ebene auswählen: ${l.name ?? `D${i + 1}`}`}
                        className="text-left font-semibold"
                      >
                        {`D${i + 1}`}
                      </button>

                      {/* # moduli */}
                      <button
                        onClick={() => select(roofId)}
                        title={`${count} Module`}
                        aria-label={`${count} Module`}
                        className="tabular-nums text-left opacity-80"
                      >
                        {count}
                      </button>

                      {/* m² (solo numero) */}
                      <div className="tabular-nums text-right opacity-80">
                        <RoofAreaInfo points={l.points as Pt[]} mpp={mpp} variant="text" showUnit={false} />
                      </div>

                      {/* kWp (solo numero) */}
                      <div className="tabular-nums text-right opacity-80">
                        {kWp ? kWp.toFixed(2) : '0,00'}
                      </div>

                      {/* elimina layer */}
                      <button
                        onClick={() => delLayer(roofId)}
                        title="Löschen"
                        aria-label={`Ebene löschen: ${l.name ?? `D${i + 1}`}`}
                        className={[
                          'text-[12px] leading-none ms-2',
                          active ? 'opacity-90 hover:opacity-100'
                                 : 'opacity-50 hover:opacity-100 hover:text-red-600'
                        ].join(' ')}
                      >
                        ✕
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      {/* === RANDABSTAND === */}
      <section className="space-y-2">
        <label className={labelSm}>Randabstand</label>
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <input
              type="number"
              step="0.05"
              min="0"
              value={modules.marginM}
              onChange={e => setModules({ marginM: Number(e.target.value) })}
              className={inputBase}
              placeholder="0,30"
              aria-label="Randabstand (m)"
            />
          </div>
          <span className="pb-1 text-[10px] text-neutral-500">m</span>
        </div>
        {/* Abstand tra pannelli rimane 0,02 interno/non visibile */}
      </section>

      {/* === PV MODUL (select spostata qui) === */}
      <section className="space-y-1">
        <label htmlFor="panel-select" className={labelSm}>PV Modul</label>
        <select
          id="panel-select"
          aria-label="Modul wählen"
          value={selectedPanelId}
          onChange={(e) => setSelectedPanel(e.target.value)}
          className={inputBase}
        >
          {catalogPanels.map(p => (
            <option key={p.id} value={p.id}>
              {p.brand} {p.model} — {p.wp} W
            </option>
          ))}
        </select>
      </section>

      {/* === BLINDMODULE (disabled) === */}
      <section className="space-y-1">
        <label className={labelSm}>Blindmodule</label>
        <select disabled className={`${inputBase} cursor-not-allowed bg-neutral-50 text-neutral-400`}>
          <option>Auswählen</option>
        </select>
      </section>

      {/* === UNTERKONSTRUKTION (disabled) === */}
      <section className="space-y-1">
        <label className={labelSm}>Unterkonstruktion</label>
        <select disabled className={`${inputBase} cursor-not-allowed bg-neutral-50 text-neutral-400`}>
          <option>System auswählen</option>
        </select>
      </section>

      {/* === MODULLAYOUT (usa onChange per re-layout immediato) === */}
      <section className="space-y-2">
        <label className={labelSm}>Modullayout</label>
        <OrientationToggle
          onChange={(next) => {
            // appena cambia l'orientamento, rilancia l’autolayout sulla falda selezionata
            relayoutSelectedRoof(next);
          }}
        />
      </section>

      {/* === MODULNEIGUNG (placeholder, disabled) === */}
      <section className="space-y-1">
        <label className={labelSm}>Modulneigung</label>
        <div className="flex items-end gap-2">
          <input
            type="number"
            min={0}
            max={100}
            step={1}
            value={0}
            disabled
            className={`${inputBase} cursor-not-allowed bg-neutral-50 text-neutral-400`}
            aria-label="Modulneigung (%)"
          />
          <span className="pb-1 text-[10px] text-neutral-500">%</span>
        </div>
      </section>

      {/* === WECHSELRICHTER (disabled) === */}
      <section className="space-y-1">
        <label className={labelSm}>Wechselrichter</label>
        <select disabled className={`${inputBase} cursor-not-allowed bg-neutral-50 text-neutral-400`}>
          <option>Auswählen</option>
        </select>
      </section>
    </div>
  );
}
