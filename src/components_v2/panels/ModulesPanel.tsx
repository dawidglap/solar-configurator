// src/components_v2/modules/ModulesPanel.tsx
'use client';

import React, { useCallback } from 'react';
import { usePlannerV2Store } from '../state/plannerV2Store';
import RoofAreaInfo from '../ui/RoofAreaInfo';
import DetectedRoofsImport from '../panels/DetectedRoofsImport';
import { MdViewModule } from 'react-icons/md';
import OrientationToggle from '../layout/TopToolbar/OrientationToggle';
import { LuCompass } from 'react-icons/lu';


// ⬇️ funzioni esistenti per autolayout e filtri ostacoli
import { computeAutoLayoutRects } from '../modules/layout';
import { overlapsReservedRect } from '../zones/utils';
import GridRotationControl from '../modules/GridRotationControl';

type Pt = { x: number; y: number };

const inputBase =
  'w-full h-8 rounded-xl border border-neutral-900 bg-neutral-900/90 px-2 text-[11px] leading-none outline-none ' +
  'focus:ring-1 focus:ring-neutral-400 focus:border-neutral-300 transition';

const labelSm = 'block text-[10px] font-medium uppercase tracking-wide text-neutral-400';


// Piccola icona "tilt": triangolo + arco di angolo
function IconTilt(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      {/* triangolo (stroke corrente) */}
      <path d="M4 18 L18 18 L18 4 Z" fill="none" stroke="currentColor" strokeWidth="1.5" />
      {/* arco dell’angolo in basso a sinistra */}
      <path d="M6 18 A2 2 0 0 1 8 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}


export default function ModulesPanel() {
  // --- Layers / selezione tetto ---
  const layers       = usePlannerV2Store(s => s.layers);
  const selectedId   = usePlannerV2Store(s => s.selectedId);
  const select       = usePlannerV2Store(s => s.select);
  const delLayer     = usePlannerV2Store(s => s.deleteLayer);
  const mpp          = usePlannerV2Store(s => s.snapshot.mppImage);
  const detected     = usePlannerV2Store(s => s.detectedRoofs);
  const step = usePlannerV2Store(s => s.step);


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

// --- Edit inline tilt/az (spostato sotto per evitare TDZ) ---
const updateRoof = usePlannerV2Store(s => s.updateRoof);
const [editing, setEditing] = React.useState<{ id: string; field: 'tilt'|'az' } | null>(null);
const [tempVal, setTempVal] = React.useState<string>('');
const relayoutRef = React.useRef<null | ((next?: 'portrait'|'landscape') => void)>(null);

// blocca i global hotkeys (anche in capture) quando digiti negli input inline
const stopHotkeysCapture = (e: React.KeyboardEvent<HTMLInputElement>) => {
  e.stopPropagation();
  // prova a bloccare eventuali native listeners in capture
  // @ts-ignore
  if (e.nativeEvent?.stopImmediatePropagation) e.nativeEvent.stopImmediatePropagation();
};



const commitInline = React.useCallback((roofId: string, field: 'tilt'|'az') => {
  const raw = Number(tempVal);
  if (!Number.isFinite(raw)) { setEditing(null); return; }

  if (field === 'tilt') {
    const v = Math.max(0, Math.min(60, raw));
    updateRoof(roofId, { tiltDeg: v, source: 'manual' as any });
 } else {
  const display = Math.round(raw);                             // valore inserito in UI (0° = N)
  const stored  = ((display - 180) % 360 + 360) % 360;         // inverti la +180° della UI
  updateRoof(roofId, { azimuthDeg: stored, source: 'manual' as any });
}


  setEditing(null);
  if (selectedId === roofId) relayoutRef.current?.(); // ← usa la ref
}, [tempVal, updateRoof, selectedId]);                 // ← rimosso relayoutSelectedRoof


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

  React.useEffect(() => {
  relayoutRef.current = relayoutSelectedRoof;
}, [relayoutSelectedRoof]);

// --- helpers area corretta per inclinazione ---
const polygonAreaPx2 = (pts: Pt[]) => {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y);
  }
  return Math.abs(a / 2);
};

