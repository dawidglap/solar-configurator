import { getDb } from "@/lib/db";
import { getCorsHeaders } from "@/lib/cors";
import { jsonResponse, readSession, safeString, toObjectIdOrNull } from "@/lib/api-session";
import { enforceActiveSubscription } from "@/lib/subscription";
import { ensureAuftragIndexes, getAuftraegeCollection, normalizeAuftrag } from "@/lib/auftragPipeline";

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
  const auftragObjectId = toObjectIdOrNull(auftragId);
  if (!companyObjectId || !auftragObjectId) {
    return jsonResponse(origin, { ok: false, message: "Ungültige Anfrage." }, 400);
  }

  try {
    const db = await getDb();
    const subscriptionError = await enforceActiveSubscription(db, origin, session);
    if (subscriptionError) return subscriptionError;
    await ensureAuftragIndexes(db);

    const auftrag = await getAuftraegeCollection(db).findOne({
      _id: auftragObjectId,
      companyId: companyObjectId,
    });
    if (!auftrag) {
      return jsonResponse(origin, { ok: false, message: "Auftrag nicht gefunden." }, 404);
    }

    const normalized = normalizeAuftrag(auftrag);
    return jsonResponse(
      origin,
      {
        ok: true,
        auftragId: normalized.id,
        currentStepKey: normalized.currentStepKey,
        stepsState: normalized.stepsState,
        status: normalized.status,
      },
      200,
    );
  } catch (error: any) {
    console.error("GET AUFTRAG STEPS ERROR:", error);
    return jsonResponse(origin, { ok: false, message: error?.message || "Unknown error" }, 500);
  }
}
