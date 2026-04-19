// src/app/api/plannings/[planningId]/parts-defaults/route.ts
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

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/* ------------------------------ Normalization ----------------------------- */

function normalizeCatalogItem(doc: any) {
  return {
    id: String(doc._id),
    companyId: doc.companyId ?? null,
    category: safeString(doc.category),
    subcategory: safeString(doc.subcategory),
    brand: safeString(doc.brand),
    model: safeString(doc.model),
    name: safeString(doc.name),
    description: safeString(doc.description),
    unit: safeString(doc.unit) || "piece",
    unitLabel: safeString(doc.unitLabel) || "Stk.",
    priceNet: safeNumber(doc.priceNet, 0),
    costNet: safeNumber(doc.costNet, 0),
    vatRate: safeNumber(doc.vatRate, 8.1),
    isActive: typeof doc.isActive === "boolean" ? doc.isActive : true,
    sortOrder: safeNumber(doc.sortOrder, 0),
    metadata: doc.metadata && typeof doc.metadata === "object" ? doc.metadata : {},
    createdAt: doc.createdAt ?? null,
    updatedAt: doc.updatedAt ?? null,
  };
}

function parsePowerKwFromText(input: string) {
  const s = safeString(input).toLowerCase();

  const matches = [
    s.match(/(\d+(?:[.,]\d+)?)\s*kw/),
    s.match(/(\d+(?:[.,]\d+)?)\s*ktl/),
    s.match(/(\d+(?:[.,]\d+)?)\s*kwp/),
  ];

  for (const m of matches) {
    if (m?.[1]) {
      const n = Number(m[1].replace(",", "."));
      if (Number.isFinite(n)) return n;
    }
  }

  return null;
}

