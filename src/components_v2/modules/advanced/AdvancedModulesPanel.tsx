"use client";

import React from "react";
import { nanoid } from "nanoid";
import toast from "react-hot-toast";

import {
  K2_D_DOME_SYSTEM_ID,
  K2_S_DOME_SYSTEM_ID,
  type AdvancedSurfacePlanningV1,
} from "@/lib/planning-core/advanced";
import type { RoofArea } from "@/types/planner";
import { usePlannerV2Store } from "../../state/plannerV2Store";
import {
  alignAdvancedLayoutParallelToRoofEdge,
  computeAdvancedPlanningPreview,
  hasCommittedPanelsForRoof,
  materializeAdvancedPanels,
  replaceAdvancedDraftModule,
  setAdvancedFixedQuantity,
  setAdvancedMountingOrientation,
  setAdvancedQuantityMode,
} from "./advancedPlanningApplication";
import { buildGuidedPlanningResult } from "./guidedPlanningPresentation";

const inputClass =
  "glass-input h-8 w-full rounded-lg px-2 text-[11px] focus:ring-1 focus:ring-primary/40";
const labelClass =
  "block text-[10px] font-medium uppercase tracking-wide text-muted-foreground";

const fmt = (value: number, digits = 2) =>
  new Intl.NumberFormat("de-CH", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);

const normalizeAzimuth = (value: number) => ((value % 360) + 360) % 360;

