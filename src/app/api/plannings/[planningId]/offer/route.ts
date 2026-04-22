import { MongoClient, ObjectId } from "mongodb";
import crypto from "crypto";
import { PDFDocument } from "pdf-lib";
import { getCorsHeaders } from "@/lib/cors";
import { addCoverPage } from "./pdf/cover-page";

export const runtime = "nodejs";

/* ---------------- CORS OPTIONS ---------------- */

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(origin),
  });
}

/* ---------------- Session ---------------- */

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

function safeString(v: unknown) {
  return typeof v === "string" ? v.trim() : "";
}

function safeNumber(v: unknown, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function formatDateCH(date: Date) {
  return new Intl.DateTimeFormat("de-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function makeJsonResponse(origin: string | null, body: any, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...getCorsHeaders(origin),
    },
  });
}

/* ---------------- Route ---------------- */

export async function POST(
  req: Request,
  { params }: { params: Promise<{ planningId: string }> }
) {
  const origin = req.headers.get("origin");
  const { planningId } = await params;

  const uri = process.env.MONGODB_URI;
  const secret = process.env.SESSION_SECRET;

  if (!uri) {
    return makeJsonResponse(origin, { ok: false, error: "Missing MONGODB_URI" }, 500);
  }

  if (!secret) {
    return makeJsonResponse(origin, { ok: false, error: "Missing SESSION_SECRET" }, 500);
  }

  const session = readSession(req, secret);
  if (!session?.activeCompanyId) {
    return makeJsonResponse(origin, { ok: false, error: "Not logged in" }, 401);
  }

  let planningObjectId: ObjectId;
  let companyObjectId: ObjectId;

  try {
    planningObjectId = new ObjectId(planningId);
    companyObjectId = new ObjectId(String(session.activeCompanyId));
  } catch {
    return makeJsonResponse(origin, { ok: false, error: "Invalid id" }, 400);
  }

  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db();

    const plannings = db.collection("plannings");
    const companies = db.collection("companies");

    const planning = await plannings.findOne({
      _id: planningObjectId,
      companyId: session.activeCompanyId,
    });

    if (!planning) {
      return makeJsonResponse(origin, { ok: false, error: "Planning not found" }, 404);
    }

    const company = await companies.findOne({
      _id: companyObjectId,
    });

    const companyName = safeString(company?.name) || "Ihre Firma";

    const data = (planning as any)?.data ?? {};
    const profile = data?.profile ?? {};
    const parts = data?.parts ?? {};
    const reportOptions = data?.reportOptions ?? {};
    const summary = (planning as any)?.summary ?? {};
    const reportSummary = (planning as any)?.reportSummary ?? data?.reportSummary ?? null;

    const items = Array.isArray(parts?.items) ? parts.items : [];

    const partsTotalNet = items.reduce((sum: number, item: any) => {
      const lineTotal = safeNumber(item?.lineTotalNet ?? item?.lineTotal, 0);
      return sum + lineTotal;
    }, 0);

    const vatRatePct = 8.1;
    const vatAmountChf = Number((partsTotalNet * (vatRatePct / 100)).toFixed(2));
    const grossPriceChf = Number((partsTotalNet + vatAmountChf).toFixed(2));

    const dcPowerKw = safeNumber(summary?.dcPowerKw, 0);

    const automaticPvSubsidyChf = safeNumber(
      reportSummary?.automaticPvSubsidyChf,
      dcPowerKw <= 0 ? 0 : dcPowerKw <= 30 ? dcPowerKw * 360 : dcPowerKw * 300
    );

    const manualAdditionalSubsidyChf = safeNumber(
      reportSummary?.manualAdditionalSubsidyChf ??
        reportOptions?.additionalSubsidyChf,
      0
    );

    const subsidyChf = Number(
      (automaticPvSubsidyChf + manualAdditionalSubsidyChf).toFixed(2)
    );

    const totalInvestmentChf = Number(
      Math.max(0, grossPriceChf - subsidyChf).toFixed(2)
    );

    const taxSavingsChf = 0;
    const effectiveCostChf = Number(
      Math.max(0, totalInvestmentChf - taxSavingsChf).toFixed(2)
    );

    const today = new Date();
    const validUntilDate = new Date(today);
    validUntilDate.setDate(validUntilDate.getDate() + 30);

    const todayFormatted = formatDateCH(today);
    const validUntilFormatted = formatDateCH(validUntilDate);

    const customerName =
      [safeString(profile?.firstName), safeString(profile?.lastName)]
        .filter(Boolean)
        .join(" ") ||
      safeString(profile?.companyName) ||
      "—";

    const batteryItem = items.find((item: any) => {
      const category = safeString(item?.category ?? item?.kategorie).toLowerCase();
      return category === "batterie" || category === "battery" || category === "speicher";
    });

    const wallboxItem = items.find((item: any) => {
      const category = safeString(item?.category ?? item?.kategorie).toLowerCase();
      return category === "ladestation" || category === "wallbox";
    });

    const offer = {
      title: safeString((planning as any)?.title) || "Photovoltaik-Angebot",
      planningNumber: safeString((planning as any)?.planningNumber) || "—",
      pv: {
        dcPowerKw,
        moduleCount: safeNumber(summary?.moduleCount, 0),
      },
      customer: {
        name: customerName,
      },
      companyName,
      pricing: {
        netSystemPriceChf: partsTotalNet,
        vatRatePct,
        vatAmountChf,
        grossPriceChf,
        automaticPvSubsidyChf,
        manualAdditionalSubsidyChf,
        subsidyChf,
        totalInvestmentChf,
        taxSavingsChf,
        effectiveCostChf,
      },
      options: {
        batteryLabel: batteryItem
          ? [
              safeString(batteryItem?.brand ?? batteryItem?.marke),
              safeString(batteryItem?.name ?? batteryItem?.beschreibung),
            ]
              .filter(Boolean)
              .join(" ")
          : "",
        wallboxLabel: wallboxItem
          ? [
              safeString(wallboxItem?.brand ?? wallboxItem?.marke),
              safeString(wallboxItem?.name ?? wallboxItem?.beschreibung),
            ]
              .filter(Boolean)
              .join(" ")
          : "",
      },
    };

    const pdf = await PDFDocument.create();

    await addCoverPage(pdf, {
      title: offer.title,
      planningNumber: offer.planningNumber,
      kWp: offer.pv.dcPowerKw,
      customerName: offer.customer.name,
      companyName: offer.companyName,

      netSystemPriceChf: offer.pricing.netSystemPriceChf,
      vatRatePct: offer.pricing.vatRatePct,
      vatAmountChf: offer.pricing.vatAmountChf,
      grossPriceChf: offer.pricing.grossPriceChf,

      automaticPvSubsidyChf: offer.pricing.automaticPvSubsidyChf,
      manualAdditionalSubsidyChf: offer.pricing.manualAdditionalSubsidyChf,
      subsidyChf: offer.pricing.subsidyChf,

      totalInvestmentChf: offer.pricing.totalInvestmentChf,
      taxSavingsChf: offer.pricing.taxSavingsChf,
      effectiveCostChf: offer.pricing.effectiveCostChf,

      offerDate: todayFormatted,
      validUntil: validUntilFormatted,

      moduleCount: offer.pv.moduleCount,
      batteryLabel: offer.options.batteryLabel,
      wallboxLabel: offer.options.wallboxLabel,
    });

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
    console.error("OFFER ERROR:", e);

    return makeJsonResponse(
      origin,
      { ok: false, error: e?.message || "Unknown error" },
      500
    );
  } finally {
    await client.close().catch(() => {});
  }
}