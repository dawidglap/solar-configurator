"use client";

import React from "react";

type Props = {
  open: boolean;
  currentLabel: string;
  nextLabel: string;
  moduleCount: number;
  onCancel: () => void;
  onConfirm: () => void;
};

export default function RoofTypeChangeDialog({
  open,
  currentLabel,
  nextLabel,
  moduleCount,
  onCancel,
  onConfirm,
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
      className="fixed inset-0 z-[500] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="roof-type-change-title"
        aria-describedby="roof-type-change-description"
        className="planner-surface-sidebar w-full max-w-sm rounded-2xl border border-border bg-background/95 p-5 text-foreground shadow-2xl backdrop-blur-xl"
      >
        <h2 id="roof-type-change-title" className="text-base font-semibold">
          Dachtyp wirklich ändern?
        </h2>
        <p
          id="roof-type-change-description"
          className="mt-3 text-sm leading-relaxed text-muted-foreground"
        >
          {currentLabel} wird zu {nextLabel}.{" "}
          {moduleCount > 0
            ? `Alle ${moduleCount} Module auf dieser Dachfläche werden gelöscht.`
            : "Die bisherige Planung dieser Dachfläche wird zurückgesetzt."}{" "}
          Danach beginnt die Planung für diese Dachfläche neu.
        </p>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            type="button"
            autoFocus
            onClick={onCancel}
            className="h-10 rounded-xl border border-border bg-background text-sm font-medium hover:bg-muted/40"
          >
            Nein
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="h-10 rounded-xl bg-destructive text-sm font-semibold text-destructive-foreground hover:bg-destructive/90"
          >
            Ja, ändern
          </button>
        </div>
      </section>
    </div>
  );
}