function MountingChoiceGraphic({ opposing }: { opposing: boolean }) {
  return (
    <svg viewBox="0 0 72 28" aria-hidden="true" className="h-7 w-16">
      <path d="M5 24H67" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.35" />
      {opposing ? (
        <>
          <path d="M8 21L33 8L33 21Z" fill="currentColor" opacity="0.22" />
          <path d="M39 21L39 8L64 21Z" fill="currentColor" opacity="0.22" />
          <path d="M8 21L33 8M39 8L64 21" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </>
      ) : (
        <>
          <path d="M12 21L56 8L61 21Z" fill="currentColor" opacity="0.22" />
          <path d="M12 21L56 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

type Props = {
  roof: RoofArea;
  config: AdvancedSurfacePlanningV1;
  isDraft: boolean;
};

export default function AdvancedModulesPanel({ roof, config, isDraft }: Props) {
  const mppImage = usePlannerV2Store((state) => state.snapshot.mppImage);
  const zones = usePlannerV2Store((state) => state.zones);
  const snowGuards = usePlannerV2Store((state) => state.snowGuards);
  const panels = usePlannerV2Store((state) => state.panels);
  const catalogPanels = usePlannerV2Store((state) => state.catalogPanels);
  const setDraft = usePlannerV2Store((state) => state.setRoofPlanningDraft);
  const clearDraft = usePlannerV2Store((state) => state.clearRoofPlanningDraft);
  const commitRoofLayout = usePlannerV2Store((state) => state.commitRoofLayout);
  const [confirmReplace, setConfirmReplace] = React.useState(false);
  const [modulePickerOpen, setModulePickerOpen] = React.useState(false);
  const [fineTuningOpen, setFineTuningOpen] = React.useState(false);

  React.useEffect(() => {
    setModulePickerOpen(false);
    setFineTuningOpen(false);
    setConfirmReplace(false);
  }, [roof.id]);

  const preview = React.useMemo(
    () =>
      computeAdvancedPlanningPreview({
        roof,
        config,
        mppImage: mppImage ?? 0,
        zones,
        snowGuards,
      }),
    [roof, config, mppImage, zones, snowGuards],
  );

  const update = React.useCallback(
    (next: AdvancedSurfacePlanningV1) => {
      setConfirmReplace(false);
      setDraft(roof.id, { targetMode: "advanced", config: next });
    },
    [roof.id, setDraft],
  );

  const system = config.advanced.system;
  const isSDome = system.systemId === K2_S_DOME_SYSTEM_ID;
  const isDDome = system.systemId === K2_D_DOME_SYSTEM_ID;
  const isK2System = isSDome || isDDome;
  const orientation = isSDome ? "south" : "east-west";
  const azimuth = isSDome
    ? system.faceAzimuthDeg
    : isDDome
      ? system.primaryFaceAzimuthDeg
      : 90;
  const rowSpaceM = isK2System ? system.rowSpaceM : 0;
  const moduleId = config.advanced.module.panelSpecId ?? "";
  const hasPanels = hasCommittedPanelsForRoof(panels, roof.id);
  const canApply =
    isDraft &&
    config.surface.kind === "flat" &&
    isK2System &&
    preview.valid &&
    preview.moduleCount > 0 &&
    !!moduleId;
  const quantityMode = config.advanced.layout.quantityMode ?? "auto";
  const blocksPerRow = config.advanced.layout.blocksPerRow ?? 5;
  const rowCount = config.advanced.layout.rowCount ?? 3;
  const requestedBlocks = blocksPerRow * rowCount;
  const requestedModules = requestedBlocks * (isDDome ? 2 : 1);
  const selectedCatalogPanel = catalogPanels.find((panel) => panel.id === moduleId);
  const previewQuantity = preview.quantity;
  const result = buildGuidedPlanningResult({
    valid: preview.valid,
    quantityMode,
    requestedBlockCount: previewQuantity?.requestedBlockCount ?? preview.blockCount,
    validBlockCount: previewQuantity?.validBlockCount ?? preview.blockCount,
    requestedModuleCount: previewQuantity?.requestedModuleCount ?? preview.moduleCount,
    validModuleCount: previewQuantity?.validModuleCount ?? preview.moduleCount,
    blocksPerRow,
    rowCount,
    powerW: config.advanced.module.powerW,
    montageFieldCount: preview.montageFieldCount,
  });

  const apply = React.useCallback(() => {
    const latest = usePlannerV2Store.getState();
    const latestRoof = latest.layers.find((item) => item.id === roof.id);
    const latestDraft = latest.roofPlanningDrafts[roof.id];
    if (!latestRoof || latestDraft?.targetMode !== "advanced") return;
    const latestPreview = computeAdvancedPlanningPreview({
      roof: latestRoof,
      config: latestDraft.config,
      mppImage: latest.snapshot.mppImage ?? 0,
      zones: latest.zones,
      snowGuards: latest.snowGuards,
    });
    if (!latestPreview.valid || latestPreview.moduleCount === 0) return;
    const layoutRunId = nanoid();
    const nextPanels = materializeAdvancedPanels({
      roofId: roof.id,
      config: latestDraft.config,
      preview: latestPreview,
      layoutRunId,
      createPanelId: (index) => `${roof.id}_advanced_${layoutRunId}_${index}`,
    });
    if (!nextPanels.length) return;
    commitRoofLayout({
      roofId: roof.id,
      panels: nextPanels,
      surfacePlanning: latestDraft.config,
    });
    setConfirmReplace(false);
    toast.success("Layout angewendet");
  }, [commitRoofLayout, roof.id]);

  const requestApply = () => {
    if (!canApply) return;
    if (hasPanels && !confirmReplace) {
      setConfirmReplace(true);
      return;
    }
    apply();
  };

  const patchLayout = (
    patch: Partial<AdvancedSurfacePlanningV1["advanced"]["layout"]>,
  ) =>
    update({
      ...config,
      advanced: {
        ...config.advanced,
        layout: { ...config.advanced.layout, ...patch },
      },
    });

  const patchSystemNumber = (field: "rowSpaceM" | "azimuth", value: number) => {
    if (!Number.isFinite(value) || !isK2System) return;
    if (isSDome) {
      update({
        ...config,
        advanced: {
          ...config.advanced,
          system: {
            ...system,
            ...(field === "rowSpaceM"
              ? { rowSpaceM: value }
              : { faceAzimuthDeg: normalizeAzimuth(value) }),
          },
        },
      });
    } else if (isDDome) {
      update({
        ...config,
        advanced: {
          ...config.advanced,
          system: {
            ...system,
            ...(field === "rowSpaceM"
              ? { rowSpaceM: value }
              : { primaryFaceAzimuthDeg: normalizeAzimuth(value) }),
          },
        },
      });
    }
  };

  if (config.surface.kind !== "flat" || !isK2System) {
    return (
      <p className="rounded-lg border border-border/70 bg-muted/20 p-2 text-[10px] text-muted-foreground">
        Diese bestehende Dachkonfiguration bleibt gespeichert, kann in diesem Workflow aber nicht neu erstellt werden.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <section className="space-y-2 border-b border-border/60 pb-4">
        <h3 className={labelClass}>Aufständerung</h3>
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Aufständerung">
          <button
            type="button"
            aria-pressed={orientation === "south"}
            className={`flex min-h-20 flex-col items-center justify-center gap-1 rounded-xl border px-2 py-2 text-[11px] font-semibold transition ${orientation === "south" ? "border-primary bg-primary/10 text-primary ring-1 ring-primary/25" : "border-border/70 bg-muted/10 text-muted-foreground hover:border-primary/40"}`}
            onClick={() => update(setAdvancedMountingOrientation({ config, orientation: "south" }))}
          >
            <MountingChoiceGraphic opposing={false} />
            <span>Süd</span>
            <span className="text-[9px] font-normal opacity-75">K2 S-Dome 6.10</span>
          </button>
          <button
            type="button"
            aria-pressed={orientation === "east-west"}
            className={`flex min-h-20 flex-col items-center justify-center gap-1 rounded-xl border px-2 py-2 text-[11px] font-semibold transition ${orientation === "east-west" ? "border-primary bg-primary/10 text-primary ring-1 ring-primary/25" : "border-border/70 bg-muted/10 text-muted-foreground hover:border-primary/40"}`}
            onClick={() => update(setAdvancedMountingOrientation({ config, orientation: "east-west" }))}
          >
            <MountingChoiceGraphic opposing />
            <span>Ost-West</span>
            <span className="text-[9px] font-normal opacity-75">K2 D-Dome 6.10</span>
          </button>
        </div>
      </section>

      <section className="space-y-2 border-b border-border/60 pb-4">
        <h3 className={labelClass}>Modul</h3>
        <div className="rounded-xl border border-border/70 bg-muted/10 p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-[11px] font-semibold text-foreground">
                {selectedCatalogPanel
                  ? `${selectedCatalogPanel.brand} ${selectedCatalogPanel.model}`
                  : "PV Modul auswählen"}
              </p>
              <p className="mt-1 text-[10px] text-muted-foreground">
                {config.advanced.module.powerW != null ? `${fmt(config.advanced.module.powerW, 0)} W · ` : ""}
                {fmt(config.advanced.module.heightM * 1000, 0)} × {fmt(config.advanced.module.widthM * 1000, 0)} mm
              </p>
              <p className="mt-1 text-[10px] text-muted-foreground">Querformat · K2</p>
            </div>
            <button
              type="button"
              className="shrink-0 rounded-lg border border-border px-2 py-1.5 text-[10px] font-medium hover:border-primary/50"
              onClick={() => setModulePickerOpen((open) => !open)}
              aria-expanded={modulePickerOpen}
            >
              Modul ändern
            </button>
          </div>
          {modulePickerOpen && (
            <label className="mt-3 block space-y-1 text-[10px] text-muted-foreground" htmlFor={`advanced-module-${roof.id}`}>
              Modul auswählen
              <select
                id={`advanced-module-${roof.id}`}
                className={inputClass}
                value={moduleId}
                onChange={(event) => {
                  const panel = catalogPanels.find((item) => item.id === event.target.value);
                  if (panel) update(replaceAdvancedDraftModule({ config, panel }));
                }}
              >
                {catalogPanels.map((panel) => (
                  <option key={panel.id} value={panel.id}>
                    {panel.brand} {panel.model} — {panel.wp} W
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </section>

      <section className="space-y-3 border-b border-border/60 pb-4">
        <h3 className={labelClass}>Anzahl</h3>
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted/25 p-1" role="group" aria-label="Anzahl">
          <button
            type="button"
            aria-pressed={quantityMode === "auto"}
            className={`h-9 rounded-lg text-[10px] font-medium ${quantityMode === "auto" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
            onClick={() => update(setAdvancedQuantityMode({ config, mode: "auto" }))}
          >
            Automatisch
          </button>
          <button
            type="button"
            aria-pressed={quantityMode === "fixed"}
            className={`h-9 rounded-lg text-[10px] font-medium ${quantityMode === "fixed" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
            onClick={() => update(setAdvancedQuantityMode({ config, mode: "fixed" }))}
          >
            Anzahl festlegen
          </button>
        </div>
        {quantityMode === "auto" && (
          <p className="text-[10px] text-muted-foreground">
            {preview.blockCount} K2 Blocks · {preview.moduleCount} Module
          </p>
        )}
        {quantityMode === "fixed" && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1.5 text-[10px] text-muted-foreground">
                Blöcke pro Reihe
                <span className="grid grid-cols-[30px_1fr_30px] overflow-hidden rounded-lg border border-border">
                  <button type="button" aria-label="Weniger Blöcke pro Reihe" className="text-base text-muted-foreground hover:bg-muted/30" onClick={() => update(setAdvancedFixedQuantity({ config, blocksPerRow: Math.max(1, blocksPerRow - 1) }))}>−</button>
                  <input className="h-8 w-full border-x border-border bg-transparent text-center text-[11px] text-foreground outline-none" type="number" min={1} max={100} step={1} value={blocksPerRow} onChange={(event) => update(setAdvancedFixedQuantity({ config, blocksPerRow: Number(event.target.value) }))} />
                  <button type="button" aria-label="Mehr Blöcke pro Reihe" className="text-base text-muted-foreground hover:bg-muted/30" onClick={() => update(setAdvancedFixedQuantity({ config, blocksPerRow: Math.min(100, blocksPerRow + 1) }))}>+</button>
                </span>
              </label>
              <label className="space-y-1.5 text-[10px] text-muted-foreground">
                Reihen
                <span className="grid grid-cols-[30px_1fr_30px] overflow-hidden rounded-lg border border-border">
                  <button type="button" aria-label="Weniger Reihen" className="text-base text-muted-foreground hover:bg-muted/30" onClick={() => update(setAdvancedFixedQuantity({ config, rowCount: Math.max(1, rowCount - 1) }))}>−</button>
                  <input className="h-8 w-full border-x border-border bg-transparent text-center text-[11px] text-foreground outline-none" type="number" min={1} max={100} step={1} value={rowCount} onChange={(event) => update(setAdvancedFixedQuantity({ config, rowCount: Number(event.target.value) }))} />
                  <button type="button" aria-label="Mehr Reihen" className="text-base text-muted-foreground hover:bg-muted/30" onClick={() => update(setAdvancedFixedQuantity({ config, rowCount: Math.min(100, rowCount + 1) }))}>+</button>
                </span>
              </label>
            </div>
            <div className="rounded-xl border border-border/60 bg-muted/15 p-3 text-center text-[11px] leading-relaxed">
              <strong>{blocksPerRow} × {rowCount}</strong>
              <span className="block text-muted-foreground">= {requestedBlocks} K2 Blocks</span>
              <span className="block font-semibold text-foreground">= {requestedModules} Module</span>
            </div>
          </>
        )}
      </section>

      <section className="space-y-3 border-b border-border/60 pb-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className={labelClass}>Ausrichtung</h3>
          <button type="button" className="text-[10px] font-medium text-primary hover:underline" onClick={() => setFineTuningOpen(true)}>Manuell</button>
        </div>
        <button
          type="button"
          className="h-10 w-full rounded-xl border border-primary/40 bg-primary/5 text-[11px] font-semibold text-primary hover:bg-primary/10"
          onClick={() => update(alignAdvancedLayoutParallelToRoofEdge({ config, roof, mppImage: mppImage ?? 0 }))}
        >
          Parallel zur Dachkante
        </button>
        <div className="flex items-center justify-between rounded-lg bg-muted/15 px-3 py-2 text-[10px]">
          <span className="text-muted-foreground">Modulausrichtung</span>
          <strong>{isDDome ? `${fmt(azimuth, 0)}° / ${fmt(normalizeAzimuth(azimuth + 180), 0)}°` : `${fmt(azimuth, 0)}°`}</strong>
        </div>
      </section>

      <section className="space-y-2 border-b border-border/60 pb-4">
        <h3 className={labelClass}>Abstände</h3>
        <label className="block space-y-1 text-[10px] text-muted-foreground">
          Reihenabstand
          <div className="flex items-center gap-2">
            <input
              className={inputClass}
              type="number"
              min={0}
              step={0.01}
              value={rowSpaceM}
              onChange={(event) => patchSystemNumber("rowSpaceM", Number(event.target.value))}
            />
            <span>m</span>
          </div>
        </label>
        {preview.derived?.kind === "k2" && (
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
            <span>Wartungsgang</span><span className="text-right text-foreground">{fmt(preview.derived.serviceCorridorM)} m</span>
            <span>Modulabstand</span><span className="text-right text-foreground">{fmt(preview.derived.moduleLongSideSpacingM * 1000, 0)} mm · K2</span>
            <span>Modulneigung</span><span className="text-right font-medium text-foreground" title="Die geometrische Systemneigung wird anhand der K2-Systemmaße berechnet.">10°</span>
          </div>
        )}
        <label className="block space-y-1 text-[10px] text-muted-foreground">
          Randabstand
          <span className="flex items-center gap-2">
            <input className={inputClass} type="number" min={0} step={0.05} value={config.advanced.layout.marginM} onChange={(event) => patchLayout({ marginM: Math.max(0, Number(event.target.value)) })} />
            <span>m</span>
          </span>
        </label>
      </section>

      <section className="rounded-xl border border-border/60 text-[10px]">
        <button type="button" className="flex w-full items-center justify-between px-3 py-2.5 text-left font-medium text-muted-foreground" onClick={() => setFineTuningOpen((open) => !open)} aria-expanded={fineTuningOpen}>
          <span>Feinjustierung</span><span aria-hidden="true">{fineTuningOpen ? "▴" : "▾"}</span>
        </button>
        {fineTuningOpen && <div className="space-y-3 border-t border-border/60 p-3">
          <label className="block space-y-1 text-muted-foreground">
            Ausrichtung manuell
            <span className="flex items-center gap-2">
              <input className={inputClass} type="number" min={0} max={359} step={1} value={azimuth} onChange={(event) => patchSystemNumber("azimuth", Number(event.target.value))} />
              <span>°</span>
            </span>
          </label>
          <div className="grid grid-cols-2 gap-2">
          {(["phaseX", "phaseY"] as const).map((field) => (
            <label key={field} className="space-y-1 text-muted-foreground">
              {field}
              <input
                className={inputClass}
                type="number"
                min={0}
                max={0.999}
                step={0.05}
                value={config.advanced.layout[field]}
                onChange={(event) => patchLayout({ [field]: Number(event.target.value) })}
              />
            </label>
          ))}
          {(["anchorX", "anchorY"] as const).map((field) => (
            <label key={field} className="space-y-1 text-muted-foreground">
              {field}
              <select
                className={inputClass}
                value={config.advanced.layout[field]}
                onChange={(event) => patchLayout({ [field]: event.target.value as "start" | "center" | "end" })}
              >
                <option value="start">Start</option>
                <option value="center">Mitte</option>
                <option value="end">Ende</option>
              </select>
            </label>
          ))}
          </div>
          {preview.derived?.kind === "k2" && (
            <div className="border-t border-border/60 pt-2 text-muted-foreground">
              <p>Effektive geometrische Neigung: {fmt(preview.derived.effectiveTiltDeg, 3)}°</p>
              <p className="mt-1">{isSDome ? "K2 S-Dome 6.10 Classic" : "K2 D-Dome 6.10 Classic"}</p>
            </div>
          )}
          {preview.warnings.some((warning) => warning.code.includes("block-size")) && (
            <p className="text-amber-700 dark:text-amber-300">Die K2 Blockgrösse überschreitet die dokumentierte Systemgrenze.</p>
          )}
        </div>
        }
      </section>

      <section className={`rounded-xl border p-3 ${result.status === "valid" ? "border-primary/30 bg-primary/5" : "border-destructive/40 bg-destructive/5"}`} aria-live="polite">
        <p className={`text-[12px] font-semibold ${result.status === "valid" ? "text-primary" : "text-destructive"}`}>
          {result.status === "valid" ? "✓ " : ""}{result.title}
        </p>
        {result.validityLabel && <p className="mt-1 text-[10px] font-medium text-destructive">{result.validityLabel}</p>}
        {result.guidance && <p className="mt-1 text-[10px] text-muted-foreground">{result.guidance}</p>}
        {result.status === "valid" && (
          <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
            <span className="text-muted-foreground">Module</span><strong className="text-right">{result.moduleCount}</strong>
            <span className="text-muted-foreground">K2 Blocks</span><strong className="text-right">{result.blockCount}</strong>
            <span className="text-muted-foreground">Montagefelder</span><strong className="text-right">{result.montageFieldCount ?? 0}</strong>
            {result.powerKWp != null && <><span className="text-muted-foreground">Leistung</span><strong className="text-right">{fmt(result.powerKWp)} kWp</strong></>}
            <span className="text-muted-foreground">System</span><span className="text-right">{isSDome ? "Süd · K2 S-Dome" : "Ost-West · K2 D-Dome"}</span>
            <span className="text-muted-foreground">Anordnung</span><span className="text-right">{result.arrangementLabel}</span>
          </div>
        )}
      </section>

      <p className="rounded-lg border border-border/70 bg-muted/20 p-2 text-[10px] leading-relaxed text-muted-foreground">
        Vorplanung: Statik, Wind- und Schneelasten, Ballastierung und Befestigung wurden nicht geprüft.
      </p>

      {confirmReplace && (
        <div className="space-y-2 rounded-lg border border-amber-500/35 bg-amber-500/5 p-2 text-[10px]">
          <p className="font-semibold">Bestehendes Modullayout ersetzen?</p>
          <p>Das aktuelle Layout dieser Fläche wird durch die neue Planung ersetzt.</p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="h-8 rounded-lg border border-border" onClick={() => setConfirmReplace(false)}>Abbrechen</button>
            <button type="button" className="h-8 rounded-lg bg-primary font-medium text-primary-foreground" onClick={apply}>Ersetzen</button>
          </div>
        </div>
      )}

      {!confirmReplace && (
        <div className="sticky bottom-0 -mx-2 border-t border-border/70 bg-background/95 px-2 py-3 backdrop-blur">
          {isDraft && <p className="mb-2 text-center text-[10px] text-muted-foreground">Nicht angewendete Änderungen</p>}
          <div className="grid grid-cols-[0.8fr_1.2fr] gap-2">
          <button
            type="button"
            disabled={!isDraft}
            onClick={() => { clearDraft(roof.id); setConfirmReplace(false); }}
            className="h-9 rounded-lg border border-border text-[11px] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Abbrechen
          </button>
          <button
            type="button"
            disabled={!canApply}
            onClick={requestApply}
            className="h-9 rounded-lg bg-primary px-2 text-[11px] font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"
          >
            Layout anwenden
          </button>
          </div>
        </div>
      )}
    </div>
  );
}
