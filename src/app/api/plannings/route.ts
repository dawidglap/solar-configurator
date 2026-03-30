// src/app/api/plannings/route.ts
import { MongoClient, ObjectId } from "mongodb";
import crypto from "crypto";
import { defaultStoreData } from "@/components_v2/state/defaultStoreData";
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

/* ------------------------------- Helpers ------------------------------- */

function safeString(v: any) {
  return typeof v === "string" ? v.trim() : "";
}

function toObjectIdOrNull(v: any) {
  try {
    if (!v) return null;
    return new ObjectId(String(v));
  } catch {
    return null;
  }
}

function extractCustomerName(doc: any) {
  const fromSummary = safeString(doc?.summary?.customerName);
  if (fromSummary) return fromSummary;

  const businessName = safeString(doc?.data?.profile?.businessName);
  if (businessName) return businessName;

  const firstName = safeString(doc?.data?.profile?.contactFirstName);
  const lastName = safeString(doc?.data?.profile?.contactLastName);
  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();

  return fullName || "";
}

function extractSummaryFromPlanning(doc: any) {
  const existing = doc?.summary ?? {};

  const panels = Array.isArray(doc?.data?.panels) ? doc.data.panels : [];
  const layers = Array.isArray(doc?.data?.layers) ? doc.data.layers : [];
  const selectedPanelId =
    safeString(doc?.summary?.selectedPanelId) ||
    safeString(doc?.data?.selectedPanelId) ||
    "";

  const moduleCount =
    typeof existing.moduleCount === "number"
      ? existing.moduleCount
      : panels.length;

  const roofCount =
    typeof existing.roofCount === "number"
      ? existing.roofCount
      : layers.length;

  const hasSnapshot =
    typeof existing.hasSnapshot === "boolean"
      ? existing.hasSnapshot
      : !!doc?.data?.snapshotScale;

  const dcPowerKw =
    typeof existing.dcPowerKw === "number"
      ? existing.dcPowerKw
      : 0;

  return {
    customerName: safeString(existing.customerName) || extractCustomerName(doc),
    moduleCount,
    selectedPanelId,
    dcPowerKw,
    roofCount,
    hasSnapshot,
    lastCalculatedAt: existing.lastCalculatedAt ?? null,
  };
}

function buildPlanningNumber() {
  const now = new Date();
  const y = now.getFullYear();
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `ANG-${y}-${rand}`;
}

/* -------------------------------- OPTIONS -------------------------------- */

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(origin),
  });
}

/* --------------------------------- POST --------------------------------- */

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  const uri = process.env.MONGODB_URI;
  const secret = process.env.SESSION_SECRET;

  if (!uri) {
    return new Response(
      JSON.stringify({ ok: false, error: "Missing MONGODB_URI" }),
      { status: 500, headers: { "Content-Type": "application/json", ...getCorsHeaders(origin) } }
    );
  }

  if (!secret) {
    return new Response(
      JSON.stringify({ ok: false, error: "Missing SESSION_SECRET" }),
      { status: 500, headers: { "Content-Type": "application/json", ...getCorsHeaders(origin) } }
    );
  }

  const session = readSession(req, secret);
  if (!session) {
    return new Response(
      JSON.stringify({ ok: false, error: "Not logged in" }),
      { status: 401, headers: { "Content-Type": "application/json", ...getCorsHeaders(origin) } }
    );
  }

  const body = await req.json().catch(() => ({} as any));

  const customerId = safeString(body?.customerId) || null;
  const title = safeString(body?.title) || "Neues Projekt";
  const planningNumber = safeString(body?.planningNumber) || buildPlanningNumber();

  const commercialStage = safeString(body?.commercial?.stage) || "lead";
  const commercialValueChf =
    typeof body?.commercial?.valueChf === "number" ? body.commercial.valueChf : 0;
  const commercialAssignedToUserId =
    safeString(body?.commercial?.assignedToUserId) || session.userId;
  const commercialSource = safeString(body?.commercial?.source) || "";
  const commercialLabel = safeString(body?.commercial?.label) || "";

  const summaryCustomerName = safeString(body?.summary?.customerName) || "";

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });

  try {
    await client.connect();
    const db = client.db();
    const plannings = db.collection("plannings");
    const customers = db.collection("customers");

    let customerName = summaryCustomerName;

    if (customerId) {
      const customerObjectId = toObjectIdOrNull(customerId);

      if (!customerObjectId) {
        return new Response(
          JSON.stringify({ ok: false, error: "Invalid customerId" }),
          { status: 400, headers: { "Content-Type": "application/json", ...getCorsHeaders(origin) } }
        );
      }

      const customer = await customers.findOne(
        {
          _id: customerObjectId,
          companyId: session.activeCompanyId,
        },
        {
          projection: {
            name: 1,
            firstName: 1,
            lastName: 1,
            companyName: 1,
          },
        }
      );

      if (customer) {
        customerName =
          safeString((customer as any).name) ||
          safeString((customer as any).companyName) ||
          [safeString((customer as any).firstName), safeString((customer as any).lastName)]
            .filter(Boolean)
            .join(" ")
            .trim() ||
          customerName;
      }
    }

    const now = new Date();

    const doc = {
      companyId: session.activeCompanyId,
      customerId,
      createdByUserId: session.userId,

      status: "draft",
      currentStep: "profile",

      title,
      planningNumber,

      commercial: {
        stage: commercialStage,
        valueChf: commercialValueChf,
        assignedToUserId: commercialAssignedToUserId,
        source: commercialSource,
        label: commercialLabel,
      },

      summary: {
        customerName,
        moduleCount: 0,
        selectedPanelId: "",
        dcPowerKw: 0,
        roofCount: 0,
        hasSnapshot: false,
        lastCalculatedAt: null,
      },

      data: defaultStoreData(),

      createdAt: now,
      updatedAt: now,
    };

    const res = await plannings.insertOne(doc);

    return new Response(
      JSON.stringify({ ok: true, planningId: res.insertedId.toString() }),
      { status: 200, headers: { "Content-Type": "application/json", ...getCorsHeaders(origin) } }
    );
  } catch (e: any) {
    console.error("CREATE PLANNING ERROR:", e);
    return new Response(
      JSON.stringify({ ok: false, error: e?.message ?? "Unknown error" }),
      { status: 500, headers: { "Content-Type": "application/json", ...getCorsHeaders(origin) } }
    );
  } finally {
    await client.close().catch(() => {});
  }
}

