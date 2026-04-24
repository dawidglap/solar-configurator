// src/app/api/plannings/[planningId]/report-summary/route.ts
import { MongoClient, ObjectId } from "mongodb";
import crypto from "crypto";
import { getCorsHeaders } from "@/lib/cors";

export const runtime = "nodejs";

/* ----------------------------- Session helpers ---------------------------- */

function sign(payload: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function getCookie(req: Request, name: string) {
  const cookie = req.headers.get("cookie") || "";
  const parts = cookie.split(";").map((p) => p.trim());
  const found = parts.find((p) => p.startsWith(name + "="));
  return found ? decodeURIComponent(found.split("=").slice(1).join("=")) : null;
}

function readSession(req: Request, secret: string) {
  const token = getCookie(req, "session");
  if (!token) return null;

  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  if (sign(payload, secret) !== sig) return null;

  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

/* -------------------------------- Helpers -------------------------------- */

function safeString(v: any) {
  return typeof v === "string" ? v.trim() : "";
}

function safeNumber(v: any, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function calculatePvSubsidyChf(dcPowerKw: number) {
  if (dcPowerKw <= 0) return 0;
  const rate = dcPowerKw <= 30 ? 360 : 300;
  return round2(dcPowerKw * rate);
}

function toObjectIdOrNull(v: any) {
  try {
    if (!v) return null;
    return new ObjectId(String(v));
  } catch {
    return null;
  }
}

function jsonResponse(origin: string | null, body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...getCorsHeaders(origin),
    },
  });
}

