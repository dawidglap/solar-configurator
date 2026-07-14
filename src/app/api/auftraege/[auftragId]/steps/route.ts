import { getDb } from "@/lib/db";
import { getCorsHeaders } from "@/lib/cors";
import { jsonResponse, readSession, safeString, toObjectIdOrNull } from "@/lib/api-session";
import { enforceActiveSubscription } from "@/lib/subscription";
import {
  ensureAuftragIndexes,
  getHydratedAuftragState,
  getSessionActor,
} from "@/lib/auftragPipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(origin),
  });
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ auftragId: string }> },
) {
  const origin = req.headers.get("origin");
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    return jsonResponse(origin, { ok: false, message: "Missing SESSION_SECRET" }, 500);
  }

  const session = readSession(req, secret);
  if (!session?.activeCompanyId) {
    return jsonResponse(origin, { ok: false, message: "Not logged in" }, 401);
  }

  const companyObjectId = toObjectIdOrNull(session.activeCompanyId);
  const { auftragId } = await params;
  const orderId = safeString(auftragId);
  if (!companyObjectId || !orderId) {
    return jsonResponse(origin, { ok: false, message: "Ungültige Auftragsnummer." }, 400);
  }

  try {
    const db = await getDb();
    const subscriptionError = await enforceActiveSubscription(db, origin, session);
    if (subscriptionError) return subscriptionError;
    await ensureAuftragIndexes(db);

    const hydrated = await getHydratedAuftragState({
      db,
      companyId: companyObjectId,
      orderId,
      actor: getSessionActor(session),
    });
    if (!hydrated) {
      return jsonResponse(origin, { ok: false, message: "Auftrag nicht gefunden." }, 404);
    }

    return jsonResponse(
      origin,
      {
        ok: true,
        auftragId: hydrated.normalizedAuftrag.id,
        orderId: hydrated.normalizedAuftrag.orderId,
        currentStepKey: hydrated.normalizedAuftrag.currentStepKey,
        stepsState: hydrated.stepsState,
        status: hydrated.normalizedAuftrag.status,
      },
      200,
    );
  } catch (error: any) {
    console.error("GET AUFTRAG STEPS ERROR:", error);
    return jsonResponse(origin, { ok: false, message: error?.message || "Unknown error" }, 500);
  }
}
