"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { useCompanyPlannerDefaults } from "@/hooks/useCompanyPlannerDefaults";
import {
  COMPANY_MODULE_SPACING_LIMITS_MM,
  COMPANY_PLANNER_DEFAULTS_SCHEMA_VERSION,
  COMPANY_THERMAL_FIELD_LIMITS_M,
  validateCompanyPlannerDefaults,
} from "@/lib/planning/companyPlannerDefaults";

export default function SettingsPage() {
  const query = useCompanyPlannerDefaults();
  const queryClient = useQueryClient();
  const [horizontal, setHorizontal] = useState("19");
  const [vertical, setVertical] = useState("19");
  const [pitchedLength, setPitchedLength] = useState("17.6");
  const [pitchedWidth, setPitchedWidth] = useState("17.6");
  const [flatPrimary, setFlatPrimary] = useState("12.3");
  const [flatEastWestSecondary, setFlatEastWestSecondary] = useState("16");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!query.data) return;
    setHorizontal(String(query.data.plannerDefaults.moduleSpacing.horizontalMm));
    setVertical(String(query.data.plannerDefaults.moduleSpacing.verticalMm));
    setPitchedLength(String(query.data.plannerDefaults.thermalSeparations.pitched.maxFieldLengthM));
    setPitchedWidth(String(query.data.plannerDefaults.thermalSeparations.pitched.maxFieldWidthM));
    setFlatPrimary(String(query.data.plannerDefaults.thermalSeparations.flat.maxPrimaryFieldLengthM));
    setFlatEastWestSecondary(String(query.data.plannerDefaults.thermalSeparations.flatEastWest.maxSecondaryFieldLengthM));
  }, [query.data]);

  const save = async () => {
    const plannerDefaults = {
      schemaVersion: COMPANY_PLANNER_DEFAULTS_SCHEMA_VERSION,
      moduleSpacing: {
        horizontalMm: Number(horizontal),
        verticalMm: Number(vertical),
      },
      thermalSeparations: {
        pitched: {
          maxFieldLengthM: Number(pitchedLength),
          maxFieldWidthM: Number(pitchedWidth),
        },
        flat: { maxPrimaryFieldLengthM: Number(flatPrimary) },
        flatEastWest: {
          maxSecondaryFieldLengthM: Number(flatEastWestSecondary),
        },
      },
    };
    const validation = validateCompanyPlannerDefaults(plannerDefaults);
    if (!validation.valid) {
      toast.error("Bitte gültige Modulabstände eingeben.");
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/company-profile/planner-defaults", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plannerDefaults: validation.value }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || "Speichern fehlgeschlagen.");
      }
      queryClient.setQueryData(["company-planner-defaults"], data);
      toast.success("Planungsstandards gespeichert");
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Speichern fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-full w-full px-6 py-8 text-foreground md:px-10">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-3xl font-semibold">Einstellungen</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Firmenweite Standards für SOLA.
        </p>

        <section className="mt-8 rounded-2xl border border-border bg-card/90 p-6 shadow-xl backdrop-blur-xl">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold">Planungsstandards</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Diese Werte werden als Standard für neue Planungen verwendet.
                Bestehende Planungen werden nicht geändert.
              </p>
            </div>
            {!query.isLoading && !query.data?.configured && (
              <span className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
                SOLA-Standard
              </span>
            )}
          </div>

          {query.isLoading ? (
            <p className="mt-6 text-sm text-muted-foreground">Wird geladen …</p>
          ) : query.isError ? (
            <p className="mt-6 text-sm text-destructive">
              {query.error instanceof Error
                ? query.error.message
                : "Planungsstandards konnten nicht geladen werden."}
            </p>
          ) : (
            <div className="mt-6 space-y-5">
              <div>
                <h3 className="text-sm font-medium">Modulabstand</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Standardabstand zwischen Modulen bei Verwendung einer normalen
                  Modulklemme. Herstellerspezifische Systemmaße bleiben davon
                  unberührt.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-2 text-sm">
                  <span>Horizontal</span>
                  <span className="flex items-center gap-2">
                    <input
                      type="number"
                      min={COMPANY_MODULE_SPACING_LIMITS_MM.min}
                      max={COMPANY_MODULE_SPACING_LIMITS_MM.max}
                      step="0.1"
                      value={horizontal}
                      onChange={(event) => setHorizontal(event.target.value)}
                      disabled={!query.data?.canEdit}
                      className="h-11 w-full rounded-xl border border-border bg-background/70 px-3 outline-none focus:border-primary disabled:opacity-60"
                    />
                    <span className="text-muted-foreground">mm</span>
                  </span>
                </label>
                <label className="space-y-2 text-sm">
                  <span>Vertikal</span>
                  <span className="flex items-center gap-2">
                    <input
                      type="number"
                      min={COMPANY_MODULE_SPACING_LIMITS_MM.min}
                      max={COMPANY_MODULE_SPACING_LIMITS_MM.max}
                      step="0.1"
                      value={vertical}
                      onChange={(event) => setVertical(event.target.value)}
                      disabled={!query.data?.canEdit}
                      className="h-11 w-full rounded-xl border border-border bg-background/70 px-3 outline-none focus:border-primary disabled:opacity-60"
                    />
                    <span className="text-muted-foreground">mm</span>
                  </span>
                </label>
              </div>
              <div className="border-t border-border pt-5">
                <h3 className="text-sm font-medium">Thermische Trennungen</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Diese Werte werden als Standard für neue Planungen verwendet
                  und können in der Modulplanung pro Dachfläche angepasst
                  werden. Bestehende Planungen werden nicht geändert.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {[
                  ["Schrägdach · max. Feldlänge", pitchedLength, setPitchedLength],
                  ["Schrägdach · max. Feldbreite", pitchedWidth, setPitchedWidth],
                  ["Flachdach · max. Feldlänge (Reihenrichtung)", flatPrimary, setFlatPrimary],
                  ["Ost-West · max. Feldlänge (Modullängsrichtung)", flatEastWestSecondary, setFlatEastWestSecondary],
                ].map(([label, value, setter]) => (
                  <label key={label as string} className="space-y-2 text-sm">
                    <span>{label as string}</span>
                    <span className="flex items-center gap-2">
                      <input
                        type="number"
                        min={COMPANY_THERMAL_FIELD_LIMITS_M.min}
                        max={COMPANY_THERMAL_FIELD_LIMITS_M.max}
                        step="0.1"
                        value={value as string}
                        onChange={(event) => (setter as (value: string) => void)(event.target.value)}
                        disabled={!query.data?.canEdit}
                        className="h-11 w-full rounded-xl border border-border bg-background/70 px-3 outline-none focus:border-primary disabled:opacity-60"
                      />
                      <span className="text-muted-foreground">m</span>
                    </span>
                  </label>
                ))}
              </div>
              {query.data?.canEdit ? (
                <div className="flex justify-end pt-2">
                  <button
                    type="button"
                    onClick={save}
                    disabled={saving}
                    className="h-11 rounded-xl bg-primary px-5 font-medium text-primary-foreground disabled:opacity-60"
                  >
                    {saving ? "Speichert …" : "Einstellungen speichern"}
                  </button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Nur Firmenadministratoren können diese Werte ändern.
                </p>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
