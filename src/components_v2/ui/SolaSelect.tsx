"use client";

import React from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

export type SolaSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type SolaSelectProps = {
  id?: string;
  value: string;
  options: readonly SolaSelectOption[];
  onValueChange: (value: string) => void;
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
  title?: string;
};

type MenuPosition = {
  left: number;
  width: number;
  maxHeight: number;
  top?: number;
  bottom?: number;
};

const VIEWPORT_PADDING = 8;
const MENU_GAP = 6;
const MENU_MAX_HEIGHT = 260;

export function resolveSolaSelectMenuPosition(
  rect: Pick<DOMRect, "top" | "bottom" | "left" | "width">,
  viewportWidth: number,
  viewportHeight: number,
): MenuPosition {
  const availableBelow = viewportHeight - rect.bottom - MENU_GAP - VIEWPORT_PADDING;
  const availableAbove = rect.top - MENU_GAP - VIEWPORT_PADDING;
  const openAbove = availableBelow < Math.min(MENU_MAX_HEIGHT, 160) && availableAbove > availableBelow;
  const available = Math.max(0, openAbove ? availableAbove : availableBelow);
  const maxHeight = Math.min(MENU_MAX_HEIGHT, available);
  const width = Math.max(0, Math.min(rect.width, viewportWidth - VIEWPORT_PADDING * 2));
  const left = Math.min(
    Math.max(VIEWPORT_PADDING, rect.left),
    Math.max(VIEWPORT_PADDING, viewportWidth - width - VIEWPORT_PADDING),
  );

  return openAbove
    ? { left, width, maxHeight, bottom: viewportHeight - rect.top + MENU_GAP }
    : { left, width, maxHeight, top: rect.bottom + MENU_GAP };
}

function firstEnabledIndex(options: readonly SolaSelectOption[]) {
  return options.findIndex((option) => !option.disabled);
}

function nextEnabledIndex(
  options: readonly SolaSelectOption[],
  currentIndex: number,
  direction: 1 | -1,
) {
  if (options.length === 0) return -1;
  for (let offset = 1; offset <= options.length; offset += 1) {
    const index = (currentIndex + direction * offset + options.length) % options.length;
    if (!options[index]?.disabled) return index;
  }
  return -1;
}

export default function SolaSelect({
  id,
  value,
  options,
  onValueChange,
  ariaLabel,
  className = "",
  disabled = false,
  placeholder = "—",
  title,
}: SolaSelectProps) {
  const reactId = React.useId();
  const listboxId = `sola-select-${reactId}-listbox`;
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  const optionRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const [mounted, setMounted] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(-1);
  const [position, setPosition] = React.useState<MenuPosition>({
    left: 0,
    width: 0,
    maxHeight: MENU_MAX_HEIGHT,
    top: 0,
  });

  const selectedIndex = options.findIndex((option) => option.value === value);
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  React.useEffect(() => setMounted(true), []);

  const updatePosition = React.useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    setPosition(
      resolveSolaSelectMenuPosition(
        trigger.getBoundingClientRect(),
        window.innerWidth,
        window.innerHeight,
      ),
    );
  }, []);

  const openMenu = React.useCallback(() => {
    if (disabled || options.length === 0) return;
    const initialIndex = selectedIndex >= 0 && !options[selectedIndex]?.disabled
      ? selectedIndex
      : firstEnabledIndex(options);
    setActiveIndex(initialIndex);
    setOpen(true);
  }, [disabled, options, selectedIndex]);

  const closeMenu = React.useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  const selectIndex = React.useCallback((index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    onValueChange(option.value);
    closeMenu(true);
  }, [closeMenu, onValueChange, options]);

  React.useLayoutEffect(() => {
    if (open) updatePosition();
  }, [open, updatePosition]);

  React.useEffect(() => {
    if (!open) return;
    const update = () => updatePosition();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, updatePosition]);

  React.useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      closeMenu();
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeMenu(true);
    };
    document.addEventListener("mousedown", handlePointerDown, true);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown, true);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [closeMenu, open]);

  React.useEffect(() => {
    if (!open || activeIndex < 0) return;
    optionRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  React.useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        openMenu();
        return;
      }
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((current) => nextEnabledIndex(options, current, direction));
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open && activeIndex >= 0) selectIndex(activeIndex);
      else openMenu();
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      if (!open) openMenu();
      const direction = event.key === "Home" ? 1 : -1;
      const origin = event.key === "Home" ? -1 : 0;
      setActiveIndex(nextEnabledIndex(options, origin, direction));
      return;
    }
    if (event.key === "Tab") closeMenu();
  };

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={open && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
        disabled={disabled}
        title={title}
        data-sola-select-trigger=""
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={handleKeyDown}
        className={`inline-flex items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
      >
        <span className="min-w-0 flex-1 truncate">{selectedOption?.label ?? placeholder}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>

      {mounted && open && createPortal(
        <div
          ref={menuRef}
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel}
          data-sola-select-menu=""
          className="fixed z-[1000000] overflow-y-auto overscroll-contain rounded-xl border border-white/10 bg-neutral-900 py-1 text-xs text-neutral-100 shadow-xl"
          style={position}
        >
          {options.map((option, index) => {
            const selected = option.value === value;
            const active = index === activeIndex;
            return (
              <button
                key={`${option.value}-${index}`}
                ref={(node) => { optionRefs.current[index] = node; }}
                id={`${listboxId}-option-${index}`}
                type="button"
                role="option"
                aria-selected={selected}
                disabled={option.disabled}
                data-value={option.value}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectIndex(index)}
                className={`flex min-h-9 w-full items-center gap-2 px-3 py-2 text-left leading-snug transition-colors disabled:opacity-40 ${
                  active ? "bg-neutral-700 text-white" : selected ? "bg-emerald-400/10 text-white" : "text-neutral-200 hover:bg-neutral-800"
                }`}
              >
                <span className="min-w-0 flex-1">{option.label}</span>
                <span className="grid h-4 w-4 shrink-0 place-items-center" aria-hidden="true">
                  {selected ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : null}
                </span>
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}