/* ---------------------------------- GET ---------------------------------- */

export async function GET(req: Request) {
  const origin = req.headers.get("origin");
  const uri = process.env.MONGODB_URI;
  const secret = process.env.SESSION_SECRET;

  if (!uri) {
    return new Response(
      JSON.stringify({ ok: false, error: "Missing MONGODB_URI" }),
      { status: 500, headers: { "Content-Type": "application/json", ...getCorsHeaders(origin) } }
    );
  }

  if (!secret) {
    return new Response(
      JSON.stringify({ ok: false, error: "Missing SESSION_SECRET" }),
      { status: 500, headers: { "Content-Type": "application/json", ...getCorsHeaders(origin) } }
    );
  }

  const session = readSession(req, secret);
  if (!session) {
    return new Response(
      JSON.stringify({ ok: false, error: "Not logged in" }),
      { status: 401, headers: { "Content-Type": "application/json", ...getCorsHeaders(origin) } }
    );
  }

  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get("limit") ?? 200), 500);

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });

  try {
    await client.connect();
    const db = client.db();
    const plannings = db.collection("plannings");

    const filter: any = {
      companyId: session.activeCompanyId,
    };

    const customerId = safeString(searchParams.get("customerId"));
    if (customerId) {
      filter.customerId = customerId;
    }

    const stage = safeString(searchParams.get("stage"));
    if (stage) {
      filter["commercial.stage"] = stage;
    }

    const docs = await plannings
      .find(filter, {
        projection: {
          _id: 1,
          companyId: 1,
          customerId: 1,
          createdByUserId: 1,
          status: 1,
          currentStep: 1,
          title: 1,
          planningNumber: 1,
          commercial: 1,
          summary: 1,
          createdAt: 1,
          updatedAt: 1,
          "data.profile.contactFirstName": 1,
          "data.profile.contactLastName": 1,
          "data.profile.businessName": 1,
          "data.selectedPanelId": 1,
          "data.panels": 1,
          "data.layers": 1,
          "data.snapshotScale": 1,
        },
      })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .toArray();

    const items = docs.map((d: any) => {
      const summary = extractSummaryFromPlanning(d);
      const customerName = extractCustomerName(d);

      return {
        id: String(d._id),
        companyId: d.companyId ?? null,
        customerId: d.customerId ?? null,
        createdByUserId: d.createdByUserId ?? null,
        status: d.status ?? "draft",
        currentStep: d.currentStep ?? null,
        title: safeString(d.title) || "Unbenanntes Projekt",
        planningNumber: safeString(d.planningNumber) || "",
        commercial: {
          stage: safeString(d?.commercial?.stage) || "lead",
          valueChf:
            typeof d?.commercial?.valueChf === "number"
              ? d.commercial.valueChf
              : 0,
          assignedToUserId: d?.commercial?.assignedToUserId ?? null,
          source: safeString(d?.commercial?.source),
          label: safeString(d?.commercial?.label),
        },
        summary,
        customerName,
        createdAt: d.createdAt ?? null,
        updatedAt: d.updatedAt ?? null,
        firstName: safeString(d?.data?.profile?.contactFirstName),
        lastName: safeString(d?.data?.profile?.contactLastName),
        businessName: safeString(d?.data?.profile?.businessName),
      };
    });

    return new Response(
      JSON.stringify({ ok: true, items }),
      { status: 200, headers: { "Content-Type": "application/json", ...getCorsHeaders(origin) } }
    );
  } catch (e: any) {
    console.error("LIST PLANNINGS ERROR:", e);
    return new Response(
      JSON.stringify({ ok: false, error: e?.message ?? "Unknown error" }),
      { status: 500, headers: { "Content-Type": "application/json", ...getCorsHeaders(origin) } }
    );
  } finally {
    await client.close().catch(() => {});
  }
}