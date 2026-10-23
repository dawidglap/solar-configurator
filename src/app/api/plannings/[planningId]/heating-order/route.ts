import { ObjectId } from "mongodb";
import { readSession } from "@/lib/api-session";
import { getCorsHeaders } from "@/lib/cors";
import { getDb } from "@/lib/db";
import { readCanonicalHeatingOrder } from "@/lib/heatingOrderRead";
import { enforceActiveSubscription } from "@/lib/subscription";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Params = { params: Promise<{ planningId: string }> };

function responseHeaders(origin: string | null) {
  return {
    ...getCorsHeaders(origin),
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  };
}

function jsonResponse(origin: string | null, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...responseHeaders(origin) },
  });
}

export async function OPTIONS(req: Request) {
  return new Response(null, {
    status: 204,
    headers: responseHeaders(req.headers.get("origin")),
  });
}

export async function GET(req: Request, { params }: Params) {
  const origin = req.headers.get("origin");
  const secret = process.env.SESSION_SECRET;
  if (!secret) return jsonResponse(origin, { ok: false, message: "Missing SESSION_SECRET" }, 500);

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
    const subscriptionError = await enforceActiveSubscription(db, origin, session);
    if (subscriptionError) return subscriptionError;

    const result = await readCanonicalHeatingOrder({
      db,
      companyId: String(session.activeCompanyId),
      planningId,
    });
    if (result.kind === "not_found") {
      return jsonResponse(origin, { ok: false, message: "Planning not found" }, 404);
    }
    if (result.kind === "not_heating") {
      return jsonResponse(
        origin,
        { ok: false, message: "Heating order is only available for heating projects" },
        409,
      );
    }
    if (result.kind === "inconsistent") {
      return jsonResponse(origin, { ok: false, message: result.message }, 409);
    }
    return jsonResponse(origin, result.response);
  } catch (error: any) {
    console.error("GET HEATING ORDER ERROR:", error);
    return jsonResponse(origin, { ok: false, message: "Heating order could not be loaded" }, 500);
  }
}
