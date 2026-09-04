"use client";

import React from "react";
import { ChevronRight, X } from "lucide-react";

import type { ThermalFieldDisplay } from "./thermalFieldDisplay";
import { formatFieldMetres } from "./thermalFieldDisplay";

export const THERMAL_FIELD_DRAWER_WIDTH_PX = 360;

export default function ThermalFieldOverviewDrawer({
  open,
  fields,
  selectedKey,
  preview,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  fields: readonly ThermalFieldDisplay[];
  selectedKey?: string;
  preview: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (key: string) => void;
}) {
  const cardRefs = React.useRef(new Map<string, HTMLButtonElement>());

  React.useEffect(() => {
    if (!open || !selectedKey) return;
    cardRefs.current.get(selectedKey)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [open, selectedKey]);

  const totalModules = fields.reduce((sum, field) => sum + field.moduleCount, 0);

  if (!open) {
    return (
      <button
        type="button"
        className="fixed right-3 top-1/2 z-[610] flex -translate-y-1/2 items-center gap-1 rounded-l-xl border border-border bg-background/95 px-2 py-3 text-xs font-medium text-foreground shadow-lg backdrop-blur-md"
        onClick={() => onOpenChange(true)}
        aria-label="Feldübersicht öffnen"
      >
        <ChevronRight className="h-4 w-4 rotate-180" aria-hidden="true" />
        Felder
      </button>
    );
  }

  return (
    <aside
      className="fixed bottom-4 right-3 top-[calc(var(--tb,48px)+12px)] z-[610] flex w-[min(360px,calc(100vw-24px))] flex-col overflow-hidden rounded-2xl border border-border bg-background/95 text-foreground shadow-2xl backdrop-blur-xl"
      aria-label="Feldübersicht"
    >
      <header className="shrink-0 border-b border-border px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold">Feldübersicht</h2>
              {preview && (
                <span className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                  Vorschau
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {fields.length} {fields.length === 1 ? "thermisches Feld" : "thermische Felder"} · {totalModules} Module
            </p>
          </div>
          <button
            type="button"
            className="glass-button-secondary grid h-8 w-8 shrink-0 place-items-center p-0"
            onClick={() => onOpenChange(false)}
            aria-label="Feldübersicht schließen"
            title="Feldübersicht schließen"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {fields.length === 0 && (
          <div className="rounded-xl border border-border px-3 py-4 text-sm text-muted-foreground">
            Keine thermischen Felder verfügbar.
          </div>
        )}
        {fields.map((field) => {
          const selected = field.key === selectedKey;
          return (
            <button
              key={field.key}
              ref={(node) => {
                if (node) cardRefs.current.set(field.key, node);
                else cardRefs.current.delete(field.key);
              }}
              type="button"
              onClick={() => onSelect(field.key)}
              className={[
                "w-full rounded-xl border bg-secondary/45 px-3 py-2.5 text-left transition",
                "focus:outline-none focus:ring-2 focus:ring-primary/35",
                selected ? "border-foreground/55 ring-1 ring-foreground/20" : "border-border hover:border-foreground/30",
              ].join(" ")}
              aria-pressed={selected}
              aria-label={`${field.displayId}, ${formatFieldMetres(field.lengthM)} mal ${formatFieldMetres(field.widthM)} Meter`}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <span
                    className="h-3 w-3 rounded-full border border-white/40"
                    style={{ backgroundColor: field.color }}
                    aria-hidden="true"
                  />
                  {field.displayId}
                </span>
                <span className={field.valid ? "text-[11px] text-muted-foreground" : "text-[11px] text-red-400"}>
                  {field.valid ? "✓ Innerhalb Grenzwert" : "Grenzwert überschritten"}
                </span>
              </div>
              <div className="mt-2 text-base font-semibold tabular-nums">
                {formatFieldMetres(field.lengthM)} × {formatFieldMetres(field.widthM)} m
              </div>
              <div className="mt-1 grid grid-cols-2 gap-x-3 text-xs text-muted-foreground">
                <span>{field.moduleCount} Module</span>
                {field.blockCount !== undefined && <span>{field.blockCount} Blocks</span>}
              </div>
              {(field.lengthLimitM !== undefined || field.widthLimitM !== undefined) && (
                <div className="mt-1.5 text-[11px] text-muted-foreground">
                  Grenze: {field.lengthLimitM !== undefined ? formatFieldMetres(field.lengthLimitM) : ""}
                  {field.lengthLimitM !== undefined && field.widthLimitM !== undefined ? " × " : ""}
                  {field.widthLimitM !== undefined ? formatFieldMetres(field.widthLimitM) : ""} m
                </div>
              )}
            </button>
          );
        })}
      </div>
      <footer className="shrink-0 border-t border-border px-4 py-2 text-[10px] text-muted-foreground">
        Thermische Feldaufteilung · keine statische Prüfung
      </footer>
    </aside>
  );
}
