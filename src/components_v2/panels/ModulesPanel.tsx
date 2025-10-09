// src/components_v2/modules/ModulesPanel.tsx
'use client';

import React from 'react';
import { usePlannerV2Store } from '../state/plannerV2Store';
import RoofAreaInfo from '../ui/RoofAreaInfo';
import DetectedRoofsImport from '../panels/DetectedRoofsImport';

// ⬇️ necessari per il bottone "In Module umwandeln"
import { computeAutoLayoutRects } from '../modules/layout';   // <-- adegua il path se diverso nel tuo progetto
import { overlapsReservedRect } from '../zones/utils'       // <-- adegua il path se diverso

type Pt = { x: number; y: number };

const inputBase =
  'w-full h-7 rounded-xl border border-neutral-200 bg-neutral-50/90 px-2 text-[11px] leading-none outline-none ' +
  'focus:ring-1 focus:ring-neutral-400 focus:border-neutral-300 transition';

const btnBase  = 'w-full h-8 rounded-full text-[11px] font-medium transition border';
const btnGhost = 'bg-white text-neutral-900 border-neutral-200 hover:bg-neutral-50 disabled:text-neutral-400 disabled:cursor-not-allowed';
const chip     = 'h-8 rounded-full text-[11px] font-medium transition border px-3'; // ⬅️ per il toggle Raster