function parseMoneyLike(value: any, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return fallback;

  const normalized = value
    .trim()
    .replace(/\s/g, "")
    .replace(/CHF/gi, "")
    .replace(/'/g, "")
    .replace(/,/g, ".");

  const n = Number(normalized);
  return Number.isFinite(n) ? n : fallback;
}

function averageRoofTiltDeg(layers: any[]) {
  if (!Array.isArray(layers) || layers.length === 0) return 20;

  const tilts = layers
    .map((l) => safeNumber(l?.tiltDeg, NaN))
    .filter((n) => Number.isFinite(n));

  if (!tilts.length) return 20;

  return tilts.reduce((a, b) => a + b, 0) / tilts.length;
}

/* ---------------------- Yield helpers from Sonnendach --------------------- */

function normalizeSuitabilityLabel(v: any) {
  return safeString(v).toLowerCase();
}

function estimateSpecificYieldFromSuitability(eignung?: string) {
  const e = normalizeSuitabilityLabel(eignung);

  if (!e) return null;
  if (e.includes("sehr gut") || e.includes("sehrgut")) return 1120;
  if (e === "gut" || e.includes(" gut")) return 1020;
  if (e.includes("mittel")) return 900;
  if (e.includes("genügend") || e.includes("genuegend")) return 800;
  if (e.includes("schlecht")) return 720;

  return null;
}

function estimateSpecificYieldFromAzimuthTilt(roof: any) {
  const azimuth = safeNumber(roof?.azimuthDeg, 0);
  const tilt = safeNumber(roof?.tiltDeg, 20);

  const az = ((((azimuth + 180) % 360) + 360) % 360) - 180;
  const absAz = Math.abs(az);

  let base = 950;

  if (absAz <= 30) base = 1120;
  else if (absAz <= 60) base = 1060;
  else if (absAz <= 100) base = 980;
  else if (absAz <= 140) base = 860;
  else base = 720;

  if (tilt >= 15 && tilt <= 35) base += 40;
  else if (tilt >= 5 && tilt < 15) base += 10;
  else if (tilt > 35 && tilt <= 50) base -= 20;
  else if (tilt > 50) base -= 60;

  return clamp(Math.round(base), 650, 1200);
}

function inferRoofSpecificYield(roof: any) {
  const explicitSpecificYield = safeNumber(
    roof?.specificYieldKwhKw ??
      roof?.specificYield ??
      roof?.spezErtrag ??
      roof?.spez_ertrag,
    NaN
  );
  if (Number.isFinite(explicitSpecificYield) && explicitSpecificYield > 0) {
    return Math.round(explicitSpecificYield);
  }

  const irradiation = safeNumber(
    roof?.irradiationKwhM2 ??
      roof?.globalstrahlung ??
      roof?.strahlung,
    NaN
  );
  if (Number.isFinite(irradiation) && irradiation > 0) {
    return clamp(Math.round(irradiation * 0.72), 650, 1250);
  }

  const suitabilityBased = estimateSpecificYieldFromSuitability(
    roof?.eignung ?? roof?.suitability ?? roof?.dachEignung
  );
  if (typeof suitabilityBased === "number") {
    return suitabilityBased;
  }

  return estimateSpecificYieldFromAzimuthTilt(roof);
}

function inferRoofWeight(roof: any, roofId: string, panelsOnRoof: any[]) {
  const explicitArea = safeNumber(
    roof?.areaM2 ?? roof?.flaeche ?? roof?.fläche,
    NaN
  );
  if (Number.isFinite(explicitArea) && explicitArea > 0) {
    return explicitArea;
  }

  if (panelsOnRoof.length > 0) {
    return panelsOnRoof.length;
  }

  return roofId ? 1 : 1;
}

function getUsedRoofIdsFromPanels(panels: any[]) {
  const ids = new Set<string>();

  for (const panel of Array.isArray(panels) ? panels : []) {
    const roofId = safeString(panel?.roofId);
    if (roofId) ids.add(roofId);
  }

  return ids;
}

function getUsedRoofs(layers: any[], panels: any[]) {
  if (!Array.isArray(layers) || layers.length === 0) return [];

  const usedRoofIds = getUsedRoofIdsFromPanels(panels);

  if (!usedRoofIds.size) {
    return layers;
  }

  const filtered = layers.filter((roof) => usedRoofIds.has(safeString(roof?.id)));
  return filtered.length ? filtered : layers;
}

function inferYieldPerKwpFromRoofs(layers: any[], panels: any[]) {
  const roofsForYield = getUsedRoofs(layers, panels);

  if (!Array.isArray(roofsForYield) || roofsForYield.length === 0) {
    return 950;
  }

  const values = roofsForYield
    .map((roof) => {
      const roofId = safeString(roof?.id);
      const panelsOnRoof = Array.isArray(panels)
        ? panels.filter((p) => safeString(p?.roofId) === roofId)
        : [];

      const specificYield = inferRoofSpecificYield(roof);
      const weight = inferRoofWeight(roof, roofId, panelsOnRoof);

      return {
        specificYield,
        weight,
      };
    })
    .filter(
      (entry) =>
        Number.isFinite(entry.specificYield) &&
        entry.specificYield > 0 &&
        Number.isFinite(entry.weight) &&
        entry.weight > 0
    );

  if (!values.length) {
    return 950;
  }

  const weightedSum = values.reduce(
    (sum, entry) => sum + entry.specificYield * entry.weight,
    0
  );
  const totalWeight = values.reduce((sum, entry) => sum + entry.weight, 0);

  if (totalWeight <= 0) {
    return 950;
  }

  return Math.round(weightedSum / totalWeight);
}

/* ------------------------- Self-consumption helper ------------------------ */

function estimateSelfConsumptionPct(args: {
  yearlyConsumptionKwh: number;
  annualProductionKwh: number;
  hasBattery: boolean;
  hasEv: boolean;
  hasHeatPump: boolean;
}) {
  const {
    yearlyConsumptionKwh,
    annualProductionKwh,
    hasBattery,
    hasEv,
    hasHeatPump,
  } = args;

  if (annualProductionKwh <= 0 || yearlyConsumptionKwh <= 0) {
    return 0;
  }

  const ratio = yearlyConsumptionKwh / annualProductionKwh;

  // base self-consumption without extras
  let pct = 0.28;

  // consumption vs production balance
  if (ratio >= 1.5) pct += 0.12;
  else if (ratio >= 1.2) pct += 0.09;
  else if (ratio >= 1.0) pct += 0.07;
  else if (ratio >= 0.8) pct += 0.04;
  else if (ratio >= 0.6) pct += 0.01;
  else pct -= 0.03;

  // battery has the strongest impact on self-consumption
  if (hasBattery) {
    pct += 0.18;

    // if production is relatively high, battery adds even more benefit
    if (ratio <= 1.0) pct += 0.04;
    if (ratio <= 0.8) pct += 0.03;
  }

  // EV typically helps shift solar energy into useful consumption
  if (hasEv) {
    pct += 0.06;
  }

  // heat pump also increases on-site usage
  if (hasHeatPump) {
    pct += 0.07;
  }

  // realistic bounds
  return clamp(pct, 0.18, 0.88);
}

/* ------------------------------ Parts helpers ----------------------------- */

type NormalizedPartItem = {
  id: string;
  category: string;
  brand: string;
  name: string;
  unit: string;
  unitLabel: string;
  quantity: number;
  unitPriceNet: number;
  lineTotalNet: number;
};

type NormalizedCatalogItem = {
  id: string;
  category: string;
  brand: string;
  model: string;
  name: string;
  description: string;
  unit: string;
  unitLabel: string;
  priceNet: number;
  isActive: boolean;
};

function normalizeCatalogItem(item: any): NormalizedCatalogItem {
  return {
    id: safeString(item?._id ?? item?.id),
    category: safeString(item?.category),
    brand: safeString(item?.brand),
    model: safeString(item?.model),
    name: safeString(item?.name),
    description: safeString(item?.description),
    unit: safeString(item?.unit) || "piece",
    unitLabel: safeString(item?.unitLabel) || "Stk.",
    priceNet: safeNumber(item?.priceNet, 0),
    isActive: typeof item?.isActive === "boolean" ? item.isActive : true,
  };
}

function normalizePartItem(item: any): NormalizedPartItem {
  const quantity = safeNumber(
    item?.quantity ??
      item?.qty ??
      item?.stk,
    0
  );

  const unitPriceNet = safeNumber(
    item?.unitPriceNet ??
      item?.unitPriceChf ??
      item?.unitPrice ??
      item?.einzelpreis ??
      item?.priceNet ??
      item?.priceChf ??
      item?.price,
    0
  );

  const lineTotalNet = safeNumber(
    item?.lineTotalNet ??
      item?.lineTotalChf ??
      item?.totalNet ??
      item?.totalChf,
    quantity * unitPriceNet
  );

  return {
    id: safeString(item?.id),
    category: safeString(item?.category ?? item?.kategorie),
    brand: safeString(item?.brand ?? item?.marke),
    name: safeString(item?.name ?? item?.beschreibung),
    unit: safeString(item?.unit ?? item?.einheit),
    unitLabel:
      safeString(item?.unitLabel ?? item?.einheit) ||
      safeString(item?.unit ?? item?.einheit),
    quantity,
    unitPriceNet,
    lineTotalNet,
  };
}

function getRawPartsItemsFromPlanning(doc: any) {
  return (
    doc?.parts?.items ??
    doc?.data?.parts?.items ??
    doc?.data?.planner?.parts?.items ??
    doc?.data?.planner?.parts ??
    []
  );
}

function normalizeReportOptions(raw: any) {
  const battery =
    typeof raw?.battery === "boolean"
      ? raw.battery
      : typeof raw?.hasBattery === "boolean"
        ? raw.hasBattery
        : typeof raw?.includeBattery === "boolean"
          ? raw.includeBattery
          : undefined;

  const charging =
    typeof raw?.charging === "boolean"
      ? raw.charging
      : typeof raw?.hasEv === "boolean"
        ? raw.hasEv
        : typeof raw?.includeWallbox === "boolean"
          ? raw.includeWallbox
          : undefined;

  const heatPump =
    typeof raw?.heatPump === "boolean"
      ? raw.heatPump
      : typeof raw?.hasHeatPump === "boolean"
        ? raw.hasHeatPump
        : undefined;

  return {
    battery,
    charging,
    heatPump,
    selectedBatteryItemId: safeString(
      raw?.selectedBatteryItemId ??
      raw?.batteryItemId ??
      raw?.selectedBatteryId
    ),
    selectedWallboxItemId: safeString(
      raw?.selectedWallboxItemId ??
      raw?.wallboxItemId ??
      raw?.selectedWallboxId
    ),
    discountChf: parseMoneyLike(raw?.discountChf ?? raw?.rabattChf, 0),
    discountPct: parseMoneyLike(raw?.discountPct ?? raw?.rabattPct, 0),
    subsidyChf: parseMoneyLike(
      raw?.subsidyChf ??
      raw?.subsidy ??
      raw?.foerderungen,
      0
    ),
    skontoPct: parseMoneyLike(raw?.skontoPct ?? raw?.skonto, 0),
    paymentTerms: safeString(raw?.paymentTerms ?? raw?.zahlungsbedingungen),
  };
}

function isModuleCategory(category: string) {
  const c = safeString(category).toLowerCase();
  return ["module", "modules", "modul", "modulele", "pv-module"].includes(c);
}

function isBatteryCategory(category: string) {
  const c = safeString(category).toLowerCase();
  return ["batterie", "battery", "speicher", "storage"].includes(c);
}

function isWallboxCategory(category: string) {
  const c = safeString(category).toLowerCase();
  return ["ladestation", "wallbox", "ev_charger", "charger"].includes(c);
}

function isHeatPumpCategory(category: string) {
  const c = safeString(category).toLowerCase();
  return ["wärmepumpe", "waermepumpe", "heatpump", "heat_pump"].includes(c);
}

function shouldIncludePartItem(
  item: NormalizedPartItem,
  options: ReturnType<typeof normalizeReportOptions>
) {
  const category = item.category.toLowerCase();

  if (isBatteryCategory(category) && options.battery === false) {
    return false;
  }

  if (isWallboxCategory(category) && options.charging === false) {
    return false;
  }

  if (isHeatPumpCategory(category) && options.heatPump === false) {
    return false;
  }

  return true;
}

function getNormalizedIncludedParts(
  doc: any,
  reportOptions: ReturnType<typeof normalizeReportOptions>
) {
  const rawItems = getRawPartsItemsFromPlanning(doc);

  if (!Array.isArray(rawItems)) {
    return [] as NormalizedPartItem[];
  }

  return rawItems
    .map(normalizePartItem)
    .filter((item) => shouldIncludePartItem(item, reportOptions));
}

function getCostBreakdownFromIncludedParts(items: NormalizedPartItem[]) {
  const moduleItems = items.filter((item) => isModuleCategory(item.category));
  const nonModuleItems = items.filter((item) => !isModuleCategory(item.category));

  const modulesTotalChf = Number(
    moduleItems
      .reduce((sum, item) => sum + safeNumber(item.lineTotalNet, 0), 0)
      .toFixed(2)
  );

  const partsTotalChf = Number(
    nonModuleItems
      .reduce((sum, item) => sum + safeNumber(item.lineTotalNet, 0), 0)
      .toFixed(2)
  );

  const grossInvestmentChf = Number((modulesTotalChf + partsTotalChf).toFixed(2));

  return {
    moduleItems,
    nonModuleItems,
    modulesTotalChf,
    partsTotalChf,
    grossInvestmentChf,
  };
}

function inferEnergyFlagsFromIncludedParts(args: {
  items: NormalizedPartItem[];
  reportOptions: ReturnType<typeof normalizeReportOptions>;
  ist: any;
}) {
  const { items, reportOptions, ist } = args;

  const hasBatteryFromParts = items.some((item) => isBatteryCategory(item.category));
  const hasEvFromParts = items.some((item) => isWallboxCategory(item.category));
  const hasHeatPumpFromParts = items.some((item) => isHeatPumpCategory(item.category));

  const hasBattery =
    hasBatteryFromParts ||
    (typeof reportOptions.battery === "boolean" ? reportOptions.battery : !!ist?.hasBattery);

  const hasEv =
    hasEvFromParts ||
    (typeof reportOptions.charging === "boolean" ? reportOptions.charging : !!ist?.hasEV);

  const hasHeatPump =
    hasHeatPumpFromParts ||
    (typeof reportOptions.heatPump === "boolean" ? reportOptions.heatPump : !!ist?.hasHeatPump);

  return {
    hasBattery,
    hasEv,
    hasHeatPump,
  };
}

function getCatalogItemById(items: NormalizedCatalogItem[], id?: string | null) {
  const wanted = safeString(id);
  if (!wanted) return null;
  return items.find((item) => item.id === wanted) ?? null;
}

function hasEquivalentPart(items: NormalizedPartItem[], kind: "battery" | "wallbox") {
  return items.some((item) =>
    kind === "battery"
      ? isBatteryCategory(item.category)
      : isWallboxCategory(item.category)
  );
}

/* --------------------------- Main report builder -------------------------- */

export function buildReportSummary(doc: any, catalogItemsRaw: any[]) {
  const data = doc?.data ?? {};
  const planner = data?.planner ?? {};
  const ist = data?.ist ?? {};
  const summary = doc?.summary ?? {};
  const reportOptions = normalizeReportOptions(data?.reportOptions ?? {});
  const catalogItems = Array.isArray(catalogItemsRaw)
    ? catalogItemsRaw.map(normalizeCatalogItem).filter((i) => i.isActive)
    : [];

  const panels = Array.isArray(planner?.panels) ? planner.panels : [];
  const layers = Array.isArray(planner?.layers) ? planner.layers : [];
  const catalogPanels = Array.isArray(planner?.catalogPanels)
    ? planner.catalogPanels
    : Array.isArray(data?.catalogPanels)
      ? data.catalogPanels
      : [];

  const moduleCount =
    safeNumber(summary?.moduleCount, 0) > 0
      ? safeNumber(summary?.moduleCount, 0)
      : panels.length;

  const selectedPanelId =
    safeString(planner?.selectedPanelId) ||
    safeString(summary?.selectedPanelId) ||
    safeString(panels?.[0]?.panelId) ||
    null;

  const selectedPanel =
    (selectedPanelId &&
      catalogPanels.find((p: any) => safeString(p?.id) === selectedPanelId)) ||
    null;

  const selectedPanelBrand = safeString(selectedPanel?.brand);
  const selectedPanelModel = safeString(selectedPanel?.model);
  const selectedPanelWp = safeNumber(selectedPanel?.wp, 0);
  const selectedPanelWidthM = safeNumber(selectedPanel?.widthM, 0);
  const selectedPanelHeightM = safeNumber(selectedPanel?.heightM, 0);
  const fallbackModuleUnitPriceChf = safeNumber(selectedPanel?.priceChf, 0);

  const dcPowerKw =
    safeNumber(summary?.dcPowerKw, 0) > 0
      ? round2(safeNumber(summary?.dcPowerKw, 0))
      : moduleCount > 0 && selectedPanelWp > 0
        ? round2((moduleCount * selectedPanelWp) / 1000)
        : 0;

  const moduleAreaM2 =
    moduleCount > 0 && selectedPanelWidthM > 0 && selectedPanelHeightM > 0
      ? round2(moduleCount * selectedPanelWidthM * selectedPanelHeightM)
      : 0;

  const roofCount = layers.length;
  const usedRoofs = getUsedRoofs(layers, panels);
  const usedRoofCount = Array.isArray(usedRoofs) ? usedRoofs.length : 0;
  const avgRoofTiltDeg = round1(averageRoofTiltDeg(usedRoofs.length ? usedRoofs : layers));

  const yearlyConsumptionKwh = safeNumber(ist?.electricityUsageKwh, 0);
  const yearlyYieldKwhPerKwp = inferYieldPerKwpFromRoofs(layers, panels);
  const annualProductionKwh =
    dcPowerKw > 0 ? Math.round(dcPowerKw * yearlyYieldKwhPerKwp) : 0;

  const includedParts = getNormalizedIncludedParts(doc, reportOptions);
  const costBreakdown = getCostBreakdownFromIncludedParts(includedParts);

  let modulesTotalChf = costBreakdown.modulesTotalChf;
  let partsTotalChf = costBreakdown.partsTotalChf;
  let grossInvestmentChf = costBreakdown.grossInvestmentChf;

  if (grossInvestmentChf <= 0 && moduleCount > 0 && fallbackModuleUnitPriceChf > 0) {
    modulesTotalChf = round2(moduleCount * fallbackModuleUnitPriceChf);
    partsTotalChf = 0;
    grossInvestmentChf = round2(modulesTotalChf + partsTotalChf);
  }

  const selectedBatteryCatalogItem = getCatalogItemById(
    catalogItems,
    reportOptions.selectedBatteryItemId
  );

  const selectedWallboxCatalogItem = getCatalogItemById(
    catalogItems,
    reportOptions.selectedWallboxItemId
  );

  const batteryAlreadyInParts = hasEquivalentPart(includedParts, "battery");
  const wallboxAlreadyInParts = hasEquivalentPart(includedParts, "wallbox");

  const extraBatteryCostChf =
    reportOptions.battery !== false &&
    selectedBatteryCatalogItem &&
    !batteryAlreadyInParts
      ? round2(selectedBatteryCatalogItem.priceNet)
      : 0;

  const extraWallboxCostChf =
    reportOptions.charging !== false &&
    selectedWallboxCatalogItem &&
    !wallboxAlreadyInParts
      ? round2(selectedWallboxCatalogItem.priceNet)
      : 0;

  partsTotalChf = round2(partsTotalChf + extraBatteryCostChf + extraWallboxCostChf);
  grossInvestmentChf = round2(modulesTotalChf + partsTotalChf);

  const moduleUnitPriceChf =
    moduleCount > 0 && modulesTotalChf > 0
      ? round2(modulesTotalChf / moduleCount)
      : fallbackModuleUnitPriceChf;

  const { hasBattery, hasEv, hasHeatPump } = inferEnergyFlagsFromIncludedParts({
    items: includedParts,
    reportOptions,
    ist,
  });

  const selfConsumptionPctEstimated = estimateSelfConsumptionPct({
    yearlyConsumptionKwh,
    annualProductionKwh,
    hasBattery,
    hasEv,
    hasHeatPump,
  });

  const selfUseKwh = Math.round(
    Math.min(annualProductionKwh, annualProductionKwh * selfConsumptionPctEstimated)
  );

  const feedInKwh = Math.max(0, annualProductionKwh - selfUseKwh);

  const selfUseSharePct =
    annualProductionKwh > 0
      ? round1((selfUseKwh / annualProductionKwh) * 100)
      : 0;

  const autarkyPct =
    yearlyConsumptionKwh > 0
      ? round1((selfUseKwh / yearlyConsumptionKwh) * 100)
      : 0;

 const discountPct = round2(clamp(reportOptions.discountPct, 0, 100));
const discountChf = round2(Math.max(0, reportOptions.discountChf));

const automaticPvSubsidyChf = calculatePvSubsidyChf(dcPowerKw);
const manualAdditionalSubsidyChf = round2(Math.max(0, reportOptions.subsidyChf));
const subsidyChf = round2(automaticPvSubsidyChf + manualAdditionalSubsidyChf);

const skontoPct = round2(clamp(reportOptions.skontoPct, 0, 100));

  const discountFromPctChf = round2((grossInvestmentChf * discountPct) / 100);
  const totalDiscountChf = round2(discountFromPctChf + discountChf);

  const netInvestmentBeforeSubsidyChf = round2(
    Math.max(0, grossInvestmentChf - totalDiscountChf)
  );

  const totalInvestmentChf = round2(
    Math.max(0, netInvestmentBeforeSubsidyChf - subsidyChf)
  );

  const skontoValueChf = round2(
    Math.max(0, netInvestmentBeforeSubsidyChf * (skontoPct / 100))
  );

  const tariffConsumptionChfPerKwh = 0.277;
  const tariffFeedInChfPerKwh = 0.1;

  const annualSavingsChf = round2(selfUseKwh * tariffConsumptionChfPerKwh);
  const annualFeedInRevenueChf = round2(feedInKwh * tariffFeedInChfPerKwh);
  const annualBenefitChf = round2(annualSavingsChf + annualFeedInRevenueChf);

  const breakEvenYears =
    totalInvestmentChf > 0 && annualBenefitChf > 0
      ? round1(totalInvestmentChf / annualBenefitChf)
      : null;

  const roiPct =
    totalInvestmentChf > 0 && annualBenefitChf > 0
      ? round1((annualBenefitChf / totalInvestmentChf) * 100)
      : null;

  return {
    moduleCount,
    selectedPanelId,
    selectedPanelBrand,
    selectedPanelModel,
    selectedPanelWp,

    dcPowerKw,
    moduleAreaM2,
    roofCount,
    usedRoofCount,
    avgRoofTiltDeg,

    yearlyConsumptionKwh,
    yearlyYieldKwhPerKwp,
    annualProductionKwh,

    selfUseKwh,
    feedInKwh,
    selfUseSharePct,
    autarkyPct,
    selfConsumptionPctEstimated: round1(selfConsumptionPctEstimated * 100),

    moduleUnitPriceChf,
    modulesTotalChf,
    partsTotalChf,

   grossInvestmentChf,
discountChf,
discountPct,
discountFromPctChf,
totalDiscountChf,

automaticPvSubsidyChf,
manualAdditionalSubsidyChf,
subsidyChf,

netInvestmentBeforeSubsidyChf,
skontoPct,
skontoValueChf,
totalInvestmentChf,

    annualSavingsChf,
    annualFeedInRevenueChf,
    annualBenefitChf,

    breakEvenYears,
    roiPct,

    tariffConsumptionChfPerKwh,
    tariffFeedInChfPerKwh,

    hasBattery,
    hasEv,
    hasHeatPump,

    paymentTerms: reportOptions.paymentTerms,
    includedPartsCount: includedParts.length,

    extraBatteryCostChf,
    extraWallboxCostChf,
    selectedBatteryItemId: reportOptions.selectedBatteryItemId,
    selectedWallboxItemId: reportOptions.selectedWallboxItemId,

    lastCalculatedAt: new Date().toISOString(),
    calculationMode: "mvp_estimated",
  };
}

/* -------------------------------- OPTIONS -------------------------------- */

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(origin),
  });
}

