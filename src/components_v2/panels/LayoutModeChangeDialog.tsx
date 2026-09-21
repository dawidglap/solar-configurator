"use client";

import React from "react";

type Props = {
  open: boolean;
  roofLabel?: string;
  moduleCount: number;
  onCancel: () => void;
  onConfirm: () => void;
  protectsManualLayout?: boolean;
  title?: string;
};

export default function LayoutModeChangeDialog({
  open,
  roofLabel,
  moduleCount,
  onCancel,
  onConfirm,
  protectsManualLayout = false,
  title = "Ausrichtung ändern?",
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
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onCancel, open]);

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
        aria-labelledby="layout-mode-change-title"
        aria-describedby="layout-mode-change-description"
        className="planner-surface-sidebar w-full max-w-sm rounded-2xl border border-border bg-background/95 p-5 text-foreground shadow-2xl backdrop-blur-xl"
      >
        <h2 id="layout-mode-change-title" className="text-base font-semibold">
          {title}
        </h2>
        <p id="layout-mode-change-description" className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {protectsManualLayout
            ? "Manuelle Änderungen an der Modulbelegung werden dabei gelöscht."
            : "Alle Module auf dieser Dachfläche werden entfernt."}
        </p>
        {!protectsManualLayout && (
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Die bisherige Modulbelegung kann danach nicht wiederhergestellt werden, außer über Rückgängig.
          </p>
        )}
        {roofLabel && (
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
            className="h-10 rounded-xl bg-destructive px-3 text-sm font-semibold text-destructive-foreground hover:bg-destructive/90"
          >
            {protectsManualLayout ? "Ändern & neu belegen" : "Module entfernen & wechseln"}
          </button>
        </div>
      </section>
    </div>
  );
}
