"use client";

import React from "react";
import { createPortal } from "react-dom";
import {
  Ban,
  Grid2X2,
  MousePointer2,
  Move,
  PanelsTopLeft,
  Square,
  X,
} from "lucide-react";
import type { PlannerStep, Tool } from "@/types/planner";

type HelpItem = {
  title: string;
  shortcut?: string;
  description: string;
  tool?: Tool;
  Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
};

const BUILDING_ITEMS: HelpItem[] = [
  {
    title: "Auswählen",
    shortcut: "A",
    description: "Dachfläche, Kante oder Hindernis anklicken. Ziehen bearbeitet das gewählte Objekt.",
    tool: "select",
    Icon: MousePointer2,
  },
  {
    title: "Dach frei zeichnen",
    shortcut: "D",
    description: "Eckpunkte anklicken. Mit Enter, Doppelklick oder einem Klick auf den Startpunkt schließen.",
    tool: "draw-roof",
    Icon: PanelsTopLeft,
  },
  {
    title: "Rechteck zeichnen",
    shortcut: "R",
    description: "Erster und zweiter Klick bestimmen die Kante, der dritte Klick bestimmt die Tiefe.",
    tool: "draw-rect",
    Icon: Square,
  },
  {
    title: "Hindernis zeichnen · Freie Form",
    shortcut: "H",
    description: "Innerhalb einer Dachfläche beginnen, Eckpunkte setzen und mit Enter oder Doppelklick schließen.",
    tool: "draw-reserved",
    Icon: Ban,
  },
  {
    title: "Hindernis · Rechteck",
    description: "Auf der Dachfläche klicken, ziehen und loslassen. Das Rechteck richtet sich automatisch an First oder Referenzkante aus.",
    tool: "draw-reserved-rect",
    Icon: Square,
  },
  {
    title: "Karte bewegen und zoomen",
    description: "Rechte Maustaste ziehen verschiebt die Karte. Das Mausrad zoomt. Escape bricht die aktuelle Aktion ab.",
    Icon: Move,
  },
];

const MODULE_ITEMS: HelpItem[] = [
  {
    title: "Modul auswählen",
    shortcut: "A",
    description: "Modul anklicken und ziehen. Pfeiltasten verschieben fein, Shift + Pfeil verschiebt schneller.",
    tool: "select",
    Icon: MousePointer2,
  },
  {
    title: "Automatisches Layout",
    shortcut: "U",
    description: "Bei Schrägdächern werden die gültigen Modulpositionen der ausgewählten Dachfläche erzeugt.",
    Icon: Grid2X2,
  },
  {
    title: "Fläche füllen",
    shortcut: "F",
    description: "Eine Teilfläche aufziehen und mit Modulen füllen. Escape bricht den Entwurf ab.",
    tool: "fill-area",
    Icon: PanelsTopLeft,
  },
  {
    title: "Flachdach planen",
    description: "Süd oder Ost-West, Anzahl und Ausrichtung in der Sidebar wählen. Erst „Layout anwenden“ speichert das Ergebnis.",
    Icon: PanelsTopLeft,
  },
  {
    title: "Modul bearbeiten",
    description: "Entfernen mit Delete. Duplizieren mit Ctrl/⌘ + D. Rechte Maustaste ziehen verschiebt weiterhin die Karte.",
    Icon: Move,
  },
];

export default function PlannerHelpDialog({
  open,
  step,
  onClose,
  onChooseTool,
}: {
  open: boolean;
  step: PlannerStep;
  onClose: () => void;
  onChooseTool: (tool: Tool) => void;
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose, open]);

  if (!open || typeof document === "undefined") return null;
  const building = step === "building";
  const items = building ? BUILDING_ITEMS : MODULE_ITEMS;

  return createPortal(
    <div className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section role="dialog" aria-modal="true" aria-labelledby="planner-help-title" className="planner-surface-sidebar max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-border bg-background/95 p-5 text-foreground shadow-2xl backdrop-blur-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="planner-help-title" className="text-lg font-semibold">
              {building ? "Gebäudeplanung – Hilfe" : "Modulplanung – Hilfe"}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Werkzeug anklicken oder die angezeigte Taste drücken.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Hilfe schließen" className="rounded-full p-2 text-muted-foreground hover:bg-muted/50 hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 space-y-2">
          {items.map(({ title, shortcut, description, tool, Icon }) => (
            <button
              key={title}
              type="button"
              disabled={!tool}
              onClick={() => {
                if (!tool) return;
                onChooseTool(tool);
                onClose();
              }}
              className="flex w-full items-start gap-3 rounded-xl border border-border/70 bg-muted/10 p-3 text-left enabled:hover:border-primary/50 enabled:hover:bg-primary/5 disabled:cursor-default"
            >
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-secondary/40">
                <Icon className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-3">
                  <strong className="text-sm">{title}</strong>
                  {shortcut && <kbd className="rounded-md border border-border bg-secondary px-2 py-1 text-[10px]">{shortcut}</kbd>}
                </span>
                <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{description}</span>
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>,
    document.body,
  );
}