/* ---------------------------------- GET ---------------------------------- */

export async function GET(
  req: Request,
  { params }: { params: Promise<{ planningId: string }> },
) {
  const origin = req.headers.get("origin");
  const { planningId } = await params;

  const uri = process.env.MONGODB_URI;
  const secret = process.env.SESSION_SECRET;

  if (!uri) {
    return jsonResponse(origin, { ok: false, error: "Missing MONGODB_URI" }, 500);
  }

  if (!secret) {
    return jsonResponse(origin, { ok: false, error: "Missing SESSION_SECRET" }, 500);
  }

  const session = readSession(req, secret);
  if (!session) {
    return jsonResponse(origin, { ok: false, error: "Not logged in" }, 401);
  }

  if (!planningId) {
    return jsonResponse(origin, { ok: false, error: "Missing planningId" }, 400);
  }

  const planningObjectId = toObjectIdOrNull(planningId);
  if (!planningObjectId) {
    return jsonResponse(origin, { ok: false, error: "Invalid planningId" }, 400);
  }

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });

  try {
    await client.connect();
    const db = client.db();
    const plannings = db.collection("plannings");
    const catalogItems = db.collection("catalogItems");

    const doc = await plannings.findOne({
      _id: planningObjectId,
      companyId: session.activeCompanyId,
    });

    if (!doc) {
      return jsonResponse(origin, { ok: false, error: "Planning not found" }, 404);
    }

    const catalogDocs = await catalogItems
      .find({
        companyId: session.activeCompanyId,
        isActive: true,
      })
      .toArray();

    const reportSummary = buildReportSummary(doc, catalogDocs);

    return jsonResponse(
      origin,
      {
        ok: true,
        planningId: String((doc as any)._id),
        reportSummary,
      },
      200
    );
  } catch (e: any) {
    console.error("GET REPORT SUMMARY ERROR:", e);
    return jsonResponse(
      origin,
      { ok: false, error: e?.message ?? "Unknown error" },
      500
    );
  } finally {
    await client.close().catch(() => {});
  }
}