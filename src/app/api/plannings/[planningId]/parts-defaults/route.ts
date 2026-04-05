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

function makeLineItem(args: {
  id: string;
  kategorie: string;
  marke?: string;
  beschreibung: string;
  einzelpreis: number;
  stk: number;
  einheit?: string;
  optional?: boolean;
  sourceCatalogItemId?: string;
  sourceCategory?: string;
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

function chooseBestInverter(items: any[], dcPowerKw: number) {
  const inverters = items
    .filter((i) => i.category === "inverter" && i.isActive)
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
    });

  if (!inverters.length) return null;

  // prefer inverter >= ~85% of DC size, but not massively oversized
  const minPreferred = dcPowerKw > 0 ? dcPowerKw * 0.85 : 0;

  const candidates = inverters
    .filter((i) => i.inferredPowerKw > 0 && i.inferredPowerKw >= minPreferred)
    .sort((a, b) => a.inferredPowerKw - b.inferredPowerKw);

  if (candidates.length) return candidates[0];

  const fallbackMeasured = inverters
    .filter((i) => i.inferredPowerKw > 0)
    .sort(
      (a, b) =>
        Math.abs(a.inferredPowerKw - dcPowerKw) -
        Math.abs(b.inferredPowerKw - dcPowerKw)
    );

  if (fallbackMeasured.length) return fallbackMeasured[0];

  return inverters[0];
}

function estimateMountingRailMeters(moduleCount: number) {
  // MVP prudente: circa 2.4 m di rotaie per modulo
  return Number((moduleCount * 2.4).toFixed(1));
}

function estimateRoofHooks(moduleCount: number) {
  // MVP prudente: circa 3 hooks per modulo
  return Math.ceil(moduleCount * 3);
}

function buildDefaultPartsItems(doc: any, catalogItemsRaw: any[]) {
  const items = catalogItemsRaw.map(normalizeCatalogItem);
  const { ist, moduleCount, selectedPanel, dcPowerKw } = getPlanningCore(doc);

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

  /* ------------------------------ inverter row ----------------------------- */
  const bestInverter = chooseBestInverter(items, dcPowerKw);
  if (bestInverter) {
    defaults.push(
      makeLineItem({
        id: "auto-inverter",
        kategorie: "Wechselrichter",
        marke: bestInverter.brand,
        beschreibung:
          safeString(bestInverter.name) || safeString(bestInverter.model) || "Wechselrichter",
        einzelpreis: safeNumber(bestInverter.priceNet, 0),
        stk: 1,
        einheit: bestInverter.unitLabel || "Stk.",
        optional: false,
        sourceCatalogItemId: bestInverter.id,
        sourceCategory: "inverter",
      })
    );
  }

  /* ------------------------------ mounting rows ---------------------------- */
  const rail = items.find(
    (i) => i.category === "mounting" && safeString(i.name).toLowerCase().includes("montageschiene")
  );
  if (rail && moduleCount > 0) {
    defaults.push(
      makeLineItem({
        id: "auto-mounting-rail",
        kategorie: "Montage",
        marke: rail.brand,
        beschreibung: rail.name || "Montageschiene",
        einzelpreis: safeNumber(rail.priceNet, 0),
        stk: estimateMountingRailMeters(moduleCount),
        einheit: rail.unitLabel || "m",
        optional: false,
        sourceCatalogItemId: rail.id,
        sourceCategory: "mounting",
      })
    );
  }

  const hooks = items.find(
    (i) => i.category === "mounting" && safeString(i.name).toLowerCase().includes("dachhaken")
  );
  if (hooks && moduleCount > 0) {
    defaults.push(
      makeLineItem({
        id: "auto-mounting-hooks",
        kategorie: "Montage",
        marke: hooks.brand,
        beschreibung: hooks.name || "Dachhaken",
        einzelpreis: safeNumber(hooks.priceNet, 0),
        stk: estimateRoofHooks(moduleCount),
        einheit: hooks.unitLabel || "Stk.",
        optional: false,
        sourceCatalogItemId: hooks.id,
        sourceCategory: "mounting",
      })
    );
  }

  /* ------------------------------- services ------------------------------- */
  const montage = items.find(
    (i) => i.category === "service" && safeString(i.name).toLowerCase().includes("montage")
  );
  if (montage) {
    defaults.push(
      makeLineItem({
        id: "auto-service-montage",
        kategorie: "Service",
        marke: montage.brand,
        beschreibung: montage.name || "Montage pauschal",
        einzelpreis: safeNumber(montage.priceNet, 0),
        stk: 1,
        einheit: montage.unitLabel || "Pauschal",
        optional: false,
        sourceCatalogItemId: montage.id,
        sourceCategory: "service",
      })
    );
  }

  const commissioning = items.find(
    (i) => i.category === "service" && safeString(i.name).toLowerCase().includes("inbetriebnahme")
  );
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

  /* -------------------------------- extras -------------------------------- */
  const netz = items.find(
    (i) => i.category === "extra" && safeString(i.name).toLowerCase().includes("netzanschluss")
  );
  if (netz) {
    defaults.push(
      makeLineItem({
        id: "auto-extra-netzanschluss",
        kategorie: "Extra",
        marke: netz.brand,
        beschreibung: netz.name || "Netzanschluss",
        einzelpreis: safeNumber(netz.priceNet, 0),
        stk: 1,
        einheit: netz.unitLabel || "Pauschal",
        optional: false,
        sourceCatalogItemId: netz.id,
        sourceCategory: "extra",
      })
    );
  }

  /* ------------------------------- battery -------------------------------- */
  if (ist?.hasBattery) {
    const battery = items.find((i) => i.category === "battery" && i.isActive);
    if (battery) {
      defaults.push(
        makeLineItem({
          id: "auto-battery",
          kategorie: "Batterie",
          marke: battery.brand,
          beschreibung: battery.name || battery.model || "Batteriespeicher",
          einzelpreis: safeNumber(battery.priceNet, 0),
          stk: 1,
          einheit: battery.unitLabel || "Set",
          optional: false,
          sourceCatalogItemId: battery.id,
          sourceCategory: "battery",
        })
      );
    }
  }

  /* ------------------------------- wallbox -------------------------------- */
  if (ist?.hasEV) {
    const wallbox = items.find((i) => i.category === "wallbox" && i.isActive);
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