export default function ModulesPanel() {

  // helper locali identici alla CanvasStage
const radToDeg = (r: number) => (r * 180) / Math.PI;
const angleDiffDeg = (a: number, b: number) => {
  const norm = (d: number) => { const x = d % 360; return x < 0 ? x + 360 : x; };
  let d = Math.abs(norm(a) - norm(b));
  return d > 180 ? 360 - d : d;
};
const longestEdgeAngleDeg = (pts: {x:number;y:number}[]) => {
  if (!pts || pts.length < 2) return 0;
  let best = 0, maxLen2 = -1;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    const dx = pts[j].x - pts[i].x, dy = pts[j].y - pts[i].y;
    const len2 = dx*dx + dy*dy;
    if (len2 > maxLen2) { maxLen2 = len2; best = Math.atan2(dy, dx); }
  }
  return radToDeg(best);
};
  // --- Stato per lista livelli (ex LeftLayersOverlay) ---
  const layers     = usePlannerV2Store(s => s.layers);
  const selectedId = usePlannerV2Store(s => s.selectedId);
  const select     = usePlannerV2Store(s => s.select);
  const del        = usePlannerV2Store(s => s.deleteLayer);
  const mpp        = usePlannerV2Store(s => s.snapshot.mppImage);
  const detected   = usePlannerV2Store(s => s.detectedRoofs);

  // --- Stato pannelli/moduli ---
  const modules            = usePlannerV2Store(s => s.modules);
  const setModules         = usePlannerV2Store(s => s.setModules);
  const panels             = usePlannerV2Store(s => s.panels);
  const clearPanelsForRoof = usePlannerV2Store(s => s.clearPanelsForRoof);
  const selSpec            = usePlannerV2Store(s => s.getSelectedPanel());

  // ⬇️ per il click: servono snapshot completo, gridMods (alias m) e addPanelsForRoof
  const snapshot        = usePlannerV2Store(s => s.snapshot);
  
  const addPanelsForRoof = usePlannerV2Store(s => s.addPanelsForRoof);
  const gridAngleDeg = usePlannerV2Store(s => s.modules.gridAngleDeg);

  const panelsOnRoof = panels.filter(p => p.roofId === selectedId);
  const count  = panelsOnRoof.length;
  const areaM2 = (() => {
    if (!mpp) return 0;
    let a = 0;
    for (const p of panelsOnRoof) a += (p.wPx * p.hPx) * (mpp * mpp);
    return a;
  })();
  const kWp = selSpec ? (selSpec.wp / 1000) * count : 0;
  const disabled = !selectedId;

  return (
    <div className="w-full max-w-[240px] space-y-3 p-2 ">
      {/* === EBENEN (inline, sempre visibile) === */}
      <section className="rounded-2xl  border border-neutral-200 bg-white/85 backdrop-blur-sm shadow-sm">
        <div className="border-b bg-white/80 rounded-t-2xl px-3 py-2">
          <h3 className="text-xs font-semibold tracking-tight">
            Ebenen{layers.length ? ` (${layers.length})` : ''}
          </h3>
        </div>

        <div className="p-3 space-y-3">
          {/* Erkannte Dächer (se presenti) */}
          {detected?.length > 0 && (
            <div className="rounded-lg border border-neutral-200 bg-white px-2.5 py-2">
              <h4 className="mb-1 text-[11px] font-semibold text-neutral-900">Erkannte Dächer</h4>
              <DetectedRoofsImport />
            </div>
          )}

          {/* Lista livelli */}
          {layers.length === 0 ? (
            <p className="text-xs text-neutral-600">Noch keine Ebenen.</p>
          ) : (
            <ul className="flex flex-col gap-1 pr-1">
              {layers.map((l) => {
                const active = selectedId === l.id;
                return (
                  <li key={l.id}>
                    <div
                      className={[
                        'flex items-center justify-between rounded-md border px-2 py-[2px] text-xs',
                        active
                          ? 'bg-black text-white border-black'
                          : 'bg-white text-neutral-900 border-neutral-200 hover:bg-neutral-50',
                      ].join(' ')}
                    >
                      <button
                        onClick={() => select(l.id)}
                        className="min-w-0 flex-1 truncate text-left"
                        title={l.name}
                        aria-label={`Ebene auswählen: ${l.name}`}
                      >
                        {l.name}
                      </button>

                      <RoofAreaInfo points={l.points as Pt[]} mpp={mpp} />

                      <button
                        onClick={() => del(l.id)}
                        className={`ml-2 ${active ? 'opacity-90 hover:opacity-100' : 'text-neutral-400 hover:text-red-600'}`}
                        title="Löschen"
                        aria-label={`Ebene löschen: ${l.name}`}
                      >
                        ✕
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      <div className='w-full border-b-1 border-neutral-200'></div>

      {/* === RASTER === */}
      <section className="space-y-2">
        <label className="block text-[10px] font-medium uppercase tracking-wide text-neutral-600">
          Raster
        </label>
        <div className="flex gap-2">
          <button
            onClick={() => setModules({ showGrid: !modules.showGrid })}
            className={[
              'flex-1', chip,
              modules.showGrid
                ? 'bg-neutral-900 text-white border-neutral-900'
                : 'bg-white text-neutral-900 border-neutral-200 hover:bg-neutral-50'
            ].join(' ')}
            title="Raster ein/aus"
            aria-pressed={modules.showGrid}
          >
            {modules.showGrid ? 'Raster: AN' : 'Raster: AUS'}
          </button>
        </div>

        {/* In Module umwandeln */}
        <button
          disabled={disabled}


onClick={() => {
  if (!selectedId || !selSpec || !snapshot.mppImage) return;

  const roof = layers.find(l => l.id === selectedId);
  if (!roof?.points?.length) return;

  // === angolo identico a CanvasStage (= a ModulesPreview) ===
  const eavesCanvasDeg = -(roof.azimuthDeg ?? 0) + 90;
  const polyDeg = (() => {
    let best = 0, len2 = -1;
    for (let i = 0; i < roof.points.length; i++) {
      const j = (i + 1) % roof.points.length;
      const dx = roof.points[j].x - roof.points[i].x;
      const dy = roof.points[j].y - roof.points[i].y;
      const L2 = dx * dx + dy * dy;
      if (L2 > len2) { len2 = L2; best = Math.atan2(dy, dx) * 180 / Math.PI; }
    }
    return best;
  })();
  const diff = Math.abs(((eavesCanvasDeg - polyDeg) % 360 + 360) % 360);
  const baseCanvasDeg = (diff > 180 ? 360 - diff : diff) > 5 ? polyDeg : eavesCanvasDeg;
  const azimuthDeg = baseCanvasDeg + (modules.gridAngleDeg || 0);

  // === rettangoli come la preview ===
  const rectsAll = computeAutoLayoutRects({
    polygon: roof.points,
    mppImage: snapshot.mppImage!,
    azimuthDeg,
    orientation: modules.orientation,
    panelSizeM: { w: selSpec.widthM, h: selSpec.heightM },
    spacingM: modules.spacingM,
    marginM:  modules.marginM,
    phaseX:   modules.gridPhaseX ?? 0,
    phaseY:   modules.gridPhaseY ?? 0,
    anchorX: (modules.gridAnchorX as 'start'|'center'|'end') ?? 'start',
    anchorY: (modules.gridAnchorY as 'start'|'center'|'end') ?? 'start',
    coverageRatio: modules.coverageRatio ?? 1,
  });

  // === filtro Hindernisse: USA overlapsReservedRect (come ModulesPreview) ===
  const rects = rectsAll.filter(r =>
    !overlapsReservedRect(
      { cx: r.cx, cy: r.cy, w: r.wPx, h: r.hPx, angleDeg: r.angleDeg },
      selectedId,
      1 // epsilon px (stesso valore della preview)
    )
  );
  if (!rects.length) return;

  // === crea pannelli reali (stessi campi usati in PanelsLayer) ===
  const now = Date.now().toString(36);
  const instances = rects.map((r, idx) => ({
    id: `${selectedId}_p_${now}_${idx}`,
    roofId: selectedId,
    cx: r.cx, cy: r.cy,
    wPx: r.wPx, hPx: r.hPx,
    angleDeg: r.angleDeg,
    orientation: modules.orientation,
    panelId: selSpec.id,
  }));

  addPanelsForRoof(selectedId, instances);
}}







          className={[
            'w-full rounded-full px-3 py-2 text-[13px] font-semibold border transition-colors',
            disabled ? 'bg-white text-neutral-400 border-neutral-200 cursor-not-allowed'
                     : 'bg-white text-neutral-900 border-neutral-200 hover:bg-neutral-50'
          ].join(' ')}
        >
          In Module umwandeln
        </button>
      </section>

      {/* === EIGENSCHAFTEN / ABSTÄNDE === */}
      <fieldset className="space-y-1">
        <label className="block text-[10px] font-medium uppercase tracking-wide text-neutral-600">
          Abstände
        </label>

        <div className="space-y-2">
          {/* Abstand */}
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-neutral-600">Abstand</span>
              <span className="text-[10px] text-neutral-400">m</span>
            </div>
            <input
              type="number"
              step="0.01"
              min="0"
              value={modules.spacingM}
              onChange={e => setModules({ spacingM: Number(e.target.value) })}
              className={inputBase}
              placeholder="0,02"
              aria-label="Abstand (m)"
            />
            <p className="mt-1 text-[10px] text-neutral-400">Standard: 0,02</p>
          </div>

          {/* Randabstand */}
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-neutral-600">Randabstand</span>
              <span className="text-[10px] text-neutral-400">m</span>
            </div>
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
            <p className="mt-1 text-[10px] text-neutral-400">Beispiel: 0,30</p>
          </div>
        </div>
      </fieldset>

      {/* Azioni */}
      <div className="space-y-2">
        <button
          disabled={disabled || panelsOnRoof.length === 0}
          onClick={() => selectedId && clearPanelsForRoof(selectedId)}
          className={[btnBase, btnGhost].join(' ')}
        >
          Fläche leeren
        </button>
      </div>

      {/* KPI */}
      <div className="rounded-xl border border-neutral-200 bg-white/70 p-2">
        <Row label="Module" value={String(count)} />
        <Row label="Fläche" value={`${areaM2 ? areaM2.toFixed(1) : '0,0'} m²`} />
        <Row label="Leistung" value={`${kWp ? kWp.toFixed(2) : '0,00'} kWp`} />
      </div>

      <p className="text-[10px] text-neutral-400 text-center">
        Änderungen werden sofort übernommen
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-[11px] text-neutral-600">{label}</span>
      <span className="text-[11px] font-semibold tabular-nums">{value}</span>
    </div>
  );
}
