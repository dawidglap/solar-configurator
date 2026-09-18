"use client";

import React from "react";
import { createPortal } from "react-dom";
import { Settings2, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";

import { useCompanyPlannerDefaults } from "@/hooks/useCompanyPlannerDefaults";
import {
  COMPANY_FLAT_SPACING_LIMITS_M,
  COMPANY_FLAT_TILT_LIMITS_DEG,
  COMPANY_MODULE_SPACING_LIMITS_MM,
  isValidModuleSpacingMm,
  validateCompanyPlannerDefaults,
  type CompanyFlatRoofSpacingDefaults,
  type CompanyPlannerDefaultsV1,
} from "@/lib/planning/companyPlannerDefaults";
import { usePlannerV2Store } from "../../state/plannerV2Store";

type Props = {
  open: boolean;
  differsFromCurrentRoof: boolean;
  onClose: () => void;
  onResetCurrentRoof: () => boolean;
  onBeforeCompanyDefaultsUpdate?: () => void;
} & (
  | {
      scope?: "flat";
      orientation: "south" | "east-west";
      defaults: CompanyFlatRoofSpacingDefaults;
    }
  | {
      scope: "pitched";
      defaults: CompanyPlannerDefaultsV1["moduleSpacing"];
      /** Runs only after the authenticated company save succeeded. */
      onApplySavedDefaultsToCurrentRoof?: (
        defaults: CompanyPlannerDefaultsV1["moduleSpacing"],
      ) => boolean;
    }
);

type Field = keyof CompanyFlatRoofSpacingDefaults | keyof CompanyPlannerDefaultsV1["moduleSpacing"];

const flatFields: Array<{
  key: Field;
  label: string;
  unit: string;
}> = [
  { key: "rowSpaceM", label: "Reihenabstand", unit: "m" },
  { key: "serviceCorridorM", label: "Wartungsgang", unit: "m" },
  { key: "moduleGapMm", label: "Modulabstand", unit: "mm" },
  { key: "nominalTiltDeg", label: "Modulneigung", unit: "°" },
];

const pitchedFields: Array<{ key: Field; label: string; unit: string }> = [
  { key: "horizontalMm", label: "Horizontal", unit: "mm" },
  { key: "verticalMm", label: "Vertikal", unit: "mm" },
];

const textFor = (value: number) => String(Math.round(value * 100) / 100);

function isValidValues(values: CompanyFlatRoofSpacingDefaults) {
  return Number.isFinite(values.rowSpaceM) &&
    values.rowSpaceM > COMPANY_FLAT_SPACING_LIMITS_M.min &&
    values.rowSpaceM <= COMPANY_FLAT_SPACING_LIMITS_M.max &&
    Number.isFinite(values.serviceCorridorM) &&
    values.serviceCorridorM >= COMPANY_FLAT_SPACING_LIMITS_M.min &&
    values.serviceCorridorM <= COMPANY_FLAT_SPACING_LIMITS_M.max &&
    Number.isFinite(values.moduleGapMm) &&
    values.moduleGapMm >= COMPANY_MODULE_SPACING_LIMITS_MM.min &&
    values.moduleGapMm <= COMPANY_MODULE_SPACING_LIMITS_MM.max &&
    Number.isFinite(values.nominalTiltDeg) &&
    values.nominalTiltDeg >= COMPANY_FLAT_TILT_LIMITS_DEG.min &&
    values.nominalTiltDeg <= COMPANY_FLAT_TILT_LIMITS_DEG.max;
}

function textValues(defaults: Props["defaults"]): Record<Field, string> {
  return Object.fromEntries(
    Object.entries(defaults).map(([key, value]) => [key, textFor(value)]),
  ) as Record<Field, string>;
}

export default function CompanySpacingDefaultsDialog(props: Props) {
  const {
    open,
    defaults,
    differsFromCurrentRoof,
    onClose,
    onResetCurrentRoof,
    onBeforeCompanyDefaultsUpdate,
  } = props;
  const pitched = props.scope === "pitched";
  const orientation = pitched ? undefined : props.orientation;
  const fields = pitched ? pitchedFields : flatFields;
  const query = useCompanyPlannerDefaults();
  const queryClient = useQueryClient();
  const setCompanyPlannerDefaults = usePlannerV2Store((state) => state.setCompanyPlannerDefaults);
  const [values, setValues] = React.useState<Record<Field, string>>(() => textValues(defaults));
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setValues(textValues(defaults));
  }, [defaults, open, orientation, pitched]);

  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  if (!open || typeof document === "undefined") return null;

  const save = async () => {
    const current = query.data?.plannerDefaults ?? usePlannerV2Store.getState().companyPlannerDefaults;
    let plannerDefaults: CompanyPlannerDefaultsV1;
    let savedPitchedValues: CompanyPlannerDefaultsV1["moduleSpacing"] | undefined;
    if (pitched) {
      const nextValues = {
        horizontalMm: Number(values.horizontalMm.replace(",", ".")),
        verticalMm: Number(values.verticalMm.replace(",", ".")),
      };
      if (!isValidModuleSpacingMm(nextValues.horizontalMm) || !isValidModuleSpacingMm(nextValues.verticalMm)) {
        toast.error("Bitte gültige Firmenstandards eingeben.");
        return;
      }
      savedPitchedValues = nextValues;
      plannerDefaults = { ...current, moduleSpacing: nextValues };
    } else {
      const nextValues: CompanyFlatRoofSpacingDefaults = {
        rowSpaceM: Number(values.rowSpaceM.replace(",", ".")),
        serviceCorridorM: Number(values.serviceCorridorM.replace(",", ".")),
        moduleGapMm: Number(values.moduleGapMm.replace(",", ".")),
        nominalTiltDeg: Number(values.nominalTiltDeg.replace(",", ".")),
      };
      if (!isValidValues(nextValues)) {
        toast.error("Bitte gültige Firmenstandards eingeben.");
        return;
      }
      plannerDefaults = {
        ...current,
        flatRoofSpacing: {
          ...current.flatRoofSpacing,
          [orientation === "south" ? "south" : "eastWest"]: nextValues,
        },
      };
    }
    const validation = validateCompanyPlannerDefaults(plannerDefaults);
    if (!validation.valid) {
      toast.error("Bitte gültige Firmenstandards eingeben.");
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
      onBeforeCompanyDefaultsUpdate?.();
      setCompanyPlannerDefaults(data.plannerDefaults);
      const appliedToCurrentRoof = pitched && savedPitchedValues && props.onApplySavedDefaultsToCurrentRoof
        ? props.onApplySavedDefaultsToCurrentRoof(savedPitchedValues)
        : true;
      if (appliedToCurrentRoof) {
        toast.success(pitched && props.onApplySavedDefaultsToCurrentRoof
          ? "Firmenstandard gespeichert und auf die Dachfläche angewendet"
          : "Firmenstandard gespeichert");
      } else {
        toast.success("Firmenstandard gespeichert");
        toast.error("Die aktuelle Dachfläche konnte wegen ihrer Geometrie nicht aktualisiert werden.");
      }
      onClose();
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Speichern fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[10050] flex items-center justify-center bg-black/45 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="company-spacing-title"
        className="planner-surface-sidebar w-full max-w-md rounded-2xl border border-border bg-background p-5 text-foreground shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Settings2 className="h-4 w-4 text-primary" aria-hidden="true" />
              <h2 id="company-spacing-title" className="text-base font-semibold">
                {pitched ? "Firmenstandard – Modulabstand" : "Firmenstandard – Abstände"}
              </h2>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {pitched
                ? "Diese Werte gelten als Standard für neue Schrägdach-Planungen Ihres Unternehmens."
                : "Diese Werte gelten als Standard für neue Planungen Ihres Unternehmens."}
            </p>
          </div>
          <button type="button" aria-label="Schliessen" onClick={onClose} className="rounded-lg p-1 text-muted-foreground hover:bg-muted/30 hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 grid grid-cols-[minmax(0,1fr)_minmax(120px,0.8fr)] items-center gap-x-4 gap-y-3 text-sm">
          {fields.map((field) => (
            <React.Fragment key={field.key}>
              <label htmlFor={`company-spacing-${field.key}`}>{field.label}</label>
              <span className="relative block min-w-0">
                <input
                  id={`company-spacing-${field.key}`}
                  type="text"
                  inputMode="decimal"
                  value={values[field.key]}
                  onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
                  disabled={!query.data?.canEdit}
                  className="glass-input h-10 w-full appearance-none rounded-xl px-3 pr-10 text-right outline-none focus:ring-1 focus:ring-primary/40 disabled:opacity-60"
                />
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">{field.unit}</span>
              </span>
            </React.Fragment>
          ))}
        </div>

        {!query.isLoading && !query.data?.canEdit && (
          <p className="mt-4 text-xs text-muted-foreground">
            Nur Firmenadministratoren können diese Werte ändern.
          </p>
        )}

        {!pitched && differsFromCurrentRoof && (
          <button
            type="button"
            onClick={() => {
              if (onResetCurrentRoof()) onClose();
            }}
            className="mt-4 text-xs font-medium text-primary underline-offset-2 hover:underline"
          >
            Aktuelle Dachfläche auf Firmenstandard zurücksetzen
          </button>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-10 rounded-xl border border-border px-4 text-sm">
            Abbrechen
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || query.isLoading || !query.data?.canEdit}
            className="h-10 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {saving ? "Speichert …" : "Standard speichern"}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
