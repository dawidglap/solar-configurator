"use client";

import React from "react";
import { nanoid } from "nanoid";

import {
  GENERIC_EAST_WEST_SYSTEM_ID,
  GENERIC_SOUTH_SYSTEM_ID,
  GREEN_ROOF_GENERIC_SPACING_RANGE_M,
  GREEN_ROOF_GENERIC_TILT_RANGE_DEG,
  GREEN_ROOF_UNDERSIDE_CLEARANCE_RANGE_M,
  K2_D_DOME_SYSTEM_ID,
  K2_S_DOME_SYSTEM_ID,
  type AdvancedSurfacePlanningV1,
} from "@/lib/planning-core/advanced";
import type { RoofArea } from "@/types/planner";
import { usePlannerV2Store } from "../../state/plannerV2Store";
import {
  computeAdvancedPlanningPreview,
  hasCommittedPanelsForRoof,
  materializeAdvancedPanels,
  replaceAdvancedDraftModule,
  setAdvancedModuleOrientation,
  setAdvancedMountingOrientation,
  setAdvancedSurfaceKind,
} from "./advancedPlanningApplication";

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
  const isK2System = system.systemId === K2_S_DOME_SYSTEM_ID || system.systemId === K2_D_DOME_SYSTEM_ID;
  const isGenericSystem =
    system.systemId === GENERIC_SOUTH_SYSTEM_ID ||
    system.systemId === GENERIC_EAST_WEST_SYSTEM_ID;
  const isGreenRoof = config.surface.kind === "green";
  const orientation =
    system.systemId === K2_S_DOME_SYSTEM_ID ||
    system.systemId === GENERIC_SOUTH_SYSTEM_ID
      ? "south"
      : "east-west";
  const azimuth =
    system.systemId === K2_S_DOME_SYSTEM_ID
      ? system.faceAzimuthDeg
      : "primaryFaceAzimuthDeg" in system
        ? system.primaryFaceAzimuthDeg
        : 90;
  const rowSpaceM = "rowSpaceM" in system ? system.rowSpaceM : 0;
  const moduleId = config.advanced.module.panelSpecId ?? "";
  const hasPanels = hasCommittedPanelsForRoof(panels, roof.id);
  const systemMatchesSurface = isGreenRoof ? isGenericSystem : isK2System;
  const canApply = isDraft && systemMatchesSurface && preview.valid && preview.moduleCount > 0 && !!moduleId;

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
  }, [commitRoofLayout, roof.id]);

  const requestApply = () => {
    if (!canApply) return;
    if (hasPanels && !confirmReplace) {
      setConfirmReplace(true);
      return;
    }
    apply();
  };

  const patchSurface = (patch: Partial<AdvancedSurfacePlanningV1["surface"]>) =>
    update({ ...config, surface: { ...config.surface, ...patch } });
  const patchLayout = (patch: Partial<AdvancedSurfacePlanningV1["advanced"]["layout"]>) =>
    update({
      ...config,
      advanced: {
        ...config.advanced,
        layout: { ...config.advanced.layout, ...patch },
      },
    });
  const patchSystemNumber = (field: "rowSpaceM" | "azimuth", value: number) => {
    if (!Number.isFinite(value)) return;
    if (system.systemId === K2_S_DOME_SYSTEM_ID) {
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
    } else {
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
  const patchGenericSystem = (patch: Record<string, number>) => {
    if (!isGenericSystem || Object.values(patch).some((value) => !Number.isFinite(value))) return;
    update({
      ...config,
      advanced: {
        ...config.advanced,
        system: { ...system, ...patch },
      },
    } as AdvancedSurfacePlanningV1);
  };

  const patchUndersideClearanceCm = (valueCm: number) => {
    if (!Number.isFinite(valueCm)) return;
    update({
      ...config,
      advanced: {
        ...config.advanced,
        undersideClearanceM: valueCm / 100,
      },
    });
  };

  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <span className={labelClass}>Dach</span>
        <div className="grid grid-cols-3 gap-1">
          <button
            type="button"
            onClick={() => update(setAdvancedSurfaceKind({ config, kind: "flat" }))}
            className={`h-8 rounded-lg text-[10px] font-medium ${!isGreenRoof ? "bg-primary/15 text-primary ring-1 ring-primary/35" : "bg-muted/25 text-muted-foreground"}`}
          >
            Flachdach
          </button>
          <button disabled className="h-8 cursor-not-allowed rounded-lg bg-muted/30 text-[10px] opacity-45">
            Schrägdach
          </button>
          <button
            type="button"
            onClick={() => update(setAdvancedSurfaceKind({ config, kind: "green" }))}
            className={`h-8 rounded-lg text-[10px] font-medium ${isGreenRoof ? "bg-primary/15 text-primary ring-1 ring-primary/35" : "bg-muted/25 text-muted-foreground"}`}
          >
            Gründach
          </button>
        </div>
        {isGreenRoof && (
          <label className="block space-y-1 text-[10px] text-muted-foreground">
            Höhe UK
            <div className="flex items-center gap-2">
              <input
                className={inputClass}
                type="number"
                min={GREEN_ROOF_UNDERSIDE_CLEARANCE_RANGE_M.min * 100}
                max={GREEN_ROOF_UNDERSIDE_CLEARANCE_RANGE_M.max * 100}
                step={1}
                value={(config.advanced.undersideClearanceM ?? 0) * 100}
                onChange={(event) => patchUndersideClearanceCm(Number(event.target.value))}
              />
              <span>cm</span>
            </div>
          </label>
        )}
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1 text-[10px] text-muted-foreground">
            Dachgefälle °
            <input
              className={inputClass}
              type="number"
              min={0}
              max={60}
              step={0.5}
              value={config.surface.slopeDeg ?? 0}
              onChange={(event) => patchSurface({ slopeDeg: Number(event.target.value) })}
            />
          </label>
          <label className="space-y-1 text-[10px] text-muted-foreground">
            Gefällerichtung °
            <input
              className={inputClass}
              type="number"
              min={0}
              max={359}
              step={1}
              value={config.surface.fallAzimuthDeg ?? 180}
              onChange={(event) =>
                patchSurface({ fallAzimuthDeg: normalizeAzimuth(Number(event.target.value)) })
              }
            />
          </label>
        </div>
      </section>

      <section className="space-y-2">
        <span className={labelClass}>Aufständerung</span>
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted/25 p-1">
          <button
            className={`h-8 rounded-md text-[10px] ${orientation === "south" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
            onClick={() => update(setAdvancedMountingOrientation({ config, orientation: "south" }))}
          >
            {isGreenRoof ? "Süd · Freie Vorplanung" : "Süd · K2 S-Dome"}
          </button>
          <button
            className={`h-8 rounded-md text-[10px] ${orientation === "east-west" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
            onClick={() => update(setAdvancedMountingOrientation({ config, orientation: "east-west" }))}
          >
            {isGreenRoof ? "Ost-West · Freie Vorplanung" : "Ost-West · K2 D-Dome"}
          </button>
        </div>
        {isGreenRoof && (
          <p className="text-[10px] text-muted-foreground">
            Keine K2 GreenRoof Systemgeometrie hinterlegt.
          </p>
        )}
      </section>

      <section className="space-y-2">
        <label className={labelClass} htmlFor={`advanced-module-${roof.id}`}>PV Modul</label>
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
        {isGreenRoof ? (
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted/25 p-1">
            {(["portrait", "landscape"] as const).map((moduleOrientation) => (
              <button
                key={moduleOrientation}
                type="button"
                onClick={() => update(setAdvancedModuleOrientation({ config, orientation: moduleOrientation }))}
                className={`h-8 rounded-md text-[10px] ${config.advanced.module.orientation === moduleOrientation ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
              >
                {moduleOrientation === "portrait" ? "Hochformat" : "Querformat"}
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-border/70 bg-muted/20 px-2 py-1.5 text-[10px] text-muted-foreground">
            Querformat · {fmt(config.advanced.module.widthM, 3)} × {fmt(config.advanced.module.heightM, 3)} m
          </div>
        )}
      </section>

      <section className="space-y-2">
        <span className={labelClass}>{isGreenRoof ? "Freie Geometrie" : "K2 Geometrie"}</span>
        {!isGreenRoof && (
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
        )}
        {isGreenRoof && isGenericSystem && (
          <>
            <label className="block space-y-1 text-[10px] text-muted-foreground">
              Modulneigung
              <div className="flex items-center gap-2">
                <input
                  className={inputClass}
                  type="number"
                  min={GREEN_ROOF_GENERIC_TILT_RANGE_DEG.min}
                  max={GREEN_ROOF_GENERIC_TILT_RANGE_DEG.max}
                  step={0.5}
                  value={system.nominalTiltDeg}
                  onChange={(event) => patchGenericSystem({ nominalTiltDeg: Number(event.target.value) })}
                />
                <span>°</span>
              </div>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1 text-[10px] text-muted-foreground">
                Modulabstand horizontal
                <div className="flex items-center gap-1">
                  <input
                    className={inputClass}
                    type="number"
                    min={GREEN_ROOF_GENERIC_SPACING_RANGE_M.min}
                    max={GREEN_ROOF_GENERIC_SPACING_RANGE_M.max}
                    step={0.01}
                    value={system.moduleGapX ?? 0}
                    onChange={(event) => patchGenericSystem({ moduleGapX: Number(event.target.value) })}
                  />
                  <span>m</span>
                </div>
              </label>
              <label className="space-y-1 text-[10px] text-muted-foreground">
                Modulabstand vertikal
                <div className="flex items-center gap-1">
                  <input
                    className={inputClass}
                    type="number"
                    min={GREEN_ROOF_GENERIC_SPACING_RANGE_M.min}
                    max={GREEN_ROOF_GENERIC_SPACING_RANGE_M.max}
                    step={0.01}
                    value={system.systemId === GENERIC_SOUTH_SYSTEM_ID ? system.moduleGapY ?? 0 : system.interModuleGapM}
                    onChange={(event) =>
                      patchGenericSystem(
                        system.systemId === GENERIC_SOUTH_SYSTEM_ID
                          ? { moduleGapY: Number(event.target.value) }
                          : { interModuleGapM: Number(event.target.value) },
                      )
                    }
                  />
                  <span>m</span>
                </div>
              </label>
              <label className="space-y-1 text-[10px] text-muted-foreground">
                Blockabstand horizontal
                <div className="flex items-center gap-1">
                  <input
                    className={inputClass}
                    type="number"
                    min={GREEN_ROOF_GENERIC_SPACING_RANGE_M.min}
                    max={GREEN_ROOF_GENERIC_SPACING_RANGE_M.max}
                    step={0.05}
                    value={system.blockGapX}
                    onChange={(event) => patchGenericSystem({ blockGapX: Number(event.target.value) })}
                  />
                  <span>m</span>
                </div>
              </label>
              <label className="space-y-1 text-[10px] text-muted-foreground">
                Blockabstand vertikal
                <div className="flex items-center gap-1">
                  <input
                    className={inputClass}
                    type="number"
                    min={GREEN_ROOF_GENERIC_SPACING_RANGE_M.min}
                    max={GREEN_ROOF_GENERIC_SPACING_RANGE_M.max}
                    step={0.05}
                    value={system.blockGapY}
                    onChange={(event) => patchGenericSystem({ blockGapY: Number(event.target.value) })}
                  />
                  <span>m</span>
                </div>
              </label>
            </div>
          </>
        )}
        <label className="block space-y-1 text-[10px] text-muted-foreground">
          {orientation === "south" ? "Modulausrichtung" : "Primäre Ausrichtung"}
          <div className="flex items-center gap-2">
            <input
              className={inputClass}
              type="number"
              min={0}
              max={359}
              step={1}
              value={azimuth}
              onChange={(event) =>
                isGenericSystem
                  ? patchGenericSystem(
                      system.systemId === GENERIC_SOUTH_SYSTEM_ID
                        ? { faceAzimuthDeg: normalizeAzimuth(Number(event.target.value)) }
                        : { primaryFaceAzimuthDeg: normalizeAzimuth(Number(event.target.value)) },
                    )
                  : patchSystemNumber("azimuth", Number(event.target.value))
              }
            />
            <span>°</span>
          </div>
        </label>
        {orientation === "east-west" && (
          <p className="text-[10px] text-muted-foreground">
            Gegenüberliegende Seite: {fmt(normalizeAzimuth(azimuth + 180), 0)}°
          </p>
        )}
        <label className="block space-y-1 text-[10px] text-muted-foreground">
          Randabstand
          <div className="flex items-center gap-2">
            <input
              className={inputClass}
              type="number"
              min={0}
              step={0.05}
              value={config.advanced.layout.marginM}
              onChange={(event) => patchLayout({ marginM: Math.max(0, Number(event.target.value)) })}
            />
            <span>m</span>
          </div>
        </label>
      </section>

      <details className="rounded-lg border border-border/60 px-2 py-2 text-[10px]">
        <summary className="cursor-pointer font-medium text-muted-foreground">Feinausrichtung</summary>
        <div className="mt-3 grid grid-cols-2 gap-2">
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
      </details>

      {preview.valid ? (
        <section className="rounded-xl border border-primary/25 bg-primary/5 p-3 text-[10px]">
          <div className="mb-2 font-semibold text-foreground">Planungsübersicht</div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-muted-foreground">
            {isGreenRoof && <><span>Dachtyp</span><span className="text-right text-foreground">Gründach</span></>}
            <span>System</span><span className="text-right text-foreground">{isGreenRoof ? "Freie Vorplanung" : orientation === "south" ? "K2 S-Dome" : "K2 D-Dome"}</span>
            {isGreenRoof && <><span>Höhe UK</span><span className="text-right text-foreground">{fmt((config.advanced.undersideClearanceM ?? 0) * 100, 0)} cm</span></>}
            {isGreenRoof && <><span>Aufständerung</span><span className="text-right text-foreground">{orientation === "south" ? "Süd" : "Ost-West"}</span></>}
            <span>Blöcke</span><span className="text-right text-foreground">{preview.blockCount}</span>
            <span>Module</span><span className="text-right text-foreground">{preview.moduleCount}</span>
            <span>Leistung</span><span className="text-right text-foreground">{fmt((config.advanced.module.powerW ?? 0) * preview.moduleCount / 1000)} kWp</span>
            {preview.derived.kind === "generic" ? (
              <><span>Neigung</span><span className="text-right text-foreground">{fmt(preview.derived.nominalTiltDeg, 1)}°</span></>
            ) : (
              <>
                <span>Neigung nominal / effektiv</span><span className="text-right text-foreground">{fmt(preview.derived.nominalTiltDeg, 1)}° / {fmt(preview.derived.effectiveTiltDeg, 1)}°</span>
                <span>Servicekorridor</span><span className="text-right text-foreground">{fmt(preview.derived.serviceCorridorM)} m</span>
                <span>1 Block Tiefe</span><span className="text-right text-foreground">{fmt(preview.derived.oneBlockDepthM)} m</span>
                <span>Modulabstand längs</span><span className="text-right text-foreground">{fmt(preview.derived.moduleLongSideSpacingM * 1000, 0)} mm · K2</span>
              </>
            )}
          </div>
          {preview.derived.kind === "k2" && (
            <p className="mt-2 text-muted-foreground">
              Zulässiger Reihenabstand: {fmt(preview.derived.rowSpaceRangeM.min)}–{fmt(preview.derived.rowSpaceRangeM.max)} m
            </p>
          )}
        </section>
      ) : (
        <div className="space-y-1 rounded-lg border border-destructive/35 bg-destructive/5 p-2 text-[10px] text-destructive">
          {preview.errors.map((error) => <p key={error.code}>{error.message}</p>)}
        </div>
      )}

      {!isGreenRoof && preview.warnings.some((warning) => warning.code.includes("block-size")) && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2 text-[10px] text-amber-700 dark:text-amber-300">
          Die K2 Blockgrösse überschreitet die dokumentierte Systemgrenze. Segmentierung ist noch nicht automatisch verfügbar.
        </p>
      )}

      <p className="rounded-lg border border-border/70 bg-muted/20 p-2 text-[10px] leading-relaxed text-muted-foreground">
        Vorplanung: Statik, Wind- und Schneelasten, Ballastierung und Befestigung wurden nicht geprüft.
      </p>
      {isGreenRoof && (
        <p className="rounded-lg border border-border/70 bg-muted/20 p-2 text-[10px] leading-relaxed text-muted-foreground">
          GreenRoof-Systemdetails und Unterkonstruktion wurden nicht herstellerspezifisch geprüft.
        </p>
      )}

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

      {!confirmReplace && <div className="sticky bottom-0 grid grid-cols-2 gap-2 bg-background/90 py-2 backdrop-blur">
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
      </div>}
    </div>
  );
}
