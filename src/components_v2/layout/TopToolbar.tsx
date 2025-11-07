'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePlannerV2Store } from '../state/plannerV2Store';
import { history } from '../state/history';
import OrientationToggle from './TopToolbar/OrientationToggle';

import { MousePointer, RotateCcw, RotateCw } from 'lucide-react';

// NUOVE icone topbar (1–10) da react-icons
import { TbShape3, TbDropletHalf2Filled } from 'react-icons/tb';
import { MdOutlineTexture, MdViewModule, MdBorderStyle } from 'react-icons/md';
import { AiOutlineBorderHorizontal } from 'react-icons/ai';
import { LuSnowflake, LuShapes } from 'react-icons/lu';
import { FaRegTrashAlt } from 'react-icons/fa';
import { IoIosSave } from 'react-icons/io';

// ⬇️ IMPORT FUNZIONI DALLA LOGICA ESISTENTE (ADEGUA PATH SE SERVE)
import { computeAutoLayoutRects } from '../modules/layout';

import { overlapsReservedRect, overlapsSnowGuard } from '../zones/utils';

import ProjectStatsBar from '../ui/ProjectStatsBar';
import TopbarAddressSearch from './TopbarAddressSearch';

/* ───────────────────── Keycaps ───────────────────── */
function Keycap({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex h-5 min-w-[20px] z-[101] items-center justify-center rounded-[6px] border border-neutral-700/70 bg-neutral-800 px-1 text-[10px] font-medium leading-none text-white/90 shadow-[0_1px_0_rgba(255,255,255,0.06)_inset,0_1px_6px_rgba(0,0,0,0.4)]">
      {children}
    </span>
  );
}

/* ───────────────────── Tooltip in Portal ───────────────────── */
type TooltipPos = { x: number; y: number };

function PortalTooltip({
  visible, pos, label, keys,
}: {
  visible: boolean; pos: TooltipPos | null; label: string; keys: (string | React.ReactNode)[];
}) {
  if (typeof window === 'undefined') return null;
  if (!visible || !pos) return null;
  return createPortal(
    <div
      role="tooltip"
      style={{ position: 'fixed', left: pos.x, top: pos.y, transform: 'translate(-50%, 0)', zIndex: 100000, pointerEvents: 'none' }}
      className="rounded-md border border-neutral-800 bg-neutral-900/98 px-2.5 py-2 text-xs text-white shadow-xl whitespace-nowrap"
    >
      <div className="mb-1 font-medium">{label}</div>
      <div className="flex items-center justify-center gap-1">
        {keys.map((k, i) => (<Keycap key={i}>{k}</Keycap>))}
      </div>
    </div>,
    document.body
  );
}

/** Accetta sia RefObject che MutableRefObject */
type AnyRef<T extends HTMLElement> = React.RefObject<T> | React.MutableRefObject<T | null>;
function useBottomTooltip<T extends HTMLElement>(triggerRef: AnyRef<T>) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState<TooltipPos | null>(null);
  const compute = () => {
    const el = triggerRef.current as T | null;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ x: r.left + r.width / 2, y: r.bottom + 8 });
  };
  const show = () => { compute(); setVisible(true); };
  const hide = () => setVisible(false);
  useEffect(() => {
    if (!visible) return;
    const onScroll = () => compute();
    const onResize = () => compute();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [visible]);
  return { visible, pos, show, hide };
}

/* ───────────────────────── Toolbar ───────────────────────── */
export default function TopToolbar() {
  // Stato globale
  const step          = usePlannerV2Store((s) => s.step);   // 'building' | 'modules' | ...
  const setStep       = usePlannerV2Store((s) => s.setStep);
  const tool          = usePlannerV2Store((s) => s.tool);
  const setTool       = usePlannerV2Store((s) => s.setTool);

  // catalogo moduli (TopToolbar)
  const catalogPanels    = usePlannerV2Store(s => s.catalogPanels);
  const selectedPanelId  = usePlannerV2Store(s => s.selectedPanelId);
  const setSelectedPanel = usePlannerV2Store(s => s.setSelectedPanel);
  const clearPanelsForRoof = usePlannerV2Store(s => s.clearPanelsForRoof);


  // dati necessari per "In Module umwandeln"
  const layers              = usePlannerV2Store(s => s.layers);
  const selectedId          = usePlannerV2Store(s => s.selectedId);
  const modules             = usePlannerV2Store(s => s.modules);
  const setModules          = usePlannerV2Store(s => s.setModules);
  const panels              = usePlannerV2Store(s => s.panels);
  const addPanelsForRoof    = usePlannerV2Store(s => s.addPanelsForRoof);
  const snapshot            = usePlannerV2Store(s => s.snapshot);
  const selSpec             = usePlannerV2Store(s => s.getSelectedPanel());

  const isMac = useMemo(
    () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform),
    []
  );
  const mod = isMac ? '⌘' : 'Ctrl';

  // Cmd/Ctrl+S → Save (placeholder)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || (t as any).isContentEditable)) return;
      const s = e.key?.toLowerCase() === 's';
      const saveCombo = (isMac && e.metaKey && s) || (!isMac && e.ctrlKey && s);
      if (saveCombo) { e.preventDefault(); handleSave(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isMac]);

  const handleSave = () => { console.log('[Planner] Save'); alert('Speichern (kommt später)'); };
  const handleUndo = () => { history.undo(); };
  const handleRedo = () => { history.redo(); };

  const [canUndo, setCanUndo] = useState(history.canUndo());
  const [canRedo, setCanRedo] = useState(history.canRedo());
  useEffect(() => {
    const unsub = history.subscribe(() => {
      setCanUndo(history.canUndo());
      setCanRedo(history.canRedo());
    }) as () => boolean;
    return () => { void unsub(); };
  }, []);

