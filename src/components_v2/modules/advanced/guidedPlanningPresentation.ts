export type GuidedPlanningResultInput = {
  valid: boolean;
  quantityMode: "auto" | "fixed";
  requestedBlockCount: number;
  validBlockCount: number;
  requestedModuleCount: number;
  validModuleCount: number;
  blocksPerRow?: number;
  rowCount?: number;
  powerW?: number;
  montageFieldCount?: number;
  /** Committed layout contains manual additions/removals beyond its generator inputs. */
  manuallyAdjusted?: boolean;
};

export type GuidedPlanningResult = {
  status: "valid" | "invalid";
  title: string;
  blockCount: number;
  moduleCount: number;
  powerKWp: number | null;
  arrangementLabel: string;
  validityLabel: string | null;
  guidance: string | null;
  montageFieldCount?: number;
};

/**
 * Builds customer-facing result copy from an already computed preview.
 * It deliberately contains no placement or K2 geometry calculations.
 */
export function buildGuidedPlanningResult(
  input: GuidedPlanningResultInput,
): GuidedPlanningResult {
  const fixed = input.quantityMode === "fixed";
  const baseArrangementLabel = fixed && input.blocksPerRow && input.rowCount
    ? `${input.blocksPerRow} × ${input.rowCount}`
    : "Automatisch";
  const arrangementLabel = input.manuallyAdjusted
    ? `${baseArrangementLabel} · manuell angepasst`
    : baseArrangementLabel;

  if (!input.valid) {
    return {
      status: "invalid",
      title: fixed
        ? "Anordnung passt nicht vollständig"
        : "Planung noch nicht möglich",
      blockCount: input.validBlockCount,
      moduleCount: input.validModuleCount,
      powerKWp: null,
      arrangementLabel,
      validityLabel: fixed
        ? `${input.validBlockCount} von ${input.requestedBlockCount} Blocks gültig`
        : null,
      guidance: "Passe Anzahl, Ausrichtung oder Abstände an.",
      ...(input.montageFieldCount !== undefined
        ? { montageFieldCount: input.montageFieldCount }
        : {}),
    };
  }

  return {
    status: "valid",
    title: "Planung passt",
    blockCount: input.requestedBlockCount,
    moduleCount: input.requestedModuleCount,
    powerKWp: typeof input.powerW === "number"
      ? (input.powerW * input.requestedModuleCount) / 1000
      : null,
    arrangementLabel,
    validityLabel: null,
    guidance: null,
    ...(input.montageFieldCount !== undefined
      ? { montageFieldCount: input.montageFieldCount }
      : {}),
  };
}
