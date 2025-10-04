'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePlannerV2Store } from '../state/plannerV2Store';
import {
  Save,
  MousePointer,
  PenLine,
  Square,
  ShieldAlert,
  Grid2x2,
  RotateCcw,
  RotateCw,
} from 'lucide-react';
import { history } from '../state/history';
import OrientationToggle from './TopToolbar/OrientationToggle';




/* ───────────────────── Keycaps ───────────────────── */

function Keycap({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="
        inline-flex h-5 min-w-[20px] items-center justify-center
        rounded-[6px] border border-neutral-700/70 bg-neutral-800
        px-1 text-[10px] font-medium leading-none text-white/90
        shadow-[0_1px_0_rgba(255,255,255,0.06)_inset,0_1px_6px_rgba(0,0,0,0.4)]
      "
    >
      {children}
    </span>
  );
}

/* ───────────────────── Tooltip in Portal ───────────────────── */

type TooltipPos = { x: number; y: number };

function PortalTooltip({
  visible,
  pos,
  label,
  keys,
}: {
  visible: boolean;
  pos: TooltipPos | null;
  label: string;
  keys: (string | React.ReactNode)[];
}) {
  if (typeof window === 'undefined') return null;
  if (!visible || !pos) return null;

  return createPortal(
    <div
      role="tooltip"
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        transform: 'translate(-50%, 0)', // centrato sotto al trigger
        zIndex: 100000,
        pointerEvents: 'none',
      }}
      className="
        rounded-md border border-neutral-800
        bg-neutral-900/98 px-2.5 py-2 text-xs text-white shadow-xl whitespace-nowrap
      "
    >
      <div className="mb-1 font-medium">{label}</div>
      <div className="flex items-center justify-center gap-1">
        {keys.map((k, i) => (
          <Keycap key={i}>{k}</Keycap>
        ))}
      </div>
    </div>,
    document.body
  );
}

/** Accetta sia RefObject che MutableRefObject con T coerente (HTMLButtonElement ecc.) */
type AnyRef<T extends HTMLElement> =
  React.RefObject<T> | React.MutableRefObject<T | null>;

/** Calcola posizione BOTTOM del tooltip rispetto al bottone (portal → no clipping) */
function useBottomTooltip<T extends HTMLElement>(triggerRef: AnyRef<T>) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState<TooltipPos | null>(null);

  const compute = () => {
    const el = triggerRef.current as T | null;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ x: r.left + r.width / 2, y: r.bottom + 8 }); // gap 8px
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
  const step    = usePlannerV2Store((s) => s.step);   // 'building' | 'modules' | ...
  const tool    = usePlannerV2Store((s) => s.tool);
  const setTool = usePlannerV2Store((s) => s.setTool);
  // catalogo moduli (TopToolbar)