const roofAreaM2Corrected = React.useCallback((pts: Pt[] | undefined, mpp?: number, tiltDeg?: number) => {
  if (!pts?.length || !mpp) return 0;
  const m2Plan = polygonAreaPx2(pts) * mpp * mpp;          // area in pianta
  if (typeof tiltDeg !== 'number') return m2Plan;
  const tiltRad = (tiltDeg * Math.PI) / 180;
  const cos = Math.max(0.1736, Math.cos(tiltRad));         // clamp (≥ cos 80°) per sicurezza
  return m2Plan / cos;                                      // area di falda (superficie reale)
}, []);



  return (
    <div className="w-full max-w-[240px] space-y-4 p-2 bg-neutral-800 text-white border-l border-neutral-800">

      {/* === EBENEN (tabella compatta) === */}
      <div className="px-0">
        <div className={`${labelSm} mb-2`}>
          Mg.{layers.length ? ` (${layers.length})` : ''}
        </div>

        {detected?.length > 0 && (
          <div className="mb-2">
            <div className="mb-1 text-[10px] font-medium text-neutral-400">Erkannte Dächer</div>
            <DetectedRoofsImport />
          </div>
        )}

        {layers.length === 0 ? (
          <p className="px-1 py-1 text-[11px] text-neutral-400">Noch keine Ebenen.</p>

        ) : (
          <div className="text-[10px]">
{/* Header (7 colonne, griglia aggiornata) */}
<div className="grid grid-cols-[20px_24px_26px_44px_32px_32px_32px] items-center px-1 h-6 text-[10px] text-neutral-400">

  <div className="font-medium">D</div>
  <div className="flex items-center justify-center"><MdViewModule className="h-3 w-3" /></div>
  <div className="text-right font-medium">m²</div>
  <div className="text-right font-medium">kWp</div>
<div className="flex items-center justify-center" title="Neigung (°)">
  <IconTilt className="h-3.5 w-3.5 opacity-90" />
</div>
<div className="flex items-center justify-center" title="Ausrichtung (° vs N)">
  <LuCompass className="h-4 w-4 opacity-90" />
</div>

  <div />
</div>


{/* Righe (monolinea) */}
<ul className="divide-y divide-neutral-500">

  {layers.map((l, i) => {
    const roofId = l.id;
    const active = selectedId === roofId;

    const count = panels.filter(p => p.roofId === roofId).length;
    const kWp   = selSpec ? (selSpec.wp / 1000) * count : 0;

    // helpers compatti
    const norm360 = (d: number) => ((d % 360) + 360) % 360;
    const toCard8 = (az: number) => ['N','NE','E','SE','S','SW','W','NW'][Math.round(norm360(az)/45)%8];
    const fmtDe2 = new Intl.NumberFormat('de-DE', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

    const toCard4 = (az: number) => ['N','E','S','W'][Math.round(norm360(az)/90)%4];
    


    const az = typeof l.azimuthDeg === 'number' ? norm360(l.azimuthDeg) : undefined;
    const tilt = typeof (l as any).tiltDeg === 'number' ? (l as any).tiltDeg : undefined;

    
    const tiltShort = tilt != null ? Math.round(tilt) : undefined;

    const toViewAz = (a: number) => norm360(a + 180); // conversione per la UI
const azView = az != null ? toViewAz(az) : undefined;
const azShort = azView != null ? Math.round(azView) : undefined; // <-- ricalcola qui


    const src = (l as any).source as ('sonnendach'|'manual'|undefined);
    const srcBadge = src === 'sonnendach' ? 'S' : src === 'manual' ? 'M' : '';
const m2Plan  = mpp ? polygonAreaPx2(l.points as Pt[]) * mpp * mpp : 0;
const m2Slope = roofAreaM2Corrected(l.points as Pt[], mpp, tilt);
    return (
      
      <li key={roofId}>
<div
  className={[
    'grid grid-cols-[20px_24px_26px_44px_32px_32px_32px] items-center px-1 h-8',
    active ? 'bg-slate-900 text-white' : 'hover:bg-neutral-900/60 text-neutral-100'
  ].join(' ')}
>

          {/* D1/D2 */}
          <button
            onClick={() => select(roofId)}
            title={l.name ?? `D${i + 1}`}
            aria-label={`Ebene auswählen: ${l.name ?? `D${i + 1}`}`}
            className="text-left font-semibold cursor-pointer"
          >
            {`D${i + 1}`}
          </button>

          {/* # moduli */}
          <button
            onClick={() => select(roofId)}
            title={`${count} Module`}
            aria-label={`${count} Module`}
            className="tabular-nums text-center opacity-80"
          >
            {count}
          </button>

        {/* m² (corretto per inclinazione; tooltip mostra anche la planimetrica) */}
<div className="tabular-nums text-right opacity-80">
  <RoofAreaInfo
    points={l.points as Pt[]}
    mpp={mpp}
    variant="text"
    showUnit={false}
    tiltDeg={(l as any).tiltDeg}
    correctForTilt
  />
</div>


          {/* kWp */}
         <div className="tabular-nums text-right opacity-80">
  {fmtDe2.format(kWp || 0)}
</div>


       {/* tilt (°) */}
<div
  className="tabular-nums text-center opacity-80"
  title="Neigung (°)"
  onClick={() => {
    if (editing?.id === roofId && editing.field === 'tilt') return;
    setEditing({ id: roofId, field: 'tilt' });
    setTempVal(tiltShort != null ? String(tiltShort) : '');
  }}
>
  {(editing?.id === roofId && editing.field === 'tilt') ? (
 <input
  autoFocus
  type="number"
  min={0}
  max={60}
  step={1}
  value={tempVal}
  onChange={e => setTempVal(e.target.value)}
  onBlur={() => commitInline(roofId, 'tilt')}
  data-stop-hotkeys="true"

  onKeyDownCapture={stopHotkeysCapture}            // ⬅️ blocca i listener globali
  onKeyDown={(e) => {
    // gestiamo noi i tasti principali
    if (e.key === 'Enter') { commitInline(roofId, 'tilt'); return; }
    if (e.key === 'Escape') { setEditing(null); return; }
    // Delete / Backspace: svuota il campo ma NON propagare
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      e.stopPropagation();
      // @ts-ignore
      if (e.nativeEvent?.stopImmediatePropagation) e.nativeEvent.stopImmediatePropagation();
      setTempVal('');
      return;
    }
  }}
  className="w-full h-5 text-[10px] text-center bg-transparent outline-none border-b border-current/30"
  style={{ padding: 0 }}
/>

  ) : (
    <span>{tiltShort != null ? `${tiltShort}°` : '—'}</span>
  )}
</div>

{/* azimuth (°) – UI mostra (interno + 180) */}
<div
  className="tabular-nums text-center opacity-80"
  title={azView != null ? `${Math.round(azView)}° ${toCard8(azView)}` : 'Ausrichtung'}
  onClick={() => {
    if (editing?.id === roofId && editing.field === 'az') return;
    setEditing({ id: roofId, field: 'az' });
    setTempVal(azShort != null ? String(azShort) : '');
  }}
>
  {(editing?.id === roofId && editing.field === 'az') ? (
<input
  autoFocus
  type="number"
  min={0}
  max={359}
  step={1}
  value={tempVal}
  onChange={e => setTempVal(e.target.value)}
  onBlur={() => commitInline(roofId, 'az')}
  data-stop-hotkeys="true"

  onKeyDownCapture={stopHotkeysCapture}            // ⬅️ blocca i listener globali
  onKeyDown={(e) => {
    if (e.key === 'Enter') { commitInline(roofId, 'az'); return; }
    if (e.key === 'Escape') { setEditing(null); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      e.stopPropagation();
      // @ts-ignore
      if (e.nativeEvent?.stopImmediatePropagation) e.nativeEvent.stopImmediatePropagation();
      setTempVal('');
      return;
    }
  }}
  className="w-full h-5 text-[10px] text-center bg-transparent outline-none border-b border-current/30"
  style={{ padding: 0 }}
/>

  ) : (
    
<span>
  {azShort != null
    ? `${toCard8(azShort)} ${azShort}°`
    : '—'}
</span>


  )}
</div>



          {/* elimina / fonte */}
          <div className="flex items-center justify-end  gap-1">
            {srcBadge && (
              <span
                className={[
                  'inline-flex  h-[14px] min-w-[14px] items-center justify-center rounded-sm px-[4px] text-[9px]',
                  active ? 'bg-blue-800 text-white' : 'bg-neutral-800 text-neutral-300'

                ].join(' ')}
                title={srcBadge === 'S' ? 'Sonnendach' : 'Manuell'}
              >
                {srcBadge}
              </span>
            )}
     <button
  disabled={step === 'modules'}
  onClick={() => {
    if (step === 'modules') return; // ⛔️ blocco in UI
    delLayer(roofId);
  }}
  title={step === 'modules' ? 'Löschen nur im Schritt „Gebäude“' : 'Löschen'}
  aria-label={`Ebene löschen: ${l.name ?? `D${i + 1}`}`}
  className={[
    'text-[12px] leading-none',
    step === 'modules'
      ? 'opacity-30 cursor-not-allowed'
      : (active ? 'opacity-90 hover:opacity-100'
                : 'opacity-60 hover:opacity-100 hover:text-red-400')
  ].join(' ')}
>
  ✕
</button>

          </div>
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
          <span className="pb-1 text-[10px] text-neutral-400">m</span>
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
        <select disabled className={`${inputBase} cursor-not-allowed bg-neutral-900 text-neutral-500 border-neutral-800`}>
          <option>Auswählen</option>
        </select>
      </section>

      {/* === UNTERKONSTRUKTION (disabled) === */}
      <section className="space-y-1">
        <label className={labelSm}>Unterkonstruktion</label>
        <select disabled className={`${inputBase} cursor-not-allowed bg-neutral-900 text-neutral-500 border-neutral-800`}>
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

         <section className="space-y-2">
        <GridRotationControl />
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
           className={`${inputBase} cursor-not-allowed bg-neutral-900 text-neutral-500 border-neutral-800`}
            aria-label="Modulneigung (%)"
          />
          <span className="pb-1 text-[10px] text-neutral-400">%</span>
        </div>
      </section>

      {/* === WECHSELRICHTER (disabled) === */}
      <section className="space-y-1">
        <label className={labelSm}>Wechselrichter</label>
        <select disabled className={`${inputBase} cursor-not-allowed bg-neutral-900 text-neutral-500 border-neutral-800`}>
          <option>Auswählen</option>
        </select>
      </section>
    </div>
  );
}
