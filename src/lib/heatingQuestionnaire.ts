export const PROJECT_SITUATIONS = [
  "new_build",
  "renovation",
  "heating_replacement",
] as const;
export const BUILDING_TYPES = [
  "single_family",
  "multi_family",
  "commercial",
  "other",
] as const;
export const HEATING_SOURCE_TYPES = [
  "heating_oil",
  "natural_gas",
  "firewood",
  "pellets",
  "electric_heating",
  "heat_pump",
  "other",
] as const;
export const CONSUMPTION_UNITS = [
  "litres_per_year",
  "m3_per_year",
  "kwh_per_year",
  "stere_per_year",
  "kg_per_year",
  "tonnes_per_year",
  "other",
] as const;
export const ELECTRIC_HEATING_TYPES = ["direct", "storage"] as const;
export const DOMESTIC_HOT_WATER_OPTIONS = [
  "heating",
  "electric_boiler",
  "heat_pump_boiler",
  "solar_thermal",
  "other",
] as const;
export const HEAT_DISTRIBUTIONS = ["underfloor", "radiators", "both"] as const;
export const YES_NO_UNDECIDED = ["yes", "no", "undecided"] as const;
export const HEAT_PUMP_VARIANTS = [
  "ground_source",
  "air_water_outdoor",
  "air_water_indoor",
] as const;
export const OUTDOOR_LOCATIONS = ["facade", "garden", "flat_roof", "other"] as const;
export const INDOOR_INSTALLATION_TYPES = ["corner", "parallel", "special"] as const;
export const AIR_ROUTING_OPTIONS = [
  "light_well",
  "weather_protection_grille",
  "upwards",
  "special",
] as const;
export const CHECKLIST_STATUSES = [
  "attached",
  "will_follow",
  "not_available",
  "unreadable",
  "not_required",
] as const;

type ValueOf<T extends readonly string[]> = T[number];

export type ProjectSituation = ValueOf<typeof PROJECT_SITUATIONS>;
export type BuildingType = ValueOf<typeof BUILDING_TYPES>;
export type HeatingSourceType = ValueOf<typeof HEATING_SOURCE_TYPES>;
export type ConsumptionUnit = ValueOf<typeof CONSUMPTION_UNITS>;
export type DomesticHotWaterOption = ValueOf<typeof DOMESTIC_HOT_WATER_OPTIONS>;
export type HeatDistribution = ValueOf<typeof HEAT_DISTRIBUTIONS>;
export type HeatPumpVariant = ValueOf<typeof HEAT_PUMP_VARIANTS>;
export type ChecklistStatus = ValueOf<typeof CHECKLIST_STATUSES>;

export type AnnualConsumption = {
  value: number | null;
  unit: ConsumptionUnit | null;
  customUnit: string;
};

export type ExistingHeatingSource = {
  type: HeatingSourceType;
  annualConsumption: AnnualConsumption;
  boilerYear?: number | null;
  deviceYear?: number | null;
  woodType?: string;
  electricHeatingType?: ValueOf<typeof ELECTRIC_HEATING_TYPES> | null;
  outputKw?: number | null;
  heatPumpType?: string;
  label?: string;
  description?: string;
};

export type HeatingQuestionnaire = {
  projectSituation: ProjectSituation | null;
  buildingType: BuildingType | null;
  heatedAreaM2: number | null;
  heatLoadCalculation: {
    available: boolean | null;
    kw: number | null;
  };
  buildingNotes: string;
  existingHeating: ExistingHeatingSource[];
  existingDomesticHotWater: {
    options: DomesticHotWaterOption[];
    otherDescription: string;
  };
  occupants: number | null;
  heatDistribution: HeatDistribution | null;
  domesticHotWaterWithNewHeatPump: ValueOf<typeof YES_NO_UNDECIDED> | null;
  preferredHeatPumpVariants: HeatPumpVariant[];
  groundSource: {
    existingBorehole: {
      status: "yes" | "no" | null;
      count: number | null;
      depthPerBoreholeM: number | null;
    };
    notes: string;
  };
  airWaterOutdoor: {
    distanceOutdoorUnitToBuildingEntryM: number | null;
    plannedOutdoorLocation: ValueOf<typeof OUTDOOR_LOCATIONS> | null;
    plannedOutdoorLocationOther: string;
    distanceToNearestNoiseSensitiveWindowM: number | null;
  };
  airWaterIndoor: {
    installationType: ValueOf<typeof INDOOR_INSTALLATION_TYPES> | null;
    installationRoom: {
      lengthM: number | null;
      widthM: number | null;
      heightM: number | null;
    };
    plannedAirRouting: ValueOf<typeof AIR_ROUTING_OPTIONS>[];
    distanceToNearestNoiseSensitiveWindowM: number | null;
    specialInstallationDescription: string;
  };
  documents: {
    floorPlan: ChecklistStatus | null;
    heatingRoomPhotos: ChecklistStatus | null;
    installationLocationPhotos: ChecklistStatus | null;
    existingDeviceTypePlates: ChecklistStatus | null;
    consumptionRecords: ChecklistStatus | null;
    excavationOrBoreholeDocuments: ChecklistStatus | null;
  };
  additionalNotes: string;
};

