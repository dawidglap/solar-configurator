'use client';

import { useEffect } from 'react';
import { usePlannerV2Store } from '../state/plannerV2Store';

export default function TopToolbar() {
  const step = usePlannerV2Store((s) => s.step);
  const tool = usePlannerV2Store((s) => s.tool);
  const setTool = usePlannerV2Store((s) => s.setTool);

  const stepLabel =
    step === 'building' ? 'Gebäude' :
    step === 'modules'  ? 'Module'   :
    step === 'strings'  ? 'Strings'  :
                          'Stückliste';

  // scorciatoie: V=select, R=rect, P=polygon
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'v' || e.key === 'V') setTool('select');
      if (e.key === 'r' || e.key === 'R') setTool('draw-rect');
      if (e.key === 'p' || e.key === 'P') setTool('draw-roof');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setTool]);

  return (
    <div className="flex h-9 items-center justify-between gap-2 py-1">
      {/* sinistra: label + tool buttons */}
      <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
        <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-700">
          Modus: <span className="font-medium">{stepLabel}</span>
        </span>

        <div className="flex shrink-0 items-center gap-1">
          <ToolButton
            active={tool === 'select'}
            onClick={() => setTool('select')}
            title="Auswahl (V)"
          >
            Auswahl
          </ToolButton>

          <ToolButton
            active={tool === 'draw-rect'}
            onClick={() => setTool('draw-rect')}
            title="Rechteck (R)"
          >
            Rechteck
          </ToolButton>

          <ToolButton
            active={tool === 'draw-roof'}
            onClick={() => setTool('draw-roof')}
            title="Polygon (P)"
          >
            Polygon
          </ToolButton>
        </div>
      </div>

      {/* destra: salva */}
      <div className="flex shrink-0 items-center gap-1">
        <button
          className="rounded-md border border-neutral-200 bg-white px-2.5 py-1 text-xs hover:bg-neutral-50"
          title="Speichern"
          onClick={() => alert('Speichern (kommt später)')}
        >
          Speichern
        </button>
      </div>
    </div>
  );
}

function ToolButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={[
        'rounded-full px-2.5 py-1 text-xs transition border',
        active
          ? 'bg-black text-white border-black'
          : 'bg-white text-neutral-800 hover:bg-neutral-50 border-neutral-200',
      ].join(' ')}
    >
      {children}
    </button>
  );
}
