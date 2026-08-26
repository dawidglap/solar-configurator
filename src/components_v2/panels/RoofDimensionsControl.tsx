"use client";

import React from "react";

import {
  MAX_EDITABLE_ROOF_DIMENSION_M,
  MIN_EDITABLE_ROOF_DIMENSION_M,
  analyzeRectangularRoof,
  resizeRectangularRoof,
} from "@/lib/planning-core/geometry-v2";
import type { RoofArea } from "@/types/planner";
import { usePlannerV2Store } from "../state/plannerV2Store";

const inputClass =
  "glass-input h-8 w-full rounded-lg px-2 text-[11px] focus:ring-1 focus:ring-primary/40";
const labelClass =
  "block text-[10px] font-medium uppercase tracking-wide text-muted-foreground";

export default function RoofDimensionsControl({ roof }: { roof: RoofArea }) {
  const mppImage = usePlannerV2Store((state) => state.snapshot.mppImage);
  const panels = usePlannerV2Store((state) => state.panels);
  const updateRoof = usePlannerV2Store((state) => state.updateRoof);
  const analysis = React.useMemo(
    () => analyzeRectangularRoof(roof.points, mppImage ?? 0),
    [mppImage, roof.points],
  );
  const lengthValue = analysis.supported ? analysis.dimensions.lengthM.toFixed(2) : "";
  const widthValue = analysis.supported ? analysis.dimensions.widthM.toFixed(2) : "";
  const [lengthInput, setLengthInput] = React.useState(lengthValue);
  const [widthInput, setWidthInput] = React.useState(widthValue);
  const [error, setError] = React.useState<string>();
  const [geometryChanged, setGeometryChanged] = React.useState(false);
  const cancelBlur = React.useRef<"length" | "width" | undefined>(undefined);

  React.useEffect(() => {
    setLengthInput(lengthValue);
    setWidthInput(widthValue);
    setError(undefined);
  }, [lengthValue, roof.id, widthValue]);

  React.useEffect(() => {
    setGeometryChanged(false);
  }, [roof.id]);

  if (!analysis.supported) {
    return (
      <section className="space-y-2">
        <label className={labelClass}>Dachfläche</label>
        <p className="rounded-lg border border-border/60 bg-muted/20 p-2 text-[10px] text-muted-foreground">
          Direkte Maßeingabe für diese Form noch nicht verfügbar.
        </p>
      </section>
    );
  }

  const commit = (field: "length" | "width") => {
    if (cancelBlur.current === field) {
      cancelBlur.current = undefined;
      return;
    }
    const lengthM = Number(lengthInput.replace(",", "."));
    const widthM = Number(widthInput.replace(",", "."));
    const resized = resizeRectangularRoof({
      pointsPx: roof.points,
      mppImage: mppImage ?? 0,
      lengthM,
      widthM,
    });
    if (!resized.valid) {
      setError(
        `Bitte Werte zwischen ${MIN_EDITABLE_ROOF_DIMENSION_M.toFixed(2)} m und ${MAX_EDITABLE_ROOF_DIMENSION_M.toFixed(0)} m eingeben.`,
      );
      setLengthInput(analysis.dimensions.lengthM.toFixed(2));
      setWidthInput(analysis.dimensions.widthM.toFixed(2));
      return;
    }
    updateRoof(roof.id, { points: resized.points });
    setLengthInput(resized.dimensions.lengthM.toFixed(2));
    setWidthInput(resized.dimensions.widthM.toFixed(2));
    setError(undefined);
    setGeometryChanged(true);
  };

  const handleKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>,
    field: "length" | "width",
  ) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancelBlur.current = field;
      setLengthInput(analysis.dimensions.lengthM.toFixed(2));
      setWidthInput(analysis.dimensions.widthM.toFixed(2));
      setError(undefined);
      event.currentTarget.blur();
    }
  };

  return (
    <section className="space-y-2">
      <label className={labelClass}>Dachfläche</label>
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1 text-[10px] text-muted-foreground">
          Länge
          <div className="flex items-center gap-1">
            <input
              aria-label="Dachlänge (m)"
              className={inputClass}
              data-stop-hotkeys="true"
              inputMode="decimal"
              value={lengthInput}
              onChange={(event) => setLengthInput(event.target.value)}
              onBlur={() => commit("length")}
              onKeyDown={(event) => handleKeyDown(event, "length")}
            />
            <span>m</span>
          </div>
        </label>
        <label className="space-y-1 text-[10px] text-muted-foreground">
          Breite
          <div className="flex items-center gap-1">
            <input
              aria-label="Dachbreite (m)"
              className={inputClass}
              data-stop-hotkeys="true"
              inputMode="decimal"
              value={widthInput}
              onChange={(event) => setWidthInput(event.target.value)}
              onBlur={() => commit("width")}
              onKeyDown={(event) => handleKeyDown(event, "width")}
            />
            <span>m</span>
          </div>
        </label>
      </div>
      <p className="text-[10px] text-muted-foreground">
        Ausrichtung: {analysis.dimensions.canvasAngleDeg.toFixed(1)}°
      </p>
      {error && <p className="text-[10px] text-destructive">{error}</p>}
      {geometryChanged && panels.some((panel) => panel.roofId === roof.id) && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2 text-[10px] text-amber-700 dark:text-amber-300">
          Das bestehende Modullayout bleibt erhalten. Für die neue Dachgeometrie Layout erneut anwenden.
        </p>
      )}
    </section>
  );
}