export class HeatingQuestionnaireValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HeatingQuestionnaireValidationError";
  }
}

const QUESTIONNAIRE_KEYS = [
  "projectSituation",
  "buildingType",
  "heatedAreaM2",
  "heatLoadCalculation",
  "buildingNotes",
  "existingHeating",
  "existingDomesticHotWater",
  "occupants",
  "heatDistribution",
  "domesticHotWaterWithNewHeatPump",
  "preferredHeatPumpVariants",
  "groundSource",
  "airWaterOutdoor",
  "airWaterIndoor",
  "documents",
  "additionalNotes",
] as const;

const TEXT_MAX = 10_000;
const SHORT_TEXT_MAX = 500;

export function createEmptyHeatingQuestionnaire(): HeatingQuestionnaire {
  return {
    projectSituation: null,
    buildingType: null,
    heatedAreaM2: null,
    heatLoadCalculation: { available: null, kw: null },
    buildingNotes: "",
    existingHeating: [],
    existingDomesticHotWater: { options: [], otherDescription: "" },
    occupants: null,
    heatDistribution: null,
    domesticHotWaterWithNewHeatPump: null,
    preferredHeatPumpVariants: [],
    groundSource: {
      existingBorehole: { status: null, count: null, depthPerBoreholeM: null },
      notes: "",
    },
    airWaterOutdoor: {
      distanceOutdoorUnitToBuildingEntryM: null,
      plannedOutdoorLocation: null,
      plannedOutdoorLocationOther: "",
      distanceToNearestNoiseSensitiveWindowM: null,
    },
    airWaterIndoor: {
      installationType: null,
      installationRoom: { lengthM: null, widthM: null, heightM: null },
      plannedAirRouting: [],
      distanceToNearestNoiseSensitiveWindowM: null,
      specialInstallationDescription: "",
    },
    documents: {
      floorPlan: null,
      heatingRoomPhotos: null,
      installationLocationPhotos: null,
      existingDeviceTypePlates: null,
      consumptionRecords: null,
      excavationOrBoreholeDocuments: null,
    },
    additionalNotes: "",
  };
}

