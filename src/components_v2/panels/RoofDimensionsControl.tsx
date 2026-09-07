"use client";

import React from "react";

import {
  MAX_EDITABLE_ROOF_DIMENSION_M,
  MIN_EDITABLE_ROOF_DIMENSION_M,
  analyzeRectangularRoof,
  analyzeRoofSegments,
  getCanonicalRoofEdges,
  getPitchedRoofEdgeRoles,
  resolveRoofReferenceEdgeIndex,
  resizeRectangularRoof,
  resizeRoofSegment,
} from "@/lib/planning-core/geometry-v2";
import type { RoofArea } from "@/types/planner";
import { resolveSurfacePlanning } from "@/lib/planning-core/advanced";
import { resolveRoofSlopeForKind } from "@/lib/planning/roofProperties";
import { usePlannerV2Store } from "../state/plannerV2Store";
import { resolveRoofFallAzimuth } from "../roof/roofOrientation";
import NumericFieldWithSuffix from "../ui/NumericFieldWithSuffix";

const controlClass =
  "glass-input h-9 w-full rounded-lg px-3 py-0 text-[11px] leading-none focus:ring-1 focus:ring-primary/40";
const labelClass =
  "block text-[10px] font-medium uppercase tracking-wide text-muted-foreground";
const fieldLabelClass = "block text-[10px] text-muted-foreground";

const dimensionFormatter = new Intl.NumberFormat("de-DE", {
  maximumFractionDigits: 2,
});
const orientationFormatter = new Intl.NumberFormat("de-DE", {
  maximumFractionDigits: 1,
});

type RoofKind = "pitched" | "flat" | "green";

const EDGE_ROLE_LABELS = {
  first: "First",
  eaves: "Traufe",
  "gable-left": "Ortgang links",
  "gable-right": "Ortgang rechts",
  edge: undefined,
} as const;

