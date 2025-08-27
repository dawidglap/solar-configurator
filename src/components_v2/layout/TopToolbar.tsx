'use client';

import { useEffect, useMemo } from 'react';
import { usePlannerV2Store } from '../state/plannerV2Store';
import { Save, Command, Keyboard } from 'lucide-react';
import ToolDropdown from './ToolDropdown'; // ⬅️ nuovo menu a tendina stile Figma

export default function TopToolbar() {
  const step = usePlannerV2Store((s) => s.step);

  // Label step micro (solo informativo)
  const stepLabel =
    step === 'building' ? 'Gebäude' :
    step === 'modules'  ? 'Module'   :
    step === 'strings'  ? 'Strings'  : 'Stückliste';

  const isMac = useMemo(
    () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform),
    []
  );

  // ✅ scorciatoia: Cmd/Ctrl+S = Save (le scorciatoie dei tool sono in ToolDropdown)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || (t as any).isContentEditable))
        return;

      const saveCombo = (isMac && e.metaKey && e.key.toLowerCase() === 's') ||
                        (!isMac && e.ctrlKey && e.key.toLowerCase() === 's');
      if (saveCombo) {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMac]);

  const handleSave = () => {
    // TODO: wire real save/export in PR successivo
    console.log('[Planner] Save triggered');
    alert('Speichern (kommt später)'); // placeholder
  };

  return (
    <div className="flex h-10 items-center justify-between gap-2 px-2 py-1 ">
      {/* SX: stato/step + menu strumenti */}
      <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
        {/* chip step micro */}
        <span className="shrink-0 rounded-full border border-neutral-200 bg-white/70 backdrop-blur px-2 py-0.5 text-[10px] text-neutral-700">
          Modus: <span className="font-medium">{stepLabel}</span>
        </span>

        {/* ⬇️ nuovo dropdown strumenti (Select / Rect / Reserved) con scorciatoie V/R/Z */}
        <ToolDropdown />
      </div>

      {/* DX: Salva con icona + kbd hint */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={handleSave}
          title={isMac ? 'Speichern (⌘S)' : 'Speichern (Ctrl+S)'}
          className="
            inline-flex items-center gap-2 rounded-full
            border border-blue-200 bg-blue-50 text-blue-700
            px-3 py-1 text-[11px] font-medium
            hover:bg-blue-100 active:translate-y-[0.5px]
          "
        >
          <Save className="h-4 w-4" />
          <span className="hidden sm:inline">Speichern</span>
          <Kbd combo={isMac ? '⌘S' : 'Ctrl+S'} />
        </button>
      </div>
    </div>
  );
}

/** piccolo chip tastiera come nello screenshot */
function Kbd({ combo }: { combo: string }) {
  const isMac =
    typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);

  return (
    <span
      className="
        ml-1 inline-flex items-center gap-1 rounded-md
        border border-neutral-200 bg-white/70
        px-1.5 py-[2px] text-[10px] text-neutral-600
      "
      aria-hidden
    >
      {isMac ? (
        <Command className="inline h-3 w-3 align-[-2px]" />
      ) : (
        <Keyboard className="inline h-3 w-3 align-[-2px]" />
      )}
      <span className="leading-none">{combo}</span>
    </span>
  );
}