/* ───────────────── Bottoni icona+tooltip (portal) ───────────────── */
function ActionBtn({
  active, onClick, Icon, label, disabled, tooltipLabel, tooltipKeys,
}: {
  active?: boolean;
  onClick: () => void;
  Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  label?: string; // non usato (icon-only)
  disabled?: boolean;
  tooltipLabel?: string;
  tooltipKeys?: (string | React.ReactNode)[];
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const { visible, pos, show, hide } = useBottomTooltip(ref);

  // Base: solo icona, nessun cerchio visibile
  const base =
    "inline-flex h-8 w-8 items-center justify-center rounded-full " +
    "transition ring-0 border border-transparent " +
    "focus:outline-none focus:ring-2 focus:ring-white/10";

  // Inattivo cliccabile: icona bianca; il cerchio appare SOLO su hover
  const clickable =
    "text-white hover:bg-neutral-800/70 hover:border-neutral-700";

  // Attivo: “icona accesa dentro un cerchio”
  const activeCls =
    "bg-white text-neutral-900 border-white shadow " +
    "hover:bg-white hover:border-white";

  // Disabled: grigio, niente hover
  const disabledCls =
    "text-neutral-500 opacity-60 cursor-not-allowed";

  const cls = [
    base,
    disabled ? disabledCls : active ? activeCls : clickable,
  ].join(" ");

  return (
    <>
      <button
        ref={ref}
        type="button"
        onMouseEnter={tooltipLabel ? show : undefined}
        onMouseLeave={tooltipLabel ? hide : undefined}
        onFocus={tooltipLabel ? show : undefined}
        onBlur={tooltipLabel ? hide : undefined}
        onClick={onClick}
        aria-pressed={!!active}
        disabled={disabled}
        className={cls}
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
      </button>

      {tooltipLabel && tooltipKeys && (
        <PortalTooltip visible={visible} pos={pos} label={tooltipLabel} keys={tooltipKeys} />
      )}
    </>
  );
}

/* ─────────── Bottoni icon-only (Undo/Redo) con stesso stile ─────────── */
function IconOnlyBtn({
  onClick, Icon, ariaLabel, tooltipLabel, tooltipKeys, disabled,
}: {
  onClick: () => void;
  Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  ariaLabel: string;
  tooltipLabel: string;
  tooltipKeys: (string | React.ReactNode)[];
  disabled?: boolean;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const { visible, pos, show, hide } = useBottomTooltip(ref);

  const base =
    "inline-flex h-8 w-8 items-center justify-center rounded-full " +
    "transition ring-0 border border-transparent " +
    "focus:outline-none focus:ring-2 focus:ring-white/10";

  const clickable =
    "text-white hover:bg-neutral-800/70 hover:border-neutral-700";

  const disabledCls =
    "text-neutral-500 opacity-60 cursor-not-allowed";

  const cls = [base, disabled ? disabledCls : clickable].join(" ");

  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-label={ariaLabel}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={onClick}
        disabled={disabled}
        className={cls}
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
      </button>
      <PortalTooltip visible={visible} pos={pos} label={tooltipLabel} keys={tooltipKeys} />
    </>
  );
}


  /* UI unificata: tutti i tool sempre visibili (attivi logici via step auto-switch) */
 /* Tool attivi solo nello step corrente */
const canUseBuildingTools = step === 'building';
const canUseModulesTools  = step === 'modules';



/* ── Nessun auto-switch: il tool cambia solo se lo step corrente lo consente ── */
function go(t: any) {
  setTool(t);
}


function ensureModulesPrereqsForU(): boolean {
  const st = usePlannerV2Store.getState();
  if (st.step !== 'modules') { alert('Du musst dich im Schritt „Module“ befinden.'); return false; }
  if (!st.selectedId)        { alert('Wähle zuerst eine Dachfläche (Roof) aus, bevor du U verwendest.'); return false; }
  if (!st.getSelectedPanel()) { alert('Wähle ein Solarmodell aus dem Katalog aus.'); return false; }
  if (!st.snapshot?.mppImage) { alert('mppImage fehlt im Snapshot (Maße können nicht berechnet werden).'); return false; }
  return true;
}

function ensureModulesPrereqsForF(): boolean {
  const st = usePlannerV2Store.getState();
  if (st.step !== 'modules') { alert('Du musst dich im Schritt „Module“ befinden.'); return false; }
  if (!st.selectedId)        { alert('Wähle zuerst eine Dachfläche (Roof) aus, bevor du eine Fläche füllst.'); return false; }
  return true;
}



  /* ── Handler: In Module umwandeln (icona #3) ─────────────────────── */
  function handleConvertToModules() {
    // Porta l'interfaccia in "modules" (coerente con comportamiento atteso)
    if (step !== 'modules') setStep('modules' as any);

    if (!selectedId || !selSpec || !snapshot?.mppImage) {
      // nessun tetto selezionato o modulo selezionato o mpp mancante
      return;
    }

    const roof = layers.find(l => l.id === selectedId);
    if (!roof?.points?.length) return;

    // === angolo canvas (come ModulesPanel) ===
    const eavesCanvasDeg = -(roof.azimuthDeg ?? 0) + 90;

    // angolo del lato più lungo del poligono
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

    // === filtro Hindernisse

// === filtro: prima reserved, poi linee neve

const rects = rectsAll.filter((r) => {
  // formato per le zone riservate
  const rectForReserved = {
    cx: r.cx,
    cy: r.cy,
    w: r.wPx,
    h: r.hPx,
    angleDeg: r.angleDeg,
  };

  // formato per le linee neve
  const rectForSnow = {
    cx: r.cx,
    cy: r.cy,
    wPx: r.wPx,
    hPx: r.hPx,
    angleDeg: r.angleDeg,
  };

  // 1) se tocca una zona riservata → scarta
  if (overlapsReservedRect(rectForReserved, selectedId, 1)) {
    return false;
  }

  // 2) se tocca una linea neve → scarta
  if (overlapsSnowGuard(rectForSnow, selectedId, 1)) {
    return false;
  }

  return true;
});




    if (!rects.length) return;

    // === crea pannelli reali
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

    // sostituisci i moduli esistenti della falda selezionata
clearPanelsForRoof(selectedId);
addPanelsForRoof(selectedId, instances);


    

    // spegni il raster dopo la conversione (come da brief)
    if (modules.showGrid) setModules({ showGrid: false });

    // attiva lo strumento di selezione dopo il commit (facoltativo)
    setTool('select' as any);
  }

  return (
    <div
      className="flex h-10 items-center justify-between gap-2 px-2 overflow-x-auto overscroll-x-contain scrollbar-thin scrollbar-thumb-transparent scrollbar-track-transparent bg-neutral-800/90 text-white "

    
    >
      {/* SX: sequenza unica — Auswählen + icone 1–6 + controlli moduli */}
      <div className=" flex min-w-0 items-center gap-2">
        <TopbarAddressSearch />
  {/* Auswählen → SEMPRE attivo */}
<ActionBtn
  active={tool === 'select'}
  onClick={() => go('select' as any)}
  Icon={MousePointer}
  label=""
  tooltipLabel="Auswählen"
  tooltipKeys={['A']}
/>

{/* Gebäude-only */}
<ActionBtn
  active={tool === 'draw-roof'}
  onClick={() => go('draw-roof' as any)}
  Icon={TbShape3}
  label=""
  disabled={!canUseBuildingTools}
  tooltipLabel="Dach zeichnen"
  tooltipKeys={['D']}
/>

<ActionBtn
  active={tool === 'draw-reserved'}
  onClick={() => go('draw-reserved' as any)}
  Icon={MdOutlineTexture}
  label=""
  disabled={!canUseBuildingTools}
  tooltipLabel="Hindernis / Reservierte Zone"
  tooltipKeys={['H']}
/>

<ActionBtn
  active={tool === 'draw-rect'}
  onClick={() => go('draw-rect' as any)}
  Icon={AiOutlineBorderHorizontal}
  label=""
  disabled={!canUseBuildingTools}
  tooltipLabel="Rechteck zeichnen"
  tooltipKeys={['R']}
/>

{/* Module-only */}
<ActionBtn
  onClick={() => { if (ensureModulesPrereqsForU()) handleConvertToModules(); }}
  Icon={MdViewModule}
  label=""
  disabled={!canUseModulesTools}
  tooltipLabel="Autolayout umwandeln"
  tooltipKeys={['U']}
/>


<ActionBtn
  active={tool === 'fill-area'}
  onClick={() => { if (ensureModulesPrereqsForF()) setTool('fill-area' as any); }}
  Icon={MdBorderStyle}
  label=""
  disabled={!canUseModulesTools}
  tooltipLabel="Fläche füllen"
  tooltipKeys={['F']}
/>


        <div className="mx-1 h-6 w-px bg-neutral-600" />

        {/* 6) Schneefang (linea) — placeholder */}
     {/* Schneefang / Protezione neve */}
<ActionBtn
  active={tool === 'draw-snow-guard'}
  onClick={() => {
    if (canUseBuildingTools) {
      setTool('draw-snow-guard' as any);
    }
  }}
  Icon={LuSnowflake}
  label=""
  disabled={!canUseBuildingTools}
  tooltipLabel="Schneefang / Protezione neve"
  tooltipKeys={['S']}
/>


        {/* Controls specifici moduli (sempre visibili; clic portarli in 'modules') */}
        {/* <div className="mx-1 h-6 w-px bg-neutral-200" />

        <div
          aria-disabled={!canUseModulesTools}
          className={!canUseModulesTools ? 'opacity-50 pointer-events-none' : ''}
          onPointerDown={() => { if (step !== 'modules') setStep('modules' as any); }}
        >
          <OrientationToggle />
        </div>

        <div className="mx-1 h-6 w-px bg-neutral-200" /> */}

        {/* <label htmlFor="topbar-panel-select" className="sr-only">Modul wählen</label>
        <select
          id="topbar-panel-select"
          aria-label="Modul wählen"
          value={selectedPanelId}
          onChange={(e) => { if (step !== 'modules') setStep('modules' as any); setSelectedPanel(e.target.value); }}
          disabled={!canUseModulesTools}
          className={[
            "h-8 min-w-[220px] max-w-[320px] rounded-full border border-neutral-200 bg-white/80 px-2 text-xs text-neutral-900 hover:bg-neutral-100 focus:outline-none focus:ring-2 focus:ring-black/10",
            !canUseModulesTools ? "opacity-50 cursor-not-allowed" : ""
          ].join(' ')}
        >
          {catalogPanels.map(p => (
            <option key={p.id} value={p.id}>
              {p.brand} {p.model} — {p.wp} W
            </option>
          ))}
        </select> */}
      </div>

      {/* DESTRA: 7–10 compatti + Undo/Redo */}
      <div className="flex items-center ms-auto gap-1">
        {/* 7) Neue Variante — placeholder */}
        <ActionBtn
          onClick={() => {}}
          Icon={LuShapes}
          label=""
          disabled
          tooltipLabel="Neue Variante (in arrivo)"
          tooltipKeys={[]}
        />
        {/* 8) Trasparenza — placeholder */}
        <ActionBtn
          onClick={() => {}}
          Icon={TbDropletHalf2Filled}
          label=""
          disabled
          tooltipLabel="Transparenz (in arrivo)"
          tooltipKeys={[]}
        />
        {/* 9) Leeren — placeholder */}
        <ActionBtn
          onClick={() => {}}
          Icon={FaRegTrashAlt}
          label=""
          disabled
          tooltipLabel="Leeren (in arrivo)"
          tooltipKeys={[]}
        />
        {/* 10) Speichern — placeholder */}
        <ActionBtn
          onClick={() => {}}
          Icon={IoIosSave}
          label=""
          disabled
          tooltipLabel="Speichern (in arrivo)"
          tooltipKeys={[mod, 'S']}
        />
      </div>

      <div className="mx-1 h-6 w-px bg-neutral-600" />

      {/* DX: Undo/Redo (icon-only) */}
      <div className="flex shrink-0 items-center gap-2 pl-2">
        <IconOnlyBtn
          onClick={handleUndo}
          Icon={RotateCcw}
          ariaLabel="Rückgängig"
          tooltipLabel="Rückgängig"
          tooltipKeys={isMac ? ['⌘', 'Z'] : ['Ctrl', 'Z']}
          disabled={!canUndo}
        />
        <IconOnlyBtn
          onClick={handleRedo}
          Icon={RotateCw}
          ariaLabel="Wiederholen"
          tooltipLabel="Wiederholen"
          tooltipKeys={isMac ? ['⇧', '⌘', 'Z'] : ['Ctrl', 'Y']}
          disabled={!canRedo}
        />
      <div className="mx-1 h-6 w-px bg-neutral-600" />

        <ProjectStatsBar />
      </div>
    </div>
  );
}