function fail(path: string, reason: string): never {
  throw new HeatingQuestionnaireValidationError(`${path} ${reason}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function objectAt(value: unknown, path: string) {
  if (!isRecord(value)) fail(path, "must be an object");
  return value;
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: readonly string[], path: string) {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) fail(`${path}.${unknown}`, "is not supported");
}

function nullableEnum<T extends readonly string[]>(value: unknown, values: T, path: string): ValueOf<T> | null {
  if (value === null) return null;
  if (typeof value !== "string" || !values.includes(value as ValueOf<T>)) {
    fail(path, `must be one of ${values.join(", ")} or null`);
  }
  return value as ValueOf<T>;
}

function textValue(value: unknown, path: string, max = TEXT_MAX) {
  if (typeof value !== "string") fail(path, "must be a string");
  const result = value.trim();
  if (result.length > max) fail(path, `must be at most ${max} characters`);
  return result;
}

function nullableNumber(
  value: unknown,
  path: string,
  options: { integer?: boolean; allowZero?: boolean } = {},
) {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) fail(path, "must be a finite number or null");
  if (options.integer && !Number.isInteger(value)) fail(path, "must be an integer or null");
  if (value < 0 || (!options.allowZero && value === 0)) {
    fail(path, options.allowZero ? "must not be negative" : "must be greater than zero");
  }
  return value;
}

function nullableBoolean(value: unknown, path: string) {
  if (value === null || typeof value === "boolean") return value;
  return fail(path, "must be a boolean or null");
}

function enumArray<T extends readonly string[]>(value: unknown, values: T, path: string): ValueOf<T>[] {
  if (!Array.isArray(value)) fail(path, "must be an array");
  const result = value.map((item, index) => {
    if (typeof item !== "string" || !values.includes(item as ValueOf<T>)) {
      fail(`${path}[${index}]`, `must be one of ${values.join(", ")}`);
    }
    return item as ValueOf<T>;
  });
  if (new Set(result).size !== result.length) fail(path, "must not contain duplicates");
  return result;
}

function parseConsumption(value: unknown, path: string, allowedUnits: readonly ConsumptionUnit[]): AnnualConsumption {
  const input = objectAt(value, path);
  assertOnlyKeys(input, ["value", "unit", "customUnit"], path);
  const unit = Object.prototype.hasOwnProperty.call(input, "unit")
    ? nullableEnum(input.unit, CONSUMPTION_UNITS, `${path}.unit`)
    : null;
  if (unit !== null && !allowedUnits.includes(unit)) fail(`${path}.unit`, "is not valid for this heating source");
  return {
    value: Object.prototype.hasOwnProperty.call(input, "value")
      ? nullableNumber(input.value, `${path}.value`)
      : null,
    unit,
    customUnit: Object.prototype.hasOwnProperty.call(input, "customUnit")
      ? textValue(input.customUnit, `${path}.customUnit`, 100)
      : "",
  };
}

const SOURCE_KEYS: Record<HeatingSourceType, readonly string[]> = {
  heating_oil: ["type", "annualConsumption", "boilerYear"],
  natural_gas: ["type", "annualConsumption", "deviceYear"],
  firewood: ["type", "annualConsumption", "woodType"],
  pellets: ["type", "annualConsumption", "deviceYear"],
  electric_heating: ["type", "annualConsumption", "electricHeatingType"],
  heat_pump: ["type", "annualConsumption", "outputKw", "heatPumpType", "deviceYear"],
  other: ["type", "annualConsumption", "label", "description"],
};

const SOURCE_UNITS: Record<HeatingSourceType, readonly ConsumptionUnit[]> = {
  heating_oil: ["litres_per_year"],
  natural_gas: ["m3_per_year", "kwh_per_year"],
  firewood: ["stere_per_year"],
  pellets: ["kg_per_year", "tonnes_per_year"],
  electric_heating: ["kwh_per_year"],
  heat_pump: ["kwh_per_year"],
  other: CONSUMPTION_UNITS,
};

function parseHeatingSources(value: unknown, path: string): ExistingHeatingSource[] {
  if (!Array.isArray(value)) fail(path, "must be an array");
  if (value.length > HEATING_SOURCE_TYPES.length) fail(path, "contains too many entries");
  const seen = new Set<string>();
  return value.map((raw, index) => {
    const itemPath = `${path}[${index}]`;
    const input = objectAt(raw, itemPath);
    const type = nullableEnum(input.type, HEATING_SOURCE_TYPES, `${itemPath}.type`);
    if (type === null) fail(`${itemPath}.type`, "must not be null");
    if (seen.has(type)) fail(path, `contains duplicate source ${type}`);
    seen.add(type);
    assertOnlyKeys(input, SOURCE_KEYS[type], itemPath);
    const source: ExistingHeatingSource = {
      type,
      annualConsumption: Object.prototype.hasOwnProperty.call(input, "annualConsumption")
        ? parseConsumption(input.annualConsumption, `${itemPath}.annualConsumption`, SOURCE_UNITS[type])
        : { value: null, unit: null, customUnit: "" },
    };
    if (type === "heating_oil") source.boilerYear = Object.prototype.hasOwnProperty.call(input, "boilerYear") ? nullableNumber(input.boilerYear, `${itemPath}.boilerYear`, { integer: true }) : null;
    if (["natural_gas", "pellets", "heat_pump"].includes(type)) source.deviceYear = Object.prototype.hasOwnProperty.call(input, "deviceYear") ? nullableNumber(input.deviceYear, `${itemPath}.deviceYear`, { integer: true }) : null;
    if (type === "firewood") source.woodType = Object.prototype.hasOwnProperty.call(input, "woodType") ? textValue(input.woodType, `${itemPath}.woodType`, SHORT_TEXT_MAX) : "";
    if (type === "electric_heating") source.electricHeatingType = Object.prototype.hasOwnProperty.call(input, "electricHeatingType") ? nullableEnum(input.electricHeatingType, ELECTRIC_HEATING_TYPES, `${itemPath}.electricHeatingType`) : null;
    if (type === "heat_pump") {
      source.outputKw = Object.prototype.hasOwnProperty.call(input, "outputKw") ? nullableNumber(input.outputKw, `${itemPath}.outputKw`) : null;
      source.heatPumpType = Object.prototype.hasOwnProperty.call(input, "heatPumpType") ? textValue(input.heatPumpType, `${itemPath}.heatPumpType`, SHORT_TEXT_MAX) : "";
    }
    if (type === "other") {
      source.label = Object.prototype.hasOwnProperty.call(input, "label") ? textValue(input.label, `${itemPath}.label`, SHORT_TEXT_MAX) : "";
      source.description = Object.prototype.hasOwnProperty.call(input, "description") ? textValue(input.description, `${itemPath}.description`) : "";
    }
    return source;
  });
}

function deepMerge<T>(base: T, patch: unknown): T {
  if (!isRecord(base) || !isRecord(patch)) return patch as T;
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    result[key] = isRecord(value) && isRecord(result[key])
      ? deepMerge(result[key], value)
      : value;
  }
  return result as T;
}

function flatten(value: Record<string, unknown>, prefix: string, target: Record<string, unknown>) {
  for (const [key, item] of Object.entries(value)) {
    const path = `${prefix}.${key}`;
    if (isRecord(item)) flatten(item, path, target);
    else target[path] = item;
  }
}

export function parseHeatingQuestionnairePatch(value: unknown): Record<string, unknown> {
  const input = objectAt(value, "questionnaire");
  assertOnlyKeys(input, QUESTIONNAIRE_KEYS, "questionnaire");
  const patch: Record<string, unknown> = {};
  const has = (key: string) => Object.prototype.hasOwnProperty.call(input, key);

  if (has("projectSituation")) patch.projectSituation = nullableEnum(input.projectSituation, PROJECT_SITUATIONS, "questionnaire.projectSituation");
  if (has("buildingType")) patch.buildingType = nullableEnum(input.buildingType, BUILDING_TYPES, "questionnaire.buildingType");
  if (has("heatedAreaM2")) patch.heatedAreaM2 = nullableNumber(input.heatedAreaM2, "questionnaire.heatedAreaM2");
  if (has("buildingNotes")) patch.buildingNotes = textValue(input.buildingNotes, "questionnaire.buildingNotes");
  if (has("existingHeating")) patch.existingHeating = parseHeatingSources(input.existingHeating, "questionnaire.existingHeating");
  if (has("occupants")) patch.occupants = nullableNumber(input.occupants, "questionnaire.occupants", { integer: true, allowZero: true });
  if (has("heatDistribution")) patch.heatDistribution = nullableEnum(input.heatDistribution, HEAT_DISTRIBUTIONS, "questionnaire.heatDistribution");
  if (has("domesticHotWaterWithNewHeatPump")) patch.domesticHotWaterWithNewHeatPump = nullableEnum(input.domesticHotWaterWithNewHeatPump, YES_NO_UNDECIDED, "questionnaire.domesticHotWaterWithNewHeatPump");
  if (has("preferredHeatPumpVariants")) patch.preferredHeatPumpVariants = enumArray(input.preferredHeatPumpVariants, HEAT_PUMP_VARIANTS, "questionnaire.preferredHeatPumpVariants");
  if (has("additionalNotes")) patch.additionalNotes = textValue(input.additionalNotes, "questionnaire.additionalNotes");

  if (has("heatLoadCalculation")) {
    const object = objectAt(input.heatLoadCalculation, "questionnaire.heatLoadCalculation");
    assertOnlyKeys(object, ["available", "kw"], "questionnaire.heatLoadCalculation");
    const parsed: Record<string, unknown> = {};
    if (Object.prototype.hasOwnProperty.call(object, "available")) parsed.available = nullableBoolean(object.available, "questionnaire.heatLoadCalculation.available");
    if (Object.prototype.hasOwnProperty.call(object, "kw")) parsed.kw = nullableNumber(object.kw, "questionnaire.heatLoadCalculation.kw");
    patch.heatLoadCalculation = parsed;
  }

  if (has("existingDomesticHotWater")) {
    const object = objectAt(input.existingDomesticHotWater, "questionnaire.existingDomesticHotWater");
    assertOnlyKeys(object, ["options", "otherDescription"], "questionnaire.existingDomesticHotWater");
    const parsed: Record<string, unknown> = {};
    if (Object.prototype.hasOwnProperty.call(object, "options")) parsed.options = enumArray(object.options, DOMESTIC_HOT_WATER_OPTIONS, "questionnaire.existingDomesticHotWater.options");
    if (Object.prototype.hasOwnProperty.call(object, "otherDescription")) parsed.otherDescription = textValue(object.otherDescription, "questionnaire.existingDomesticHotWater.otherDescription");
    patch.existingDomesticHotWater = parsed;
  }

  if (has("groundSource")) {
    const object = objectAt(input.groundSource, "questionnaire.groundSource");
    assertOnlyKeys(object, ["existingBorehole", "notes"], "questionnaire.groundSource");
    const parsed: Record<string, unknown> = {};
    if (Object.prototype.hasOwnProperty.call(object, "notes")) parsed.notes = textValue(object.notes, "questionnaire.groundSource.notes");
    if (Object.prototype.hasOwnProperty.call(object, "existingBorehole")) {
      const borehole = objectAt(object.existingBorehole, "questionnaire.groundSource.existingBorehole");
      assertOnlyKeys(borehole, ["status", "count", "depthPerBoreholeM"], "questionnaire.groundSource.existingBorehole");
      const parsedBorehole: Record<string, unknown> = {};
      if (Object.prototype.hasOwnProperty.call(borehole, "status")) parsedBorehole.status = nullableEnum(borehole.status, ["yes", "no"] as const, "questionnaire.groundSource.existingBorehole.status");
      if (Object.prototype.hasOwnProperty.call(borehole, "count")) parsedBorehole.count = nullableNumber(borehole.count, "questionnaire.groundSource.existingBorehole.count", { integer: true, allowZero: true });
      if (Object.prototype.hasOwnProperty.call(borehole, "depthPerBoreholeM")) parsedBorehole.depthPerBoreholeM = nullableNumber(borehole.depthPerBoreholeM, "questionnaire.groundSource.existingBorehole.depthPerBoreholeM");
      parsed.existingBorehole = parsedBorehole;
    }
    patch.groundSource = parsed;
  }

  if (has("airWaterOutdoor")) {
    const object = objectAt(input.airWaterOutdoor, "questionnaire.airWaterOutdoor");
    assertOnlyKeys(object, ["distanceOutdoorUnitToBuildingEntryM", "plannedOutdoorLocation", "plannedOutdoorLocationOther", "distanceToNearestNoiseSensitiveWindowM"], "questionnaire.airWaterOutdoor");
    const parsed: Record<string, unknown> = {};
    if (Object.prototype.hasOwnProperty.call(object, "distanceOutdoorUnitToBuildingEntryM")) parsed.distanceOutdoorUnitToBuildingEntryM = nullableNumber(object.distanceOutdoorUnitToBuildingEntryM, "questionnaire.airWaterOutdoor.distanceOutdoorUnitToBuildingEntryM", { allowZero: true });
    if (Object.prototype.hasOwnProperty.call(object, "plannedOutdoorLocation")) parsed.plannedOutdoorLocation = nullableEnum(object.plannedOutdoorLocation, OUTDOOR_LOCATIONS, "questionnaire.airWaterOutdoor.plannedOutdoorLocation");
    if (Object.prototype.hasOwnProperty.call(object, "plannedOutdoorLocationOther")) parsed.plannedOutdoorLocationOther = textValue(object.plannedOutdoorLocationOther, "questionnaire.airWaterOutdoor.plannedOutdoorLocationOther");
    if (Object.prototype.hasOwnProperty.call(object, "distanceToNearestNoiseSensitiveWindowM")) parsed.distanceToNearestNoiseSensitiveWindowM = nullableNumber(object.distanceToNearestNoiseSensitiveWindowM, "questionnaire.airWaterOutdoor.distanceToNearestNoiseSensitiveWindowM", { allowZero: true });
    patch.airWaterOutdoor = parsed;
  }

  if (has("airWaterIndoor")) {
    const object = objectAt(input.airWaterIndoor, "questionnaire.airWaterIndoor");
    assertOnlyKeys(object, ["installationType", "installationRoom", "plannedAirRouting", "distanceToNearestNoiseSensitiveWindowM", "specialInstallationDescription"], "questionnaire.airWaterIndoor");
    const parsed: Record<string, unknown> = {};
    if (Object.prototype.hasOwnProperty.call(object, "installationType")) parsed.installationType = nullableEnum(object.installationType, INDOOR_INSTALLATION_TYPES, "questionnaire.airWaterIndoor.installationType");
    if (Object.prototype.hasOwnProperty.call(object, "plannedAirRouting")) parsed.plannedAirRouting = enumArray(object.plannedAirRouting, AIR_ROUTING_OPTIONS, "questionnaire.airWaterIndoor.plannedAirRouting");
    if (Object.prototype.hasOwnProperty.call(object, "distanceToNearestNoiseSensitiveWindowM")) parsed.distanceToNearestNoiseSensitiveWindowM = nullableNumber(object.distanceToNearestNoiseSensitiveWindowM, "questionnaire.airWaterIndoor.distanceToNearestNoiseSensitiveWindowM", { allowZero: true });
    if (Object.prototype.hasOwnProperty.call(object, "specialInstallationDescription")) parsed.specialInstallationDescription = textValue(object.specialInstallationDescription, "questionnaire.airWaterIndoor.specialInstallationDescription");
    if (Object.prototype.hasOwnProperty.call(object, "installationRoom")) {
      const room = objectAt(object.installationRoom, "questionnaire.airWaterIndoor.installationRoom");
      assertOnlyKeys(room, ["lengthM", "widthM", "heightM"], "questionnaire.airWaterIndoor.installationRoom");
      const parsedRoom: Record<string, unknown> = {};
      for (const key of ["lengthM", "widthM", "heightM"] as const) {
        if (Object.prototype.hasOwnProperty.call(room, key)) parsedRoom[key] = nullableNumber(room[key], `questionnaire.airWaterIndoor.installationRoom.${key}`);
      }
      parsed.installationRoom = parsedRoom;
    }
    patch.airWaterIndoor = parsed;
  }

  if (has("documents")) {
    const object = objectAt(input.documents, "questionnaire.documents");
    const keys = ["floorPlan", "heatingRoomPhotos", "installationLocationPhotos", "existingDeviceTypePlates", "consumptionRecords", "excavationOrBoreholeDocuments"] as const;
    assertOnlyKeys(object, keys, "questionnaire.documents");
    const parsed: Record<string, unknown> = {};
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(object, key)) parsed[key] = nullableEnum(object[key], CHECKLIST_STATUSES, `questionnaire.documents.${key}`);
    }
    patch.documents = parsed;
  }

  return patch;
}

export function buildHeatingQuestionnaireSet(patch: Record<string, unknown>) {
  const set: Record<string, unknown> = {};
  flatten(patch, "heating.questionnaire", set);
  return set;
}

export function normalizeHeatingQuestionnaire(value: unknown): HeatingQuestionnaire {
  const empty = createEmptyHeatingQuestionnaire();
  if (!isRecord(value)) return empty;
  try {
    return deepMerge(empty, parseHeatingQuestionnairePatch(value));
  } catch {
    return empty;
  }
}

export function applyHeatingQuestionnairePatch(
  current: unknown,
  patch: Record<string, unknown>,
): HeatingQuestionnaire {
  return deepMerge(normalizeHeatingQuestionnaire(current), patch);
}
