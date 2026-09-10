"use client";

import React from "react";

type Props = {
  open: boolean;
  roofLabel?: string;
  moduleCount?: number;
  onCancel: () => void;
  onConfirm: () => void;
  returnFocusId?: string;
};

export default function LayoutRegenerationDialog({
  open,
  roofLabel,
  moduleCount,
  onCancel,
  onConfirm,
  returnFocusId,
}: Props) {
  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      if (returnFocusId) document.getElementById(returnFocusId)?.focus();
    };
  }, [onCancel, open, returnFocusId]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[10050] flex items-center justify-center bg-black/45 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="regenerate-layout-title"
        aria-describedby="regenerate-layout-description"
        className="planner-surface-sidebar w-full max-w-sm rounded-2xl border border-border bg-background/95 p-5 text-foreground shadow-2xl backdrop-blur-xl"
      >
        <h2 id="regenerate-layout-title" className="text-base font-semibold">
          Layout neu erstellen?
        </h2>
        <p id="regenerate-layout-description" className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Das bestehende Modullayout wird ersetzt. Manuelle Änderungen gehen dabei verloren.
        </p>
        {roofLabel && Number.isFinite(moduleCount) && (
          <p className="mt-2 text-xs font-medium text-muted-foreground">
            {roofLabel} · {moduleCount} Module
          </p>
        )}
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            type="button"
            autoFocus
            onClick={onCancel}
            className="h-10 rounded-xl border border-border bg-background text-sm font-medium hover:bg-muted/40"
          >
            Abbrechen
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="h-10 rounded-xl bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90"
          >
            Layout neu erstellen
          </button>
        </div>
      </section>
    </div>
  );
}

