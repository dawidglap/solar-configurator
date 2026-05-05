import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db";
import { getCorsHeaders } from "@/lib/cors";
import { readSession, safeString } from "@/lib/api-session";
import { activeDocumentFilter } from "@/lib/trash";
import {
  buildPlanningComment,
  normalizePlanningComments,
} from "@/lib/plannings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function jsonResponse(origin: string | null, body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...getCorsHeaders(origin),
    },
  });
}

function noStoreHeaders(origin: string | null) {
  return {
    ...getCorsHeaders(origin),
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  };
}

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");
  return new Response(null, {
    status: 204,
    headers: noStoreHeaders(origin),
  });
}

type Params = { params: Promise<{ planningId: string }> };

export async function GET(req: Request, { params }: Params) {
  const origin = req.headers.get("origin");
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    return jsonResponse(origin, { ok: false, message: "Missing SESSION_SECRET" }, 500);
  }

  const session = readSession(req, secret);
  if (!session?.activeCompanyId) {
    return jsonResponse(origin, { ok: false, message: "Not logged in" }, 401);
  }

  const { planningId } = await params;
  if (!ObjectId.isValid(planningId)) {
    return jsonResponse(origin, { ok: false, message: "Invalid planningId" }, 400);
  }

  try {
    const db = await getDb();
    const planning = await db.collection("plannings").findOne({
      _id: new ObjectId(planningId),
      companyId: String(session.activeCompanyId),
      ...activeDocumentFilter(),
    });

    if (!planning) {
      return jsonResponse(origin, { ok: false, message: "Planning not found" }, 404);
    }

    const items = normalizePlanningComments((planning as any)?.comments).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );

    return jsonResponse(origin, { ok: true, items }, 200);
  } catch (e: any) {
    console.error("GET PLANNING COMMENTS ERROR:", e);
    return jsonResponse(origin, { ok: false, message: e?.message || "Unknown error" }, 500);
  }
}

export async function POST(req: Request, { params }: Params) {
  const origin = req.headers.get("origin");
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    return jsonResponse(origin, { ok: false, message: "Missing SESSION_SECRET" }, 500);
  }

  const session = readSession(req, secret);
  if (!session?.activeCompanyId) {
    return jsonResponse(origin, { ok: false, message: "Not logged in" }, 401);
  }

  const { planningId } = await params;
  if (!ObjectId.isValid(planningId)) {
    return jsonResponse(origin, { ok: false, message: "Invalid planningId" }, 400);
  }

  const body = await req.json().catch(() => ({} as any));
  const text = safeString(body?.text).slice(0, 4000);
  if (!text) {
    return jsonResponse(origin, { ok: false, message: "text is required" }, 400);
  }

  try {
    const db = await getDb();
    const comment = buildPlanningComment(text, session as any);
    const result = await db.collection("plannings").updateOne(
      {
        _id: new ObjectId(planningId),
        companyId: String(session.activeCompanyId),
        ...activeDocumentFilter(),
      },
      {
        $push: { comments: comment },
        $set: { updatedAt: new Date() },
      } as any,
    );

    if (!result.matchedCount) {
      return jsonResponse(origin, { ok: false, message: "Planning not found" }, 404);
    }

    return jsonResponse(origin, { ok: true, comment }, 200);
  } catch (e: any) {
    console.error("CREATE PLANNING COMMENT ERROR:", e);
    return jsonResponse(origin, { ok: false, message: e?.message || "Unknown error" }, 500);
  }
}
