import { MongoClient, ObjectId } from "mongodb";
import crypto from "crypto";
import { getCorsHeaders } from "@/lib/cors";

export const runtime = "nodejs";

/* ---------------- Session helpers ---------------- */

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

/* ---------------- Helpers ---------------- */

function safeString(v: unknown) {
  return typeof v === "string" ? v.trim() : "";
}

function toObjectIdOrNull(v: unknown) {
  try {
    if (!v) return null;
    return new ObjectId(String(v));
  } catch {
    return null;
  }
}

function buildPlanningNumber() {
  const now = new Date();
  const y = now.getFullYear();
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `ANG-${y}-${rand}`;
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

function makeVariantTitle(originalTitle: string, variantNumber: number) {
  const base = safeString(originalTitle) || "Photovoltaik-Angebot";
  return `${base} — Variante ${variantNumber}`;
}

/* ---------------- OPTIONS ---------------- */

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(origin),
  });
}

/* ---------------- POST duplicate ---------------- */

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

  const sourceObjectId = toObjectIdOrNull(planningId);
  if (!sourceObjectId) {
    return jsonResponse(origin, { ok: false, error: "Invalid planningId" }, 400);
  }

  const body = await req.json().catch(() => ({} as any));

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });

  try {
    await client.connect();
    const db = client.db();
    const plannings = db.collection("plannings");

    const source = await plannings.findOne({
      _id: sourceObjectId,
      companyId: session.activeCompanyId,
    });

    if (!source) {
      return jsonResponse(origin, { ok: false, error: "Planning not found" }, 404);
    }

    const variantsCount = await plannings.countDocuments({
      companyId: session.activeCompanyId,
      $or: [
        { variantOfPlanningId: String(source._id) },
        { variantOfPlanningId: source._id },
      ],
    });

    const variantNumber = variantsCount + 2;
    const now = new Date();

    const newPlanningNumber =
      safeString(body?.planningNumber) || buildPlanningNumber();

    const newTitle =
      safeString(body?.title) ||
      makeVariantTitle(safeString((source as any).title), variantNumber);

    const duplicated = {
      ...source,

      _id: new ObjectId(),

      title: newTitle,
      planningNumber: newPlanningNumber,

      status: "draft",
      currentStep: safeString((source as any).currentStep) || "profile",

      variantOfPlanningId: String((source as any)._id),
      variantNumber,

      createdAt: now,
      updatedAt: now,
      createdByUserId: session.userId || (source as any).createdByUserId || null,

      commercial: {
        ...((source as any).commercial ?? {}),
        stage: safeString(body?.commercial?.stage) || "lead",
        valueChf:
          typeof (source as any)?.commercial?.valueChf === "number"
            ? (source as any).commercial.valueChf
            : 0,
      },
    };

    const res = await plannings.insertOne(duplicated);

    return jsonResponse(origin, {
      ok: true,
      planningId: String(res.insertedId),
      planning: {
        id: String(res.insertedId),
        title: duplicated.title,
        planningNumber: duplicated.planningNumber,
        variantOfPlanningId: duplicated.variantOfPlanningId,
        variantNumber: duplicated.variantNumber,
      },
    });
  } catch (e: any) {
    console.error("DUPLICATE PLANNING ERROR:", e);
    return jsonResponse(
      origin,
      { ok: false, error: e?.message || "Unknown error" },
      500
    );
  } finally {
    await client.close().catch(() => {});
  }
}