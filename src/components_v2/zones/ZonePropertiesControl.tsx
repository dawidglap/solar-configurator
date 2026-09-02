"use client";

import React from "react";
import toast from "react-hot-toast";

import {
  alignPolygonToRoofReference,
  getCanonicalRoofEdges,
  getPitchedRoofEdgeRoles,
  orthogonalizePolygonToRoofReference,
  resolveRoofReferenceEdgeIndex,
  type RoofKind,
} from "@/lib/planning-core/geometry-v2";
import type { RoofArea } from "@/types/planner";
import { history } from "../state/history";
import { usePlannerV2Store } from "../state/plannerV2Store";

const roleLabel = {
  first: "First",
  eaves: "Traufe",
  "gable-left": "Ortgang links",
  "gable-right": "Ortgang rechts",
  edge: undefined,
} as const;

export default function ZonePropertiesControl({
  roof,
  roofKind,
}: {
  roof: RoofArea;
  roofKind: RoofKind;
}) {
  const selectedZoneId = usePlannerV2Store((state) => state.selectedZoneId);
  const zone = usePlannerV2Store((state) =>
    state.zones.find((item) => item.id === selectedZoneId && item.roofId === roof.id),
  );
  const updateZone = usePlannerV2Store((state) => state.updateZone);
  const edges = React.useMemo(() => getCanonicalRoofEdges(roof.points), [roof.points]);
  const roles = React.useMemo(
    () => getPitchedRoofEdgeRoles({ points: roof.points, referenceEdgeIndex: roof.referenceEdgeIndex }),
    [roof.points, roof.referenceEdgeIndex],
  );
  if (!zone || !edges.length) return null;
  const fallback = resolveRoofReferenceEdgeIndex({
    points: roof.points,
    requestedIndex: roof.referenceEdgeIndex,
    roofKind,
  }) ?? 0;
  const requested = zone.edgeReference?.edgeIndex;
  const edgeIndex = Number.isInteger(requested) && (requested as number) >= 0 && (requested as number) < edges.length
    ? requested as number
    : fallback;
  const labelFor = (index: number) => {
    if (roofKind !== "pitched") return `Kante ${index + 1}`;
    return roleLabel[roles.get(index) ?? "edge"] ?? `Kante ${index + 1}`;
  };
  const applyGeometry = (
    action: "align" | "orthogonalize",
  ) => {
    const input = {
      points: zone.points,
      ownerRoofPoints: roof.points,
      roofKind,
      referenceEdgeIndex: edgeIndex,
    };
    const result = action === "align"
      ? alignPolygonToRoofReference(input)
      : orthogonalizePolygonToRoofReference(input);
    if (!result.valid) {
      toast.error("Die Änderung passt nicht vollständig auf diese Dachfläche.");
      return;
    }
    history.push(action === "align" ? "align reserved zone" : "orthogonalize reserved zone");
    updateZone(zone.id, {
      points: result.points,
      edgeReference: { edgeIndex },
      ...(action === "orthogonalize" ? { shapeKind: "rectangle" as const } : {}),
    });
  };
  return (
    <section className="space-y-2 border-b border-border/60 pb-4">
      <div>
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Hindernis</p>
        <p className="mt-1 text-[10px] text-muted-foreground">
          {zone.shapeKind === "rectangle" ? "Rechteck · als Ganzes verschiebbar" : "Freie Form"}
        </p>
      </div>
      <label className="block space-y-1 text-[10px] text-muted-foreground">
        Bezugskante
        <select
          className="glass-input h-8 w-full rounded-lg px-2 text-[11px] focus:ring-1 focus:ring-primary/40"
          value={edgeIndex}
          onChange={(event) => {
            history.push("change reserved zone reference edge");
            updateZone(zone.id, { edgeReference: { edgeIndex: Number(event.target.value) } });
          }}
        >
          {edges.map((edge) => (
            <option key={edge.edgeIndex} value={edge.edgeIndex}>
              {labelFor(edge.edgeIndex)} · {Math.round(edge.geographicAzimuthDeg)}°
            </option>
          ))}
        </select>
      </label>
      <div className="grid gap-2">
        <button
          type="button"
          onClick={() => applyGeometry("align")}
          className="h-8 rounded-lg border border-border/70 bg-muted/15 px-2 text-[10px] font-medium text-foreground hover:bg-muted/30"
        >
          Parallel zur Bezugskante
        </button>
        {zone.shapeKind !== "rectangle" && zone.points.length === 4 && (
          <button
            type="button"
            onClick={() => applyGeometry("orthogonalize")}
            className="h-8 rounded-lg border border-border/70 bg-muted/15 px-2 text-[10px] font-medium text-foreground hover:bg-muted/30"
          >
            Rechtwinklig machen
          </button>
        )}
      </div>
    </section>
  );
}
