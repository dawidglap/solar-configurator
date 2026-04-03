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

function averageRoofTiltDeg(layers: any[]) {
  if (!Array.isArray(layers) || layers.length === 0) return 20;

  const tilts = layers
    .map((l) => safeNumber(l?.tiltDeg, NaN))
    .filter((n) => Number.isFinite(n));

  if (!tilts.length) return 20;

  const avg = tilts.reduce((a, b) => a + b, 0) / tilts.length;
  return avg;
}

function inferYieldPerKwpFromRoofs(layers: any[]) {
  // MVP serio:
  // - se abbiamo azimut e tilt, usiamo una stima prudente
  // - default Svizzera: 950 kWh/kWp
  // - Sud / tilt medio buono => valore più alto
  // Non è il modello finale, ma è centralizzato e migliorabile.

  if (!Array.isArray(layers) || layers.length === 0) {
    return 950;
  }

  const values = layers.map((roof) => {
    const azimuth = safeNumber(roof?.azimuthDeg, 0);
    const tilt = safeNumber(roof?.tiltDeg, 20);

    // normalizza azimuth in [-180, 180]
    const az = ((((azimuth + 180) % 360) + 360) % 360) - 180;
    const absAz = Math.abs(az);

    let base = 950;

    // orientamento molto favorevole
    if (absAz <= 30) base = 1120;
    else if (absAz <= 60) base = 1060;
    else if (absAz <= 100) base = 980;
    else if (absAz <= 140) base = 860;
    else base = 720;

    // tilt adjustment leggero
    if (tilt >= 15 && tilt <= 35) base += 40;
    else if (tilt >= 5 && tilt < 15) base += 10;
    else if (tilt > 35 && tilt <= 50) base -= 20;
    else if (tilt > 50) base -= 60;

    return clamp(base, 650, 1200);
  });

  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.round(avg);
}

function estimateSelfConsumptionPct(args: {
  yearlyConsumptionKwh: number;
  annualProductionKwh: number;
  hasBattery: boolean;
  hasEv: boolean;
  hasHeatPump: boolean;
}) {
  const { yearlyConsumptionKwh, annualProductionKwh, hasBattery, hasEv, hasHeatPump } =
    args;

  if (annualProductionKwh <= 0 || yearlyConsumptionKwh <= 0) {
    return 0;
  }

  // Base molto prudente
  let pct = 0.32;

  const ratio = yearlyConsumptionKwh / annualProductionKwh;

  // se il cliente consuma molto rispetto alla produzione, autoconsumo sale
  if (ratio >= 1.2) pct += 0.08;
  else if (ratio >= 0.9) pct += 0.05;
  else if (ratio >= 0.7) pct += 0.02;
  else if (ratio < 0.45) pct -= 0.04;

  if (hasBattery) pct += 0.18;
  if (hasEv) pct += 0.05;
  if (hasHeatPump) pct += 0.06;

  return clamp(pct, 0.15, 0.85);
}

function getPartsTotalsFromPlanning(doc: any) {
  const partsItems =
    doc?.data?.parts?.items ??
    doc?.data?.planner?.parts?.items ??
    doc?.data?.planner?.parts ??
    [];

  if (!Array.isArray(partsItems)) {
    return {
      partsTotalChf: 0,
      items: [],
    };
  }

  const normalizedItems = partsItems.map((item: any) => {
    const qty = safeNumber(item?.quantity ?? item?.qty, 0);
    const unitPrice = safeNumber(
      item?.unitPriceChf ?? item?.unitPrice ?? item?.priceChf ?? item?.price,
      0
    );
    const total = safeNumber(item?.totalChf, qty * unitPrice);

    return {
      ...item,
      quantity: qty,
      unitPriceChf: unitPrice,
      totalChf: total,
    };
  });

  const partsTotalChf = normalizedItems.reduce(
    (sum: number, item: any) => sum + safeNumber(item?.totalChf, 0),
    0
  );

  return {
    partsTotalChf,
    items: normalizedItems,
  };
}

function buildReportSummary(doc: any) {
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

  const moduleCount = panels.length;
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
  const moduleUnitPriceChf = safeNumber(selectedPanel?.priceChf, 0);

  const dcPowerKw =
    moduleCount > 0 && selectedPanelWp > 0
      ? Number(((moduleCount * selectedPanelWp) / 1000).toFixed(2))
      : 0;

  const moduleAreaM2 =
    moduleCount > 0 && selectedPanelWidthM > 0 && selectedPanelHeightM > 0
      ? Number((moduleCount * selectedPanelWidthM * selectedPanelHeightM).toFixed(2))
      : 0;

  const roofCount = layers.length;
  const avgRoofTiltDeg = Number(averageRoofTiltDeg(layers).toFixed(1));

  const yearlyConsumptionKwh = safeNumber(ist?.electricityUsageKwh, 0);

  const yearlyYieldKwhPerKwp = inferYieldPerKwpFromRoofs(layers);

  const annualProductionKwh =
    dcPowerKw > 0 ? Math.round(dcPowerKw * yearlyYieldKwhPerKwp) : 0;

  const hasBattery = !!ist?.hasBattery;
  const hasEv = !!ist?.hasEV;
  const hasHeatPump = !!ist?.hasHeatPump;

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
      ? Number(((selfUseKwh / annualProductionKwh) * 100).toFixed(1))
      : 0;

  const autarkyPct =
    yearlyConsumptionKwh > 0
      ? Number(((selfUseKwh / yearlyConsumptionKwh) * 100).toFixed(1))
      : 0;

  const modulesTotalChf = Number((moduleCount * moduleUnitPriceChf).toFixed(2));

  const { partsTotalChf } = getPartsTotalsFromPlanning(doc);

  const totalInvestmentChf = Number((modulesTotalChf + partsTotalChf).toFixed(2));

  // Default MVP - configurabili poi per azienda
  const tariffConsumptionChfPerKwh = 0.277;
  const tariffFeedInChfPerKwh = 0.10;

  const annualSavingsChf = Number((selfUseKwh * tariffConsumptionChfPerKwh).toFixed(2));
  const annualFeedInRevenueChf = Number((feedInKwh * tariffFeedInChfPerKwh).toFixed(2));
  const annualBenefitChf = Number((annualSavingsChf + annualFeedInRevenueChf).toFixed(2));

  const breakEvenYears =
    totalInvestmentChf > 0 && annualBenefitChf > 0
      ? Number((totalInvestmentChf / annualBenefitChf).toFixed(1))
      : null;

  const roiPct =
    totalInvestmentChf > 0 && annualBenefitChf > 0
      ? Number(((annualBenefitChf / totalInvestmentChf) * 100).toFixed(1))
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
    avgRoofTiltDeg,

    yearlyConsumptionKwh,
    yearlyYieldKwhPerKwp,
    annualProductionKwh,

    selfUseKwh,
    feedInKwh,
    selfUseSharePct,
    autarkyPct,
    selfConsumptionPctEstimated: Number((selfConsumptionPctEstimated * 100).toFixed(1)),

    moduleUnitPriceChf,
    modulesTotalChf,
    partsTotalChf,
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

    const doc = await plannings.findOne({
      _id: planningObjectId,
      companyId: session.activeCompanyId,
    });

    if (!doc) {
      return jsonResponse(origin, { ok: false, error: "Planning not found" }, 404);
    }

    const reportSummary = buildReportSummary(doc);

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