export default function RoofDimensionsControl({
  roof,
  roofKind,
}: {
  roof: RoofArea;
  roofKind: RoofKind;
}) {
  const mppImage = usePlannerV2Store((state) => state.snapshot.mppImage);
  const panels = usePlannerV2Store((state) => state.panels);
  const updateRoof = usePlannerV2Store((state) => state.updateRoof);
  const planning = resolveSurfacePlanning(roof.surfacePlanning);
  const measurementTiltDeg = resolveRoofSlopeForKind(
    roofKind,
    planning.status === "supported-advanced"
      ? planning.config.surface.slopeDeg ?? roof.tiltDeg
      : roof.tiltDeg,
  );
  const fallAzimuthDeg = planning.status === "supported-advanced"
    ? planning.config.surface.fallAzimuthDeg ?? resolveRoofFallAzimuth(roof)
    : resolveRoofFallAzimuth(roof);
  const analysis = React.useMemo(
    () => analyzeRectangularRoof(roof.points, mppImage ?? 0),
    [mppImage, roof.points],
  );
  const segments = React.useMemo(
    () =>
      analyzeRoofSegments(roof.points, mppImage ?? 0, {
        tiltDeg: measurementTiltDeg,
        fallAzimuthDeg,
      }),
    [fallAzimuthDeg, measurementTiltDeg, mppImage, roof.points],
  );
  const lengthValue = analysis.supported ? analysis.dimensions.lengthM.toFixed(2) : "";
  const widthValue = analysis.supported ? analysis.dimensions.widthM.toFixed(2) : "";
  const [lengthInput, setLengthInput] = React.useState(lengthValue);
  const [widthInput, setWidthInput] = React.useState(widthValue);
  const [error, setError] = React.useState<string>();
  const [geometryChanged, setGeometryChanged] = React.useState(false);
  const [segmentInputs, setSegmentInputs] = React.useState<string[]>(
    segments.map((segment) => segment.lengthM.toFixed(2)),
  );
  const cancelBlur = React.useRef<"length" | "width" | undefined>(undefined);
  const cancelSegmentBlur = React.useRef<number | undefined>(undefined);
  const referenceEdgeIndex = resolveRoofReferenceEdgeIndex({
    points: roof.points,
    requestedIndex: roof.referenceEdgeIndex,
    roofKind,
  });
  const pitchedRoles = React.useMemo(
    () => getPitchedRoofEdgeRoles({
      points: roof.points,
      referenceEdgeIndex,
    }),
    [referenceEdgeIndex, roof.points],
  );
  const canonicalEdges = React.useMemo(
    () => getCanonicalRoofEdges(roof.points),
    [roof.points],
  );
  const edgeLabel = (edgeIndex: number) => {
    if (roofKind !== "pitched") return `Kante ${edgeIndex + 1}`;
    const role = pitchedRoles.get(edgeIndex) ?? "edge";
    return EDGE_ROLE_LABELS[role] ?? `Kante ${edgeIndex + 1}`;
  };
  const formatDimensionM = (value: number) => `${dimensionFormatter.format(value)} m`;

  React.useEffect(() => {
    setLengthInput(lengthValue);
    setWidthInput(widthValue);
    setError(undefined);
  }, [lengthValue, roof.id, widthValue]);

  React.useEffect(() => {
    setSegmentInputs(segments.map((segment) => segment.lengthM.toFixed(2)));
    setError(undefined);
  }, [roof.id, segments]);

  React.useEffect(() => {
    setGeometryChanged(false);
  }, [roof.id]);

  const commitSegment = (segmentIndex: number) => {
    if (cancelSegmentBlur.current === segmentIndex) {
      cancelSegmentBlur.current = undefined;
      return;
    }
    const lengthM = Number((segmentInputs[segmentIndex] ?? "").replace(",", "."));
    const resized = resizeRoofSegment({
      pointsPx: roof.points,
      mppImage: mppImage ?? 0,
      segmentIndex,
      lengthM,
      tiltDeg: measurementTiltDeg,
      fallAzimuthDeg,
    });
    if (!resized.valid) {
      setError(
        resized.reason === "invalid-polygon"
          ? "Diese Änderung würde eine ungültige oder sich kreuzende Dachfläche erzeugen."
          : `Bitte einen Wert zwischen ${MIN_EDITABLE_ROOF_DIMENSION_M.toFixed(2)} m und ${MAX_EDITABLE_ROOF_DIMENSION_M.toFixed(0)} m eingeben.`,
      );
      setSegmentInputs(segments.map((segment) => segment.lengthM.toFixed(2)));
      return;
    }
    updateRoof(roof.id, { points: resized.points });
    setSegmentInputs(resized.segments.map((segment) => segment.lengthM.toFixed(2)));
    setError(undefined);
    setGeometryChanged(true);
  };

  const referenceSelector =
    (roofKind === "flat" || roofKind === "pitched") && segments.length > 0 ? (
    <div className="space-y-3">
      <label className={labelClass} htmlFor={`reference-edge-${roof.id}`}>
        {roofKind === "pitched" ? "First" : "Referenzkante"}
      </label>
      <select
        id={`reference-edge-${roof.id}`}
        className={controlClass}
        value={referenceEdgeIndex ?? 0}
        onChange={(event) =>
          updateRoof(roof.id, { referenceEdgeIndex: Number(event.target.value) })
        }
      >
        {segments.map((segment) => (
          <option key={segment.segmentIndex} value={segment.segmentIndex}>
            Kante {segment.segmentIndex + 1} · {formatDimensionM(segment.lengthM)}
          </option>
        ))}
      </select>
      {referenceEdgeIndex != null && (
        <div className="flex items-center justify-between gap-3 text-[10px]">
          <span className="text-muted-foreground">Ausrichtung</span>
          <strong className="font-semibold tabular-nums text-foreground">
            {orientationFormatter.format(
              canonicalEdges[referenceEdgeIndex]?.geographicAzimuthDeg ?? 0,
            )}°
          </strong>
        </div>
      )}
    </div>
  ) : null;

  if (!analysis.supported) {
    return (
      <section className="space-y-6">
        <div className="space-y-3">
          <label className={labelClass}>Dachfläche</label>
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            Jede Kante wird in Metern aus der aktuellen Dachgeometrie berechnet.
          </p>
        </div>
        {referenceSelector}
        <div className="space-y-3">
          <p className={labelClass}>Kanten</p>
          <div className="grid grid-cols-2 gap-2.5">
            {segments.map((segment) => {
              const isFirst =
                roofKind === "pitched" &&
                segment.segmentIndex === referenceEdgeIndex;
              return (
                <div key={segment.segmentIndex} className="min-w-0 space-y-2">
                  <label
                    htmlFor={`roof-edge-${roof.id}-${segment.segmentIndex}`}
                    className={`${fieldLabelClass} truncate ${
                      isFirst ? "font-medium text-primary" : ""
                    }`}
                  >
                    {edgeLabel(segment.segmentIndex)}
                  </label>
                  <NumericFieldWithSuffix
                    id={`roof-edge-${roof.id}-${segment.segmentIndex}`}
                    aria-label={`${edgeLabel(segment.segmentIndex)} (m)`}
                    data-stop-hotkeys="true"
                    inputMode="decimal"
                    suffix="m"
                    value={segmentInputs[segment.segmentIndex] ?? ""}
                    onChange={(event) =>
                      setSegmentInputs((current) => {
                        const next = [...current];
                        next[segment.segmentIndex] = event.target.value;
                        return next;
                      })
                    }
                    onBlur={() => commitSegment(segment.segmentIndex)}
                    onKeyDown={(event) => {
                      event.stopPropagation();
                      if (event.key === "Enter") {
                        event.preventDefault();
                        event.currentTarget.blur();
                      } else if (event.key === "Escape") {
                        event.preventDefault();
                        cancelSegmentBlur.current = segment.segmentIndex;
                        setSegmentInputs(
                          segments.map((item) => item.lengthM.toFixed(2)),
                        );
                        setError(undefined);
                        event.currentTarget.blur();
                      }
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>
        {error && <p className="text-[10px] text-destructive">{error}</p>}
        {geometryChanged && panels.some((panel) => panel.roofId === roof.id) && (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2 text-[10px] text-amber-700 dark:text-amber-300">
            Das bestehende Modullayout bleibt erhalten. Für die neue Dachgeometrie Layout erneut anwenden.
          </p>
        )}
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
    <section className="space-y-6">
      <div className="space-y-3">
        <label className={labelClass}>Dachfläche</label>
        <div className="grid grid-cols-2 gap-2.5">
          <div className="min-w-0 space-y-2">
            <label htmlFor={`roof-length-${roof.id}`} className={fieldLabelClass}>
              Länge
            </label>
            <NumericFieldWithSuffix
              id={`roof-length-${roof.id}`}
              aria-label="Dachlänge (m)"
              data-stop-hotkeys="true"
              inputMode="decimal"
              suffix="m"
              value={lengthInput}
              onChange={(event) => setLengthInput(event.target.value)}
              onBlur={() => commit("length")}
              onKeyDown={(event) => handleKeyDown(event, "length")}
            />
          </div>
          <div className="min-w-0 space-y-2">
            <label htmlFor={`roof-width-${roof.id}`} className={fieldLabelClass}>
              Breite
            </label>
            <NumericFieldWithSuffix
              id={`roof-width-${roof.id}`}
              aria-label="Dachbreite (m)"
              data-stop-hotkeys="true"
              inputMode="decimal"
              suffix="m"
              value={widthInput}
              onChange={(event) => setWidthInput(event.target.value)}
              onBlur={() => commit("width")}
              onKeyDown={(event) => handleKeyDown(event, "width")}
            />
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 text-[10px]">
          <span className="text-muted-foreground">Ausrichtung</span>
          <strong className="font-semibold tabular-nums text-foreground">
            {orientationFormatter.format(analysis.dimensions.canvasAngleDeg)}°
          </strong>
        </div>
      </div>
      {referenceSelector}
      <div className="space-y-3">
        <p className={labelClass}>Kanten</p>
        <div className="grid grid-cols-2 gap-2.5">
          {segments.map((segment) => {
            const isFirst =
              roofKind === "pitched" &&
              segment.segmentIndex === referenceEdgeIndex;
            return (
              <div
                key={segment.segmentIndex}
                className={[
                  "min-h-14 min-w-0 rounded-lg border bg-muted/10 px-3 py-2",
                  isFirst
                    ? "border-primary/45 bg-primary/5"
                    : "border-border/50",
                ].join(" ")}
              >
                <p
                  className={`truncate text-[10px] ${isFirst ? "font-medium text-primary" : "text-muted-foreground"}`}
                >
                  {edgeLabel(segment.segmentIndex)}
                </p>
                <p className="mt-1 whitespace-nowrap text-[11px] font-semibold tabular-nums text-foreground">
                  {formatDimensionM(segment.lengthM)}
                </p>
              </div>
            );
          })}
        </div>
      </div>
      {error && <p className="text-[10px] text-destructive">{error}</p>}
      {geometryChanged && panels.some((panel) => panel.roofId === roof.id) && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2 text-[10px] text-amber-700 dark:text-amber-300">
          Das bestehende Modullayout bleibt erhalten. Für die neue Dachgeometrie Layout erneut anwenden.
        </p>
      )}
    </section>
  );
}