function parseBatteryCapacityKwhFromText(input: string) {
  const s = safeString(input).toLowerCase();
  const m = s.match(/(\d+(?:[.,]\d+)?)\s*kwh/);
  if (!m?.[1]) return null;

  const n = Number(m[1].replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function textIndex(item: any) {
  return [
    safeString(item.category),
    safeString(item.subcategory),
    safeString(item.brand),
    safeString(item.model),
    safeString(item.name),
    safeString(item.description),
  ]
    .join(" ")
    .toLowerCase();
}

function hasAnyToken(haystack: string, tokens: string[]) {
  return tokens.some((token) => haystack.includes(token.toLowerCase()));
}

/* ------------------------------- Line items ------------------------------- */

function makeLineItem(args: {
  id: string;
  kategorie: string;
  marke?: string;
  beschreibung: string;
  einzelpreis: number;
  stk: number;
  einheit?: string;
  optional?: boolean;
  sourceCatalogItemId?: string | null;
  sourceCategory?: string | null;
}) {
  return {
    id: args.id,
    kategorie: args.kategorie,
    marke: safeString(args.marke),
    beschreibung: args.beschreibung,
    einzelpreis: Number(safeNumber(args.einzelpreis, 0).toFixed(2)),
    stk: Number(safeNumber(args.stk, 0).toFixed(2)),
    einheit: args.einheit || "Stk.",
    optional: !!args.optional,
    sourceCatalogItemId: args.sourceCatalogItemId ?? null,
    sourceCategory: args.sourceCategory ?? null,
  };
}

/* ------------------------------ Planning core ----------------------------- */

function getPlanningCore(doc: any) {
  const data = doc?.data ?? {};
  const planner = data?.planner ?? {};
  const ist = data?.ist ?? {};
  const summary = doc?.summary ?? {};

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
    safeString(summary?.selectedPanelId) ||
    safeString(planner?.selectedPanelId) ||
    safeString(panels?.[0]?.panelId) ||
    "";

  const selectedPanel =
    (selectedPanelId &&
      catalogPanels.find((p: any) => safeString(p?.id) === selectedPanelId)) ||
    null;

  const selectedPanelWp = safeNumber(selectedPanel?.wp, 0);

  const dcPowerKw =
    safeNumber(summary?.dcPowerKw, 0) > 0
      ? safeNumber(summary?.dcPowerKw, 0)
      : moduleCount > 0 && selectedPanelWp > 0
        ? Number(((moduleCount * selectedPanelWp) / 1000).toFixed(2))
        : 0;

  return {
    panels,
    layers,
    ist,
    summary,
    moduleCount,
    selectedPanelId,
    selectedPanel,
    dcPowerKw,
  };
}

/* ----------------------------- Catalog lookups ---------------------------- */

function getActiveItems(catalogItemsRaw: any[]) {
  return catalogItemsRaw.map(normalizeCatalogItem).filter((i) => i.isActive);
}

function findFirstMatchingItem(
  items: any[],
  tokens: string[],
  opts?: {
    requirePrice?: boolean;
    excludeTokens?: string[];
  }
) {
  const requirePrice = opts?.requirePrice ?? true;
  const excludeTokens = opts?.excludeTokens ?? [];

  const candidates = items.filter((item) => {
    const idx = textIndex(item);
    if (!hasAnyToken(idx, tokens)) return false;
    if (excludeTokens.length && hasAnyToken(idx, excludeTokens)) return false;
    if (requirePrice && safeNumber(item.priceNet, 0) <= 0) return false;
    return true;
  });

  candidates.sort((a, b) => {
    const aScore = safeNumber(a.sortOrder, 0);
    const bScore = safeNumber(b.sortOrder, 0);
    if (aScore !== bScore) return aScore - bScore;

    return safeString(a.name).localeCompare(safeString(b.name));
  });

  return candidates[0] ?? null;
}

/* --------------------------- Inverter allocation -------------------------- */

function getInverters(items: any[]) {
  return items
    .filter((i) => hasAnyToken(textIndex(i), ["inverter", "wechselrichter"]))
    .map((i) => {
      const metaKw = safeNumber(i?.metadata?.powerKw, 0);
      const parsedKw =
        metaKw > 0
          ? metaKw
          : parsePowerKwFromText(`${i.name} ${i.model} ${i.description}`) ?? 0;

      return {
        ...i,
        inferredPowerKw: parsedKw,
      };
    })
    .filter((i) => i.inferredPowerKw > 0)
    .sort((a, b) => a.inferredPowerKw - b.inferredPowerKw);
}

function buildInverterCombinations(
  models: any[],
  maxUnits = 3
): Array<{ items: Array<{ item: any; quantity: number }>; totalKw: number; units: number }> {
  const combos: Array<{ items: Array<{ item: any; quantity: number }>; totalKw: number; units: number }> = [];
  const n = models.length;

  function walk(index: number, remainingUnits: number, acc: Array<{ item: any; quantity: number }>) {
    if (index >= n || remainingUnits <= 0) {
      const used = acc.filter((x) => x.quantity > 0);
      const units = used.reduce((sum, x) => sum + x.quantity, 0);
      if (units > 0) {
        const totalKw = round2(
          used.reduce((sum, x) => sum + safeNumber(x.item.inferredPowerKw, 0) * x.quantity, 0)
        );
        combos.push({ items: used, totalKw, units });
      }
      return;
    }

    for (let qty = 0; qty <= remainingUnits; qty += 1) {
      walk(index + 1, remainingUnits - qty, [...acc, { item: models[index], quantity: qty }]);
    }
  }

  walk(0, maxUnits, []);
  return combos;
}

function chooseInverterAllocation(items: any[], dcPowerKw: number) {
  const inverters = getInverters(items);
  if (!inverters.length || dcPowerKw <= 0) return [];

  const minAcKw = dcPowerKw * 0.78;
  const maxAcKw = dcPowerKw * 1.08;
  const targetAcKw = dcPowerKw;

  const combos = buildInverterCombinations(inverters, 3)
    .filter((combo) => combo.totalKw >= minAcKw && combo.totalKw <= maxAcKw)
    .sort((a, b) => {
      if (a.units !== b.units) return a.units - b.units;

      const aDiff = Math.abs(a.totalKw - targetAcKw);
      const bDiff = Math.abs(b.totalKw - targetAcKw);
      if (aDiff !== bDiff) return aDiff - bDiff;

      const aDistinct = a.items.length;
      const bDistinct = b.items.length;
      if (aDistinct !== bDistinct) return aDistinct - bDistinct;

      return b.totalKw - a.totalKw;
    });

  if (combos.length) {
    return combos[0].items;
  }

  const fallback = [...inverters].sort(
    (a, b) =>
      Math.abs(safeNumber(a.inferredPowerKw, 0) - dcPowerKw) -
      Math.abs(safeNumber(b.inferredPowerKw, 0) - dcPowerKw)
  )[0];

  return fallback ? [{ item: fallback, quantity: 1 }] : [];
}

/* ----------------------------- Battery choice ----------------------------- */

function getBatteries(items: any[]) {
  return items
    .filter((i) => hasAnyToken(textIndex(i), ["battery", "batterie", "speicher", "akku"]))
    .map((i) => {
      const metaKwh = safeNumber(i?.metadata?.capacityKwh, 0);
      const parsedKwh =
        metaKwh > 0
          ? metaKwh
          : parseBatteryCapacityKwhFromText(`${i.name} ${i.model} ${i.description}`) ?? 0;

      return {
        ...i,
        inferredCapacityKwh: parsedKwh,
      };
    })
    .filter((i) => safeNumber(i.inferredCapacityKwh, 0) > 0)
    .sort((a, b) => a.inferredCapacityKwh - b.inferredCapacityKwh);
}

function estimateTargetBatteryKwh(args: {
  dcPowerKw: number;
  yearlyConsumptionKwh: number;
}) {
  const { dcPowerKw, yearlyConsumptionKwh } = args;

  let target = Math.max(5, dcPowerKw * 0.55);

  if (yearlyConsumptionKwh >= 8000) target += 2;
  if (yearlyConsumptionKwh >= 12000) target += 3;
  if (yearlyConsumptionKwh >= 18000) target += 4;

  return clamp(round1(target), 5, 30);
}

function chooseBattery(items: any[], dcPowerKw: number, yearlyConsumptionKwh: number) {
  const batteries = getBatteries(items);
  if (!batteries.length) return null;

  const targetKwh = estimateTargetBatteryKwh({ dcPowerKw, yearlyConsumptionKwh });

  const preferred =
    batteries.find((b) => safeNumber(b.inferredCapacityKwh, 0) >= targetKwh) ??
    [...batteries].sort(
      (a, b) =>
        Math.abs(safeNumber(a.inferredCapacityKwh, 0) - targetKwh) -
        Math.abs(safeNumber(b.inferredCapacityKwh, 0) - targetKwh)
    )[0] ??
    null;

  return preferred
    ? {
        item: preferred,
        targetKwh,
      }
    : null;
}

/* --------------------------- Mounting estimation -------------------------- */

function inferRoofType(args: { ist: any; layers: any[] }) {
  const roofShape = safeString(args.ist?.roofShape).toLowerCase();

  if (roofShape.includes("flat") || roofShape.includes("flach")) return "flat";
  if (roofShape.includes("schräg") || roofShape.includes("schrag")) return "pitched";
  if (roofShape.includes("sattel")) return "pitched";
  if (roofShape.includes("pult")) return "pitched";
  if (roofShape.includes("walm")) return "pitched";

  const tilts = (Array.isArray(args.layers) ? args.layers : [])
    .map((l) => safeNumber(l?.tiltDeg, NaN))
    .filter((n) => Number.isFinite(n));

  if (tilts.length) {
    const avg = tilts.reduce((a, b) => a + b, 0) / tilts.length;
    return avg <= 5 ? "flat" : "pitched";
  }

  return "pitched";
}

function estimateMountingRailMeters(moduleCount: number, roofType: "flat" | "pitched") {
  const factor = roofType === "flat" ? 2.8 : 2.4;
  return round1(moduleCount * factor);
}

function estimateRoofHooks(moduleCount: number, roofType: "flat" | "pitched") {
  if (roofType === "flat") return 0;
  return Math.ceil(moduleCount * 3);
}

function estimateDcElectricalPrice(dcPowerKw: number) {
  if (dcPowerKw <= 0) return 0;
  return round2(Math.max(700, dcPowerKw * 85));
}

function estimateAcElectricalPrice(dcPowerKw: number, yearlyConsumptionKwh: number, inverterCount: number) {
  let base = Math.max(900, dcPowerKw * 70);
  if (yearlyConsumptionKwh >= 12000) base += 350;
  if (yearlyConsumptionKwh >= 25000) base += 500;
  if (inverterCount > 1) base += (inverterCount - 1) * 250;
  return round2(base);
}

function estimateAdministrationPrice(dcPowerKw: number) {
  return round2(Math.max(450, 180 + dcPowerKw * 18));
}

function estimatePronovoControlPrice(dcPowerKw: number) {
  return round2(Math.max(350, 250 + dcPowerKw * 8));
}

function estimateMontageServicePrice(args: {
  dcPowerKw: number;
  moduleCount: number;
  roofType: "flat" | "pitched";
  roofCount: number;
  hasBattery: boolean;
}) {
  const { dcPowerKw, moduleCount, roofType, roofCount, hasBattery } = args;

  let base = roofType === "flat" ? 3200 : 2800;
  base += roofType === "flat" ? moduleCount * 105 : moduleCount * 85;
  base += Math.max(0, roofCount - 1) * 450;
  if (hasBattery) base += 600;
  if (dcPowerKw >= 30) base += 900;
  if (dcPowerKw >= 50) base += 1200;

  return round2(base);
}

/* --------------------------- Default item builder ------------------------- */

function buildDefaultPartsItems(doc: any, catalogItemsRaw: any[]) {
  const items = getActiveItems(catalogItemsRaw);
  const { ist, layers, moduleCount, selectedPanel, dcPowerKw } = getPlanningCore(doc);

  const yearlyConsumptionKwh = safeNumber(ist?.electricityUsageKwh, 0);
  const hasBattery = !!ist?.hasBattery;
  const hasEV = !!ist?.hasEV;
  const roofType = inferRoofType({ ist, layers });
  const roofCount = Array.isArray(layers) ? layers.length : 0;

  const defaults: any[] = [];

  /* ------------------------------ module row ------------------------------ */
  if (selectedPanel && moduleCount > 0) {
    defaults.push(
      makeLineItem({
        id: "auto-module",
        kategorie: "Module",
        marke: safeString(selectedPanel.brand),
        beschreibung: safeString(selectedPanel.model) || safeString(selectedPanel.id),
        einzelpreis: safeNumber(selectedPanel.priceChf, 0),
        stk: moduleCount,
        einheit: "Stk.",
        optional: false,
        sourceCatalogItemId: safeString(selectedPanel.id),
        sourceCategory: "module",
      })
    );
  }

  /* -------------------------- inverter rows (smart) ----------------------- */
  const inverterAllocation = chooseInverterAllocation(items, dcPowerKw);
  const inverterCount = inverterAllocation.reduce((sum, x) => sum + safeNumber(x.quantity, 0), 0);

  inverterAllocation.forEach((allocation, index) => {
    defaults.push(
      makeLineItem({
        id: `auto-inverter-${index + 1}`,
        kategorie: "Wechselrichter",
        marke: allocation.item.brand,
        beschreibung:
          safeString(allocation.item.name) ||
          safeString(allocation.item.model) ||
          "Wechselrichter",
        einzelpreis: safeNumber(allocation.item.priceNet, 0),
        stk: allocation.quantity,
        einheit: allocation.item.unitLabel || "Stk.",
        optional: false,
        sourceCatalogItemId: allocation.item.id,
        sourceCategory: "inverter",
      })
    );
  });

  /* ------------------------- mounting / substructure ---------------------- */
  const rail = findFirstMatchingItem(items, [
    "montageschiene",
    "schiene",
    "rail",
    "mounting rail",
  ]);

  if (rail && moduleCount > 0) {
    defaults.push(
      makeLineItem({
        id: "auto-mounting-rail",
        kategorie: "Montage",
        marke: rail.brand,
        beschreibung: rail.name || "Montageschiene",
        einzelpreis: safeNumber(rail.priceNet, 0),
        stk: estimateMountingRailMeters(moduleCount, roofType),
        einheit: rail.unitLabel || "m",
        optional: false,
        sourceCatalogItemId: rail.id,
        sourceCategory: "mounting",
      })
    );
  }

  const hooks = findFirstMatchingItem(items, ["dachhaken", "roof hook", "hook"]);
  const hookQty = estimateRoofHooks(moduleCount, roofType);

  if (hooks && moduleCount > 0 && hookQty > 0) {
    defaults.push(
      makeLineItem({
        id: "auto-mounting-hooks",
        kategorie: "Montage",
        marke: hooks.brand,
        beschreibung: hooks.name || "Dachhaken",
        einzelpreis: safeNumber(hooks.priceNet, 0),
        stk: hookQty,
        einheit: hooks.unitLabel || "Stk.",
        optional: false,
        sourceCatalogItemId: hooks.id,
        sourceCategory: "mounting",
      })
    );
  }

  const flatMounting = findFirstMatchingItem(items, [
    "flachdach",
    "aufständerung",
    "aufstaenderung",
    "ballast",
    "flat roof",
  ]);

  if (flatMounting && moduleCount > 0 && roofType === "flat") {
    defaults.push(
      makeLineItem({
        id: "auto-flat-roof-substructure",
        kategorie: "Montage",
        marke: flatMounting.brand,
        beschreibung:
          flatMounting.name ||
          flatMounting.model ||
          "Flachdach-Unterkonstruktion",
        einzelpreis: safeNumber(flatMounting.priceNet, 0),
        stk: 1,
        einheit: flatMounting.unitLabel || "Set",
        optional: false,
        sourceCatalogItemId: flatMounting.id,
        sourceCategory: "mounting",
      })
    );
  }

  /* ---------------------------- DC electrical ----------------------------- */
  const dcElectrical = findFirstMatchingItem(items, [
    "dc elektrisch",
    "dc-elektrisch",
    "dc electrical",
    "dc installation",
    "generatoranschlusskasten",
    "gak",
  ]);

  defaults.push(
    dcElectrical
      ? makeLineItem({
          id: "auto-dc-electrical",
          kategorie: "DC Elektrisch",
          marke: dcElectrical.brand,
          beschreibung:
            dcElectrical.name || dcElectrical.model || "DC Elektrisch",
          einzelpreis: safeNumber(dcElectrical.priceNet, 0),
          stk: 1,
          einheit: dcElectrical.unitLabel || "Pauschal",
          optional: false,
          sourceCatalogItemId: dcElectrical.id,
          sourceCategory: "dc_electrical",
        })
      : makeLineItem({
          id: "auto-dc-electrical-generic",
          kategorie: "DC Elektrisch",
          marke: "",
          beschreibung: "DC Elektrisch",
          einzelpreis: estimateDcElectricalPrice(dcPowerKw),
          stk: 1,
          einheit: "Pauschal",
          optional: false,
          sourceCatalogItemId: null,
          sourceCategory: "dc_electrical",
        })
  );

  /* ---------------------------- AC electrical ----------------------------- */
  const acElectrical = findFirstMatchingItem(
    items,
    [
      "ac elektrisch",
      "ac-elektrisch",
      "ac electrical",
      "ac installation",
      "wechselrichter installation",
      "zähler",
      "meter",
    ],
    {
      excludeTokens: ["netzanschluss"],
    }
  );

  defaults.push(
    acElectrical
      ? makeLineItem({
          id: "auto-ac-electrical",
          kategorie: "AC Elektrisch",
          marke: acElectrical.brand,
          beschreibung:
            acElectrical.name || acElectrical.model || "AC Elektrisch",
          einzelpreis: safeNumber(acElectrical.priceNet, 0),
          stk: 1,
          einheit: acElectrical.unitLabel || "Pauschal",
          optional: false,
          sourceCatalogItemId: acElectrical.id,
          sourceCategory: "ac_electrical",
        })
      : makeLineItem({
          id: "auto-ac-electrical-generic",
          kategorie: "AC Elektrisch",
          marke: "",
          beschreibung: "AC Elektrisch",
          einzelpreis: estimateAcElectricalPrice(dcPowerKw, yearlyConsumptionKwh, inverterCount || 1),
          stk: 1,
          einheit: "Pauschal",
          optional: false,
          sourceCatalogItemId: null,
          sourceCategory: "ac_electrical",
        })
  );

  /* --------------------------- installation service ----------------------- */
  const montageService = findFirstMatchingItem(items, [
    "montage pauschal",
    "montagearbeiten",
    "bau+dc",
    "montage",
    "installation",
  ]);

  defaults.push(
    montageService
      ? makeLineItem({
          id: "auto-service-montage",
          kategorie: "Service",
          marke: montageService.brand,
          beschreibung: montageService.name || "Montage pauschal",
          einzelpreis: safeNumber(montageService.priceNet, 0),
          stk: 1,
          einheit: montageService.unitLabel || "Pauschal",
          optional: false,
          sourceCatalogItemId: montageService.id,
          sourceCategory: "service",
        })
      : makeLineItem({
          id: "auto-service-montage-generic",
          kategorie: "Service",
          marke: "",
          beschreibung: "Montage pauschal",
          einzelpreis: estimateMontageServicePrice({
            dcPowerKw,
            moduleCount,
            roofType,
            roofCount,
            hasBattery,
          }),
          stk: 1,
          einheit: "Pauschal",
          optional: false,
          sourceCatalogItemId: null,
          sourceCategory: "service",
        })
  );

  const commissioning = findFirstMatchingItem(items, [
    "inbetriebnahme",
    "commissioning",
    "abnahme",
  ]);

  if (commissioning) {
    defaults.push(
      makeLineItem({
        id: "auto-service-inbetriebnahme",
        kategorie: "Service",
        marke: commissioning.brand,
        beschreibung: commissioning.name || "Inbetriebnahme",
        einzelpreis: safeNumber(commissioning.priceNet, 0),
        stk: 1,
        einheit: commissioning.unitLabel || "Pauschal",
        optional: false,
        sourceCatalogItemId: commissioning.id,
        sourceCategory: "service",
      })
    );
  }

  /* -------------------------- administration / planning ------------------- */
  const admin = findFirstMatchingItem(items, [
    "administration",
    "planung",
    "project management",
    "projektierung",
  ]);

  defaults.push(
    admin
      ? makeLineItem({
          id: "auto-administration",
          kategorie: "Administration",
          marke: admin.brand,
          beschreibung: admin.name || admin.model || "Administration / Planung",
          einzelpreis: safeNumber(admin.priceNet, 0),
          stk: 1,
          einheit: admin.unitLabel || "Pauschal",
          optional: false,
          sourceCatalogItemId: admin.id,
          sourceCategory: "administration",
        })
      : makeLineItem({
          id: "auto-administration-generic",
          kategorie: "Administration",
          marke: "",
          beschreibung: "Administration / Planung",
          einzelpreis: estimateAdministrationPrice(dcPowerKw),
          stk: 1,
          einheit: "Pauschal",
          optional: false,
          sourceCatalogItemId: null,
          sourceCategory: "administration",
        })
  );

  /* ------------------------- pronovo / kontrolleur ------------------------ */
  const kontrolle = findFirstMatchingItem(items, [
    "kontrolle",
    "kontrolleur",
    "pronovo",
    "akkreditiert",
    "abnahme kontroll",
  ]);

  defaults.push(
    kontrolle
      ? makeLineItem({
          id: "auto-pronovo-control",
          kategorie: "Kontrolle",
          marke: kontrolle.brand,
          beschreibung: kontrolle.name || kontrolle.model || "Pronovo / Kontrolle",
          einzelpreis: safeNumber(kontrolle.priceNet, 0),
          stk: 1,
          einheit: kontrolle.unitLabel || "Pauschal",
          optional: false,
          sourceCatalogItemId: kontrolle.id,
          sourceCategory: "control",
        })
      : makeLineItem({
          id: "auto-pronovo-control-generic",
          kategorie: "Kontrolle",
          marke: "",
          beschreibung: "Pronovo / Kontrolle",
          einzelpreis: estimatePronovoControlPrice(dcPowerKw),
          stk: 1,
          einheit: "Pauschal",
          optional: false,
          sourceCatalogItemId: null,
          sourceCategory: "control",
        })
  );

  /* -------------------------------- extras -------------------------------- */
  const extraNetz = findFirstMatchingItem(items, [
    "netzanschluss",
    "grid connection",
  ]);

  if (extraNetz) {
    defaults.push(
      makeLineItem({
        id: "auto-extra-netzanschluss",
        kategorie: "Extra",
        marke: extraNetz.brand,
        beschreibung: extraNetz.name || "Netzanschluss",
        einzelpreis: safeNumber(extraNetz.priceNet, 0),
        stk: 1,
        einheit: extraNetz.unitLabel || "Pauschal",
        optional: false,
        sourceCatalogItemId: extraNetz.id,
        sourceCategory: "extra",
      })
    );
  }

  /* ------------------------------- battery -------------------------------- */
  if (hasBattery) {
    const batteryChoice = chooseBattery(items, dcPowerKw, yearlyConsumptionKwh);
    if (batteryChoice?.item) {
      defaults.push(
        makeLineItem({
          id: "auto-battery",
          kategorie: "Batterie",
          marke: batteryChoice.item.brand,
          beschreibung:
            batteryChoice.item.name ||
            batteryChoice.item.model ||
            `Batteriespeicher ~${batteryChoice.targetKwh} kWh`,
          einzelpreis: safeNumber(batteryChoice.item.priceNet, 0),
          stk: 1,
          einheit: batteryChoice.item.unitLabel || "Set",
          optional: false,
          sourceCatalogItemId: batteryChoice.item.id,
          sourceCategory: "battery",
        })
      );
    }
  }

  /* ------------------------------- wallbox -------------------------------- */
  if (hasEV) {
    const wallbox = findFirstMatchingItem(items, [
      "wallbox",
      "ladestation",
      "ev charger",
      "easee",
      "zaptec",
    ]);
    if (wallbox) {
      defaults.push(
        makeLineItem({
          id: "auto-wallbox",
          kategorie: "Ladestation",
          marke: wallbox.brand,
          beschreibung: wallbox.name || wallbox.model || "Wallbox",
          einzelpreis: safeNumber(wallbox.priceNet, 0),
          stk: 1,
          einheit: wallbox.unitLabel || "Stk.",
          optional: false,
          sourceCatalogItemId: wallbox.id,
          sourceCategory: "wallbox",
        })
      );
    }
  }

  return defaults;
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
  { params }: { params: Promise<{ planningId: string }> }
) {
  const origin = req.headers.get("origin");
  const { planningId } = await params;

  const uri = process.env.MONGODB_URI;
  const secret = process.env.SESSION_SECRET;

  if (!uri || !secret) {
    return jsonResponse(origin, { ok: false, error: "Missing env" }, 500);
  }

  const session = readSession(req, secret);
  if (!session?.activeCompanyId) {
    return jsonResponse(origin, { ok: false, error: "Not logged in" }, 401);
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

    const planning = await plannings.findOne({
      _id: planningObjectId,
      companyId: session.activeCompanyId,
    });

    if (!planning) {
      return jsonResponse(origin, { ok: false, error: "Planning not found" }, 404);
    }

    const docs = await catalogItems
      .find({
        companyId: session.activeCompanyId,
        isActive: true,
      })
      .sort({ category: 1, sortOrder: 1, name: 1 })
      .toArray();

    const defaultItems = buildDefaultPartsItems(planning, docs);

    return jsonResponse(
      origin,
      {
        ok: true,
        planningId,
        items: defaultItems,
      },
      200
    );
  } catch (e: any) {
    console.error("GET PARTS DEFAULTS ERROR:", e);
    return jsonResponse(
      origin,
      { ok: false, error: e?.message ?? "Unknown error" },
      500
    );
  } finally {
    await client.close().catch(() => {});
  }
}