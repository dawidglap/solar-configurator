'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useLayoutEffect,
  useCallback,
} from 'react';
import { createPortal } from 'react-dom';
import { usePlannerV2Store } from '../state/plannerV2Store';
import { ChevronDown, MousePointer, Square, Ban, Check } from 'lucide-react';

type ToolKey = 'select' | 'draw-rect' | 'draw-reserved';

type Item = {
  key: ToolKey;
  label: string; // DE
  hint: string;  // Tastaturkürzel
  Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
};

const ITEMS: Item[] = [
  { key: 'select',        label: 'Dach auswählen',    hint: 'V', Icon: MousePointer },
  { key: 'draw-rect',     label: 'Dach zeichnen',     hint: 'R', Icon: Square },
  { key: 'draw-reserved', label: 'Reservierte Zone',  hint: 'Z', Icon: Ban },
];

export default function ToolDropdown() {
  const tool = usePlannerV2Store((s) => s.tool);
  const setTool = usePlannerV2Store((s) => s.setTool);

  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);

  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const MENU_WIDTH = 224; // ~ w-56

  const activeItem = useMemo(
    () => ITEMS.find((i) => i.key === tool) ?? ITEMS[0],
    [tool]
  );

  useEffect(() => setMounted(true), []);
  const close = useCallback(() => setOpen(false), []);

  const updatePosition = useCallback(() => {
    const btn = btnRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const gap = 8;
    let left = r.left;
    const top = r.bottom + gap;
    const maxLeft = window.innerWidth - MENU_WIDTH - gap;
    if (left > maxLeft) left = Math.max(gap, maxLeft);
    setPos({ top, left });
  }, []);

  useLayoutEffect(() => { if (open) updatePosition(); }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => updatePosition();
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [open, updatePosition]);

  // chiusura su click fuori / Esc / Tab
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node;
      const btn = btnRef.current;
      if (btn && (t === btn || btn.contains(t))) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Tab') close();
    };
    document.addEventListener('mousedown', onDocClick, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  // scorciatoie globali: V / R / Z
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || (target as any).isContentEditable)) return;
      const k = e.key.toLowerCase();
      if (k === 'v') setTool('select');
      if (k === 'r') setTool('draw-rect');
      if (k === 'z') setTool('draw-reserved');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setTool]);

  const handleSelect = (k: ToolKey) => {
    setTool(k);
    close();
  };

  return (
    <div className="relative pointer-events-auto">
      {/* Trigger: mostra SEMPRE l’opzione attiva */}
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(v => !v);
        }}
        className="
          inline-flex items-center gap-1.5 rounded-full border
          px-2.5 py-[5px]              /* ⬅️ py ridotta */
          text-[10.5px]                /* ⬅️ testo leggermente più piccolo */
          bg-white/80 text-neutral-800 border-neutral-200
          hover:bg-white transition
        "
      >
        <activeItem.Icon className="h-3.5 w-3.5" />
        <span className="truncate max-w-[160px]">{activeItem.label}</span>
        <ChevronDown className="h-3.5 w-3.5 opacity-70" />
      </button>

      {/* Menu in portal (fixed) */}
      {mounted && open &&
        createPortal(
          <div
            role="menu"
            onClick={(e) => e.stopPropagation()}
            className="
              fixed z-[1000] w-56
              rounded-2xl border border-neutral-800/40
              bg-neutral-900 text-white shadow-lg overflow-hidden
            "
            style={{ top: pos.top, left: pos.left }}
          >
            <ul className="py-1">
              {ITEMS.map((it) => {
                const ItemIcon = it.Icon;
                const isActive = it.key === tool;
                return (
                  <li key={it.key}>
                    <button
                      role="menuitem"
                      onClick={() => handleSelect(it.key)}
                      className={`
                        flex w-full items-center justify-between gap-2
                        px-2 py-1.5                  /* ⬅️ più compatto */
                        text-[11px]                  /* ⬅️ più compatto */
                        ${isActive ? 'bg-blue-600' : 'hover:bg-neutral-800'}
                      `}
                    >
                      <span className="flex items-center gap-2">
                        <span className="w-4 grid place-items-center">
                          {isActive ? <Check className="h-3.5 w-3.5" /> : null}
                        </span>
                        <ItemIcon className="h-3.5 w-3.5 opacity-90" />
                        <span>{it.label}</span>
                      </span>
                      <span className="text-neutral-200"> {/* ⬅️ shortcut più chiare */}
                        {it.hint}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>,
          document.body
        )}
    </div>
  );
}
