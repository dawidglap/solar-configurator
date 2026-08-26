"use client";

import React, { useMemo } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  ChevronRight,
  Layers3,
  PanelsTopLeft,
  X,
  Zap,
} from "lucide-react";

import { usePlannerV2Store } from "../../state/plannerV2Store";
import {
  buildPlanningOverview,
  type PlanningOverviewPower,
  type PlanningOverviewRoof,
} from "@/lib/planning-core/overview";
import {
  K2_D_DOME_SYSTEM_ID,
  K2_S_DOME_SYSTEM_ID,
  resolveSurfacePlanning,
} from "@/lib/planning-core/advanced";

type Props = {
  open: boolean;
  onClose: () => void;
};

const number2 = new Intl.NumberFormat("de-CH", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatPower(power: PlanningOverviewPower): string {
  if (power.complete) return `${number2.format(power.kwp ?? 0)} kWp`;
  if (power.knownPanelCount > 0) {
    return `mind. ${number2.format(power.knownKwp)} kWp · ${power.missingPanelCount} ohne Leistungsdaten`;
  }
  return "Nicht verfügbar";
}

function formatAzimuth(values: number[] | undefined): string | undefined {
  if (!values?.length) return undefined;
  return values
    .map((value) => `${Number.isInteger(value) ? value.toFixed(0) : number2.format(value)}°`)
    .join(" / ");
}

function surfaceLabel(kind: PlanningOverviewRoof["surfaceKind"]): string {
  if (kind === "flat") return "Flachdach";
  if (kind === "green") return "Gründach";
  return "Schrägdach";
}

function systemLabel(roof: PlanningOverviewRoof): string | undefined {
  if (roof.systemId === K2_D_DOME_SYSTEM_ID) return "K2 D-Dome 6.10 Classic";
  if (roof.systemId === K2_S_DOME_SYSTEM_ID) return "K2 S-Dome 6.10 Classic";
  if (roof.systemId === "generic-east-west") return "Generisches Ost-West-System";
  if (roof.systemId === "generic-south") return "Generisches Süd-System";
  return roof.systemId;
}

function RoofValue({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-start justify-between gap-3 text-[11px]">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right font-medium text-foreground">{value}</dd>
    </div>
  );
}

function RoofCard({
  roof,
  onSelect,
}: {
  roof: PlanningOverviewRoof;
  onSelect: (roofId: string) => void;
}) {
  const isK2 =
    roof.systemId === K2_D_DOME_SYSTEM_ID ||
    roof.systemId === K2_S_DOME_SYSTEM_ID;
  const isFlatK2 = isK2 && roof.surfaceKind === "flat";
  const unsupported =
    roof.configurationStatus === "unsupported" ||
    roof.configurationStatus === "invalid";
  const arrangement =
    roof.arrangement.mode === "fixed"
      ? `${roof.arrangement.blocksPerRow} Blöcke pro Reihe × ${roof.arrangement.rowCount} Reihen`
      : roof.arrangement.mode === "auto"
        ? "Automatisch"
        : undefined;

  return (
    <article className="overflow-hidden rounded-xl border border-border/70 bg-card/80 shadow-sm">
      <button
        type="button"
        onClick={() => onSelect(roof.id)}
        className="flex w-full items-center gap-3 px-3 py-3 text-left transition hover:bg-muted/35 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary/35"
        aria-label={`${roof.displayName} im Planner auswählen`}
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <PanelsTopLeft className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="truncate text-xs font-semibold text-foreground">
              {roof.displayName}
            </h3>
            <span className="rounded-full border border-border/70 bg-muted/40 px-2 py-0.5 text-[9px] font-medium text-muted-foreground">
              {surfaceLabel(roof.surfaceKind)}
            </span>
            {roof.hasUnappliedDraft && (
              <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[9px] font-medium text-amber-700 dark:text-amber-300">
                Nicht angewendete Änderungen
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            {unsupported
              ? "Konfiguration nicht unterstützt"
              : roof.mountingOrientation === "east-west"
                ? "Flachdach · Ost-West"
                : roof.mountingOrientation === "south"
                  ? "Flachdach · Süd"
                  : surfaceLabel(roof.surfaceKind)}
          </p>
        </div>
        {roof.warnings.length > 0 && (
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" aria-label="Warnung" />
        )}
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>

      <div className="border-t border-border/60 px-3 py-3">
        <dl className="grid gap-1.5">
          {unsupported ? (
            <RoofValue label="Status" value="Konfiguration nicht unterstützt" />
          ) : (
            <>
              {roof.mountingOrientation && (
                <RoofValue
                  label="Aufständerung"
                  value={roof.mountingOrientation === "east-west" ? "Ost-West" : "Süd"}
                />
              )}
              {systemLabel(roof) && <RoofValue label="System" value={systemLabel(roof)} />}
              {formatAzimuth(roof.orientationAzimuthDeg) && (
                <RoofValue label="Ausrichtung" value={formatAzimuth(roof.orientationAzimuthDeg)} />
              )}
              {arrangement && <RoofValue label="Anordnung" value={arrangement} />}
              {isK2 && (
                <RoofValue
                  label="K2 Blocks"
                  value={roof.blockCount === undefined ? "Nicht verfügbar" : roof.blockCount}
                />
              )}
              {roof.arrangement.mode === "fixed" && (
                <RoofValue label="Reihen" value={roof.arrangement.rowCount} />
              )}
            </>
          )}

          <RoofValue label="Module" value={roof.moduleCount} />
          <RoofValue label="Leistung" value={formatPower(roof.power)} />
          {roof.moduleLabel && <RoofValue label="Modul" value={roof.moduleLabel} />}
          {isFlatK2 && roof.rowSpaceM !== undefined && (
            <RoofValue label="Reihenabstand" value={`${number2.format(roof.rowSpaceM)} m`} />
          )}
          {isFlatK2 && roof.serviceCorridorM !== undefined && (
            <RoofValue label="Wartungsgang" value={`${number2.format(roof.serviceCorridorM)} m`} />
          )}
          {isK2 && roof.nominalTiltDeg !== undefined && (
            <RoofValue label="Modulneigung" value={`${roof.nominalTiltDeg}°`} />
          )}
          {roof.marginM !== undefined && (
            <RoofValue label="Randabstand" value={`${number2.format(roof.marginM)} m`} />
          )}
          {roof.roofDimensions && (
            <RoofValue
              label="Dachmaß"
              value={`${number2.format(roof.roofDimensions.lengthM)} × ${number2.format(roof.roofDimensions.widthM)} m`}
            />
          )}
          {!roof.roofDimensions && roof.roofAreaM2 !== undefined && (
            <RoofValue label="Fläche" value={`${number2.format(roof.roofAreaM2)} m²`} />
          )}
        </dl>

        {roof.warnings.length > 0 && (
          <div className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/5 px-2.5 py-2 text-[10px] text-amber-800 dark:text-amber-200">
            {roof.warnings[0].message}
            {roof.warnings.length > 1 && ` · ${roof.warnings.length - 1} weitere Hinweise`}
          </div>
        )}
      </div>
    </article>
  );
}

export default function PlanningOverviewDrawer({ open, onClose }: Props) {
  const roofs = usePlannerV2Store((state) => state.layers);
  const panels = usePlannerV2Store((state) => state.panels);
  const catalogPanels = usePlannerV2Store((state) => state.catalogPanels);
  const mppImage = usePlannerV2Store((state) => state.snapshot.mppImage);
  const drafts = usePlannerV2Store((state) => state.roofPlanningDrafts);
  const select = usePlannerV2Store((state) => state.select);
  const setStep = usePlannerV2Store((state) => state.setStep);
  const setTool = usePlannerV2Store((state) => state.setTool);
  const setUI = usePlannerV2Store((state) => state.setUI);

  const dirtyRoofIds = useMemo(
    () =>
      Object.entries(drafts)
        .filter(([roofId, draft]) => {
          const roof = roofs.find((item) => item.id === roofId);
          if (!roof) return false;
          const committed = resolveSurfacePlanning(roof.surfacePlanning);
          if (
            draft.targetMode === "advanced" &&
            committed.status === "supported-advanced"
          ) {
            return JSON.stringify(draft.config) !== JSON.stringify(committed.config);
          }
          return true;
        })
        .map(([roofId]) => roofId),
    [drafts, roofs],
  );

  const overview = useMemo(
    () =>
      buildPlanningOverview({
        roofs,
        panels,
        catalogModules: catalogPanels.map((panel) => ({
          id: panel.id,
          brand: panel.brand,
          model: panel.model,
          powerW: panel.wp,
        })),
        mppImage,
        dirtyRoofIds,
      }),
    [catalogPanels, dirtyRoofIds, mppImage, panels, roofs],
  );

  React.useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener("keydown", closeOnEscape, true);
    return () => window.removeEventListener("keydown", closeOnEscape, true);
  }, [onClose, open]);

  if (!open || typeof document === "undefined") return null;

  const selectRoof = (roofId: string) => {
    select(roofId);
    setTool("select");
    setStep("modules");
    setUI({ rightPanelOpen: true, leftPanelOpen: false });
    onClose();
  };

  return createPortal(
    <aside
      role="dialog"
      aria-modal="false"
      aria-label="Planungsübersicht"
      className="glass-panel-elevated fixed bottom-3 right-3 top-[calc(var(--tb,48px)+8px)] z-[900] flex w-[min(92vw,460px)] flex-col overflow-hidden rounded-2xl border border-border/80 shadow-2xl"
    >
      <header className="flex items-start justify-between gap-3 border-b border-border/70 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-foreground">
            Planungsübersicht
          </h2>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            Angewendete Planung aller Dachflächen
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border/70 text-muted-foreground transition hover:bg-muted hover:text-foreground"
          aria-label="Planungsübersicht schließen"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <section aria-label="Gesamtübersicht" className="grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-border/70 bg-muted/20 p-2.5">
            <Layers3 className="mb-2 h-4 w-4 text-primary" />
            <div className="text-lg font-semibold tabular-nums text-foreground">
              {overview.roofCount}
            </div>
            <div className="text-[9px] uppercase tracking-wide text-muted-foreground">
              Dachflächen
            </div>
          </div>
          <div className="rounded-xl border border-border/70 bg-muted/20 p-2.5">
            <PanelsTopLeft className="mb-2 h-4 w-4 text-primary" />
            <div className="text-lg font-semibold tabular-nums text-foreground">
              {overview.moduleCount}
            </div>
            <div className="text-[9px] uppercase tracking-wide text-muted-foreground">
              Module
            </div>
          </div>
          <div className="rounded-xl border border-border/70 bg-muted/20 p-2.5">
            <Zap className="mb-2 h-4 w-4 text-primary" />
            <div className="text-sm font-semibold tabular-nums text-foreground">
              {overview.power.complete
                ? number2.format(overview.power.kwp ?? 0)
                : "—"}
            </div>
            <div className="text-[9px] uppercase tracking-wide text-muted-foreground">
              kWp
            </div>
          </div>
        </section>

        {!overview.power.complete && overview.moduleCount > 0 && (
          <p className="mt-2 rounded-lg border border-border/70 bg-muted/20 px-2.5 py-2 text-[10px] text-muted-foreground">
            Die Gesamtleistung ist nicht vollständig verfügbar: {overview.power.missingPanelCount} Module ohne Leistungsdaten.
          </p>
        )}

        <section className="mt-4 space-y-2.5" aria-label="Dachflächen">
          {overview.roofs.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-5 text-center text-xs text-muted-foreground">
              Noch keine Dachflächen vorhanden.
            </div>
          ) : (
            overview.roofs.map((roof) => (
              <RoofCard key={roof.id} roof={roof} onSelect={selectRoof} />
            ))
          )}
        </section>

        <footer className="mt-4 rounded-xl border border-border/70 bg-muted/25 px-3 py-3 text-[10px] leading-relaxed text-muted-foreground">
          Vorplanung: Statik, Wind- und Schneelasten, Ballastierung und Befestigung wurden nicht geprüft.
        </footer>
      </div>
    </aside>,
    document.body,
  );
}
