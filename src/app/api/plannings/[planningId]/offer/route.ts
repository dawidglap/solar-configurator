// src/app/api/plannings/[planningId]/offer/route.ts
import { MongoClient, ObjectId } from "mongodb";
import crypto from "crypto";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getCorsHeaders } from "@/lib/cors";
import { addVollmachtPage } from "./pdf/vollmacht";

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

function safeString(v: unknown) {
  return typeof v === "string" ? v.trim() : "";
}

function safeNumber(v: unknown, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function toObjectIdOrNull(v: unknown) {
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

function fmtMoney(n: number) {
  return `CHF ${new Intl.NumberFormat("de-CH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)}`;
}

function fmtInt(n: number) {
  return new Intl.NumberFormat("de-CH", {
    maximumFractionDigits: 0,
  }).format(n);
}

function fmt1(n: number) {
  return new Intl.NumberFormat("de-CH", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(n);
}

function joinAddress(street?: string, no?: string, zip?: string, city?: string) {
  const line1 = [safeString(street), safeString(no)].filter(Boolean).join(" ");
  const line2 = [safeString(zip), safeString(city)].filter(Boolean).join(" ");
  return [line1, line2].filter(Boolean).join(", ");
}

function drawText(page: any, text: string, x: number, y: number, size: number, font: any, color = rgb(0.12, 0.12, 0.12)) {
  page.drawText(text, { x, y, size, font, color });
}

function drawLine(page: any, x1: number, y1: number, x2: number, y2: number, thickness = 1, color = rgb(0.88, 0.88, 0.9)) {
  page.drawLine({
    start: { x: x1, y: y1 },
    end: { x: x2, y: y2 },
    thickness,
    color,
  });
}

function drawLabelValue(page: any, x: number, y: number, label: string, value: string, font: any, bold: any) {
  drawText(page, label, x, y, 10, font, rgb(0.42, 0.42, 0.46));
  drawText(page, value || "—", x + 190, y, 10, bold, rgb(0.12, 0.12, 0.12));
}

function pickCustomerName(profile: any) {
  const fullName = [
    safeString(profile?.salutation),
    safeString(profile?.firstName),
    safeString(profile?.lastName),
  ]
    .filter(Boolean)
    .join(" ")
    .trim();

  if (fullName) return fullName;
  return safeString(profile?.companyName) || "—";
}

function normalizePartItems(rawItems: any[]) {
  if (!Array.isArray(rawItems)) return [];

  return rawItems.map((item) => {
    const quantity = safeNumber(item?.quantity ?? item?.stk, 0);
    const unitPriceNet = safeNumber(item?.unitPriceNet ?? item?.einzelpreis, 0);
    const lineTotalNet = safeNumber(
      item?.lineTotalNet,
      Number((quantity * unitPriceNet).toFixed(2))
    );

    return {
      id: safeString(item?.id),
      category: safeString(item?.category ?? item?.kategorie),
      brand: safeString(item?.brand ?? item?.marke),
      name: safeString(item?.name ?? item?.beschreibung),
      quantity,
      unit: safeString(item?.unit ?? item?.einheit ?? item?.unitLabel) || "Stk.",
      unitPriceNet,
      lineTotalNet,
    };
  });
}

function getOfferData(planning: any) {
  const data = planning?.data ?? {};
  const profile = data?.profile ?? {};
  const ist = data?.ist ?? {};
  const planner = data?.planner ?? {};
  const parts = data?.parts ?? {};
  const reportOptions = data?.reportOptions ?? {};
  const summary = planning?.summary ?? {};

  const partItems = normalizePartItems(parts?.items ?? []);
  const formDocuments = {
    vollmacht: parts?.formDocuments?.vollmacht !== false,
    bestellformular: parts?.formDocuments?.bestellformular !== false,
    agbs: parts?.formDocuments?.agbs !== false,
  };

  const panelCatalog = Array.isArray(planner?.catalogPanels) ? planner.catalogPanels : [];
  const selectedPanelId =
    safeString(summary?.selectedPanelId) ||
    safeString(planner?.selectedPanelId);

  const selectedPanel =
    panelCatalog.find((p: any) => safeString(p?.id) === selectedPanelId) ?? null;

  const moduleCount = safeNumber(summary?.moduleCount, 0);
  const dcPowerKw = safeNumber(summary?.dcPowerKw, 0);

  const moduleItem = partItems.find((i) => i.category.toLowerCase() === "module");
  const batteryItem = partItems.find((i) => i.category.toLowerCase() === "batterie");
  const wallboxItem = partItems.find((i) => i.category.toLowerCase() === "ladestation");

  const totalNet = partItems.reduce((sum, item) => sum + safeNumber(item.lineTotalNet, 0), 0);

  return {
    planningNumber: safeString(planning?.planningNumber) || "—",
    title: safeString(planning?.title) || "Angebot",
    customer: {
      name: pickCustomerName(profile),
      email: safeString(profile?.email),
      phone: safeString(profile?.phone || profile?.mobile),
      address: joinAddress(profile?.street, "", profile?.zip, profile?.city) || "—",
    },
    project: {
      buildingType: safeString(ist?.buildingType) || "—",
      roofType: safeString(ist?.roofType) || "—",
      roofCovering: safeString(ist?.roofCovering) || "—",
      yearlyConsumptionKwh: safeNumber(ist?.electricityUsageKwh, 0),
      preferredTiming: safeString(ist?.preferredTiming) || "—",
    },
    pv: {
      moduleCount,
      dcPowerKw,
      panelBrand: safeString(selectedPanel?.brand),
      panelModel: safeString(selectedPanel?.model),
      panelWp: safeNumber(selectedPanel?.wp, 0),
      modulePriceNet: safeNumber(moduleItem?.unitPriceNet, 0),
    },
    options: {
      includeBattery: !!reportOptions?.battery || !!reportOptions?.includeBattery,
      includeWallbox: !!reportOptions?.charging || !!reportOptions?.includeWallbox,
      batteryName: batteryItem?.name || "",
      wallboxName: wallboxItem?.name || "",
    },
    parts: partItems,
    totals: {
      totalNet: Number(totalNet.toFixed(2)),
    },
    formDocuments,
  };
}

function drawPartsTable(page: any, items: ReturnType<typeof normalizePartItems>, startY: number, font: any, bold: any) {
  const left = 48;
  const right = 547;

  let y = startY;

  drawText(page, "Position", left, y, 10, bold);
  drawText(page, "Menge", 320, y, 10, bold);
  drawText(page, "EP", 390, y, 10, bold);
  drawText(page, "Total", 470, y, 10, bold);
  y -= 8;

  drawLine(page, left, y, right, y, 1, rgb(0.8, 0.82, 0.86));
  y -= 14;

  for (const item of items) {
    if (y < 90) break;

    const title = [item.brand, item.name].filter(Boolean).join(" ").trim() || "Position";

    drawText(page, title.slice(0, 42), left, y, 9.5, font);
    drawText(page, `${fmtInt(item.quantity)} ${item.unit}`.trim(), 320, y, 9.5, font);
    drawText(page, fmtMoney(item.unitPriceNet), 390, y, 9.5, font);
    drawText(page, fmtMoney(item.lineTotalNet), 470, y, 9.5, bold);

    y -= 15;
  }

  return y;
}

/* --------------------------------- Route -------------------------------- */

export async function POST(
  req: Request,
  { params }: { params: Promise<{ planningId: string }> }
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

    const planning = await plannings.findOne({
      _id: planningObjectId,
      companyId: session.activeCompanyId,
    });

    if (!planning) {
      return jsonResponse(origin, { ok: false, error: "Planning not found" }, 404);
    }

    const offer = getOfferData(planning);

    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595.28, 841.89]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

    const left = 48;
    const right = 547;
    let y = 800;

    /* ---------------- Header ---------------- */

    drawText(page, "Photovoltaik-Angebot", left, y, 22, bold);
    y -= 22;

    drawText(
      page,
      `${offer.title} • ${offer.planningNumber}`,
      left,
      y,
      10,
      font,
      rgb(0.4, 0.42, 0.46)
    );
    y -= 26;

    drawLine(page, left, y, right, y);
    y -= 22;

    /* ---------------- Customer ---------------- */

    drawText(page, "Kundendaten", left, y, 13, bold);
    y -= 18;

    drawLabelValue(page, left, y, "Name", offer.customer.name, font, bold); y -= 14;
    drawLabelValue(page, left, y, "E-Mail", offer.customer.email || "—", font, bold); y -= 14;
    drawLabelValue(page, left, y, "Telefon", offer.customer.phone || "—", font, bold); y -= 14;
    drawLabelValue(page, left, y, "Adresse", offer.customer.address || "—", font, bold); y -= 22;

    drawLine(page, left, y, right, y);
    y -= 22;

    /* ---------------- Project ---------------- */

    drawText(page, "Projekt", left, y, 13, bold);
    y -= 18;

    drawLabelValue(page, left, y, "Gebäudetyp", offer.project.buildingType, font, bold); y -= 14;
    drawLabelValue(page, left, y, "Dachtyp", offer.project.roofType, font, bold); y -= 14;
    drawLabelValue(page, left, y, "Dacheindeckung", offer.project.roofCovering, font, bold); y -= 14;
    drawLabelValue(page, left, y, "Stromverbrauch / Jahr", offer.project.yearlyConsumptionKwh > 0 ? `${fmtInt(offer.project.yearlyConsumptionKwh)} kWh` : "—", font, bold); y -= 14;
    drawLabelValue(page, left, y, "Umsetzung", offer.project.preferredTiming, font, bold); y -= 22;

    drawLine(page, left, y, right, y);
    y -= 22;

    /* ---------------- System summary ---------------- */

    drawText(page, "Anlage", left, y, 13, bold);
    y -= 18;

    drawLabelValue(page, left, y, "Anzahl Module", offer.pv.moduleCount > 0 ? fmtInt(offer.pv.moduleCount) : "—", font, bold); y -= 14;
    drawLabelValue(page, left, y, "Anlagenleistung", offer.pv.dcPowerKw > 0 ? `${fmt1(offer.pv.dcPowerKw)} kWp` : "—", font, bold); y -= 14;
    drawLabelValue(page, left, y, "Modul", [offer.pv.panelBrand, offer.pv.panelModel].filter(Boolean).join(" ") || "—", font, bold); y -= 14;
    drawLabelValue(page, left, y, "Batterie", offer.options.includeBattery ? (offer.options.batteryName || "Ja") : "Nein", font, bold); y -= 14;
    drawLabelValue(page, left, y, "Ladestation", offer.options.includeWallbox ? (offer.options.wallboxName || "Ja") : "Nein", font, bold); y -= 22;

    drawLine(page, left, y, right, y);
    y -= 22;

    /* ---------------- Pricing table ---------------- */

    drawText(page, "Leistungsübersicht", left, y, 13, bold);
    y -= 20;

    y = drawPartsTable(page, offer.parts, y, font, bold);
    y -= 10;

    drawLine(page, left, y, right, y, 1, rgb(0.75, 0.77, 0.81));
    y -= 18;

    drawText(page, "Gesamtpreis netto", 360, y, 11, bold);
    drawText(page, fmtMoney(offer.totals.totalNet), 470, y, 11, bold);
    y -= 26;

    drawText(
      page,
      "Hinweis: Dieses Dokument ist die technische Angebotsbasis. Layout und Zusatzseiten werden im nächsten Schritt erweitert.",
      left,
      y,
      9,
      font,
      rgb(0.42, 0.42, 0.46)
    );

    /* ---------------- Optional attachment: Vollmacht ---------------- */

    if (offer.formDocuments.vollmacht) {
      await addVollmachtPage(pdf);
    }

    const pdfBytes = await pdf.save();

    return new Response(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="Angebot_${planningId}.pdf"`,
        "Cache-Control": "no-store",
        ...getCorsHeaders(origin),
      },
    });
  } catch (e: any) {
    console.error("OFFER PDF ERROR:", e);
    return jsonResponse(
      origin,
      { ok: false, error: e?.message ?? "Unknown error" },
      500
    );
  } finally {
    await client.close().catch(() => {});
  }
}