const catalogPanels    = usePlannerV2Store(s => s.catalogPanels);
const selectedPanelId  = usePlannerV2Store(s => s.selectedPanelId);
const setSelectedPanel = usePlannerV2Store(s => s.setSelectedPanel);


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

  return () => {
    void unsub();    // forza il tipo a void
  };
}, []);




  /* Bottoni icona+testo con tooltip (portal) */
  function ActionBtn({
    active,
    onClick,
    Icon,
    label,
    disabled,
    tooltipLabel,
    tooltipKeys,
  }: {
    active?: boolean;
    onClick: () => void;
    Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
    label: string;
    disabled?: boolean;
    tooltipLabel?: string;
    tooltipKeys?: (string | React.ReactNode)[];
  }) {
    const ref = useRef<HTMLButtonElement>(null);
    const { visible, pos, show, hide } = useBottomTooltip(ref);

    const base =
      'inline-flex items-center gap-1.5 rounded-full h-8 px-3 text-[10px] uppercase tracking-wide font-medium transition';
    const inactive = 'border border-neutral-200 bg-white/80 text-neutral-800 hover:bg-neutral-100';
    const activeCls = 'bg-neutral-900 text-white';
    const disabledCls = 'opacity-50 cursor-not-allowed hover:bg-inherit';

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
          className={[base, disabled ? disabledCls : active ? activeCls : inactive].join(' ')}
        >
          <Icon className="h-4 w-4" />
          <span>{label}</span>
        </button>

        {tooltipLabel && tooltipKeys && (
          <PortalTooltip visible={visible} pos={pos} label={tooltipLabel} keys={tooltipKeys} />
        )}
      </>
    );
  }

  /* Bottoni icon-only (Undo/Redo) con tooltip (portal) */
 function IconOnlyBtn({
  onClick,
  Icon,
  ariaLabel,
  tooltipLabel,
  tooltipKeys,
  disabled,              // ⬅️ nuovo
}: {
  onClick: () => void;
  Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  ariaLabel: string;
  tooltipLabel: string;
  tooltipKeys: (string | React.ReactNode)[];
  disabled?: boolean;    // ⬅️ nuovo
}) {

    const ref = useRef<HTMLButtonElement>(null);
    const { visible, pos, show, hide } = useBottomTooltip(ref);

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
  disabled={disabled}   // ⬅️ nuovo
  className={[
    "inline-flex h-8 w-8 items-center justify-center rounded-full border border-neutral-200 bg-white/80 text-neutral-800 hover:bg-neutral-100 transition focus:outline-none focus:ring-2 focus:ring-black/10",
    disabled ? "opacity-40 cursor-not-allowed hover:bg-white/80" : ""
  ].join(" ")}
>
  <Icon className="h-4 w-4" />
</button>

        <PortalTooltip visible={visible} pos={pos} label={tooltipLabel} keys={tooltipKeys} />
      </>
    );
  }

  return (
    <div
      className="
        flex h-10 items-center justify-between gap-2 px-2
        overflow-x-auto overscroll-x-contain scrollbar-thin scrollbar-thumb-transparent scrollbar-track-transparent
      "
      style={{
        WebkitMaskImage:
          'linear-gradient(90deg, transparent 0px, black 16px, black calc(100% - 16px), transparent 100%)',
        maskImage:
          'linear-gradient(90deg, transparent 0px, black 16px, black calc(100% - 16px), transparent 100%)',
      }}
    >
      {/* SX: azioni contestuali */}
      <div className="flex min-w-0 items-center gap-2">
        <ActionBtn
          active={tool === 'select'}
          onClick={() => setTool('select' as any)}
          Icon={MousePointer}
          label="Auswählen"
          tooltipLabel="Auswählen"
          tooltipKeys={['A']}
        />

        {/* ——— BUILDING ——— */}
        {step === 'building' && (
          <>
            <ActionBtn
              active={tool === 'draw-roof'}
              onClick={() => setTool('draw-roof' as any)}
              Icon={PenLine}
              label="Dach zeichnen"
              tooltipLabel="Dach zeichnen"
              tooltipKeys={['D']}
            />
            <ActionBtn
              active={tool === 'draw-rect'}
              onClick={() => setTool('draw-rect' as any)}
              Icon={Square}
              label="Rechteck"
              tooltipLabel="Rechteck zeichnen"
              tooltipKeys={['R']}
            />
            <ActionBtn
              active={tool === 'draw-reserved'}
              onClick={() => setTool('draw-reserved' as any)}
              Icon={ShieldAlert}
              label="Hindernis"
              tooltipLabel="Hindernis / Reservierte Zone"
              tooltipKeys={['H']}
            />
          </>
        )}

        {/* ——— MODULES ——— */}
     {/* ——— MODULES ——— */}
{step === 'modules' && (
  <>
    <ActionBtn
      active={tool === 'fill-area'}
      onClick={() => setTool('fill-area' as any)}
      Icon={Grid2x2}
      label="Fläche füllen"
      tooltipLabel="Fläche füllen"
      tooltipKeys={['F']}
    />
    <div className="mx-1 h-6 w-px bg-neutral-200" />
    <OrientationToggle />
    {/* ⬇️ INCOLLA QUI IL DROPDOWN */}
    <div className="mx-1 h-6 w-px bg-neutral-200" />
    <label htmlFor="topbar-panel-select" className="sr-only">Modul wählen</label>
    <select
      id="topbar-panel-select"
      aria-label="Modul wählen"
      value={selectedPanelId}
      onChange={(e) => setSelectedPanel(e.target.value)}
      className="
        h-8 min-w-[220px] max-w-[320px]
        rounded-full border border-neutral-200 bg-white/80
        px-2 text-xs text-neutral-900
        hover:bg-neutral-100
        focus:outline-none focus:ring-2 focus:ring-black/10
      "
    >
      {catalogPanels.map(p => (
        <option key={p.id} value={p.id}>
          {p.brand} {p.model} — {p.wp} W
        </option>
      ))}
    </select>
  </>
)}


      </div>

      {/* DX: Undo/Redo (icon-only) + Save */}
      <div className="flex shrink-0 items-center gap-2 pl-2">
    <IconOnlyBtn
  onClick={handleUndo}
  Icon={RotateCcw}
  ariaLabel="Rückgängig"
  tooltipLabel="Rückgängig"
  tooltipKeys={isMac ? ['⌘', 'Z'] : ['Ctrl', 'Z']}
  disabled={!canUndo}          // ⬅️ nuovo
/>
<IconOnlyBtn
  onClick={handleRedo}
  Icon={RotateCw}
  ariaLabel="Wiederholen"
  tooltipLabel="Wiederholen"
  tooltipKeys={isMac ? ['⇧', '⌘', 'Z'] : ['Ctrl', 'Y']}
  disabled={!canRedo}          // ⬅️ nuovo
/>

        <ActionBtn
          onClick={handleSave}
          Icon={Save}
          label="Speichern"
          tooltipLabel="Speichern"
          tooltipKeys={[mod, 'S']}
        />
      </div>
    </div>
  );
}
