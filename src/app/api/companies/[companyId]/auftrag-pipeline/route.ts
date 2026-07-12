import { getDb } from "@/lib/db";
import { getCorsHeaders } from "@/lib/cors";
import { jsonResponse, readSession, safeString, toObjectIdOrNull } from "@/lib/api-session";
import { enforceActiveSubscription } from "@/lib/subscription";
import {
  canManageAuftragPipelineTemplate,
  ensureCompanyAuftragPipelineTemplate,
  migrateOpenAuftraegeForTemplate,
  normalizeAuftragPipelineSteps,
  normalizeAuftragPipelineTemplate,
  validateAuftragPipelineSteps,
  getAuftragPipelineTemplatesCollection,
  getSessionActor,
} from "@/lib/auftragPipeline";
import { emitCompanyRealtimeEvent } from "@/lib/realtime";

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
  { params }: { params: Promise<{ companyId: string }> },
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

  const { companyId } = await params;
  if (safeString(companyId) !== safeString(session.activeCompanyId)) {
    return jsonResponse(origin, { ok: false, message: "Keine Berechtigung." }, 403);
  }

  const companyObjectId = toObjectIdOrNull(companyId);
  if (!companyObjectId) {
    return jsonResponse(origin, { ok: false, message: "Ungültige companyId." }, 400);
  }

  try {
    const db = await getDb();
    const subscriptionError = await enforceActiveSubscription(db, origin, session);
    if (subscriptionError) return subscriptionError;

    const template = await ensureCompanyAuftragPipelineTemplate(
      db,
      companyObjectId,
      getSessionActor(session),
    );
    const normalized = normalizeAuftragPipelineTemplate(template);

    return jsonResponse(origin, { ok: true, steps: normalized.steps }, 200);
  } catch (error: any) {
    console.error("GET AUFTRAG PIPELINE ERROR:", error);
    return jsonResponse(origin, { ok: false, message: error?.message || "Unknown error" }, 500);
  }
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ companyId: string }> },
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

  if (!canManageAuftragPipelineTemplate(session)) {
    return jsonResponse(origin, { ok: false, message: "Keine Berechtigung." }, 403);
  }

  const { companyId } = await params;
  if (safeString(companyId) !== safeString(session.activeCompanyId)) {
    return jsonResponse(origin, { ok: false, message: "Keine Berechtigung." }, 403);
  }

  const companyObjectId = toObjectIdOrNull(companyId);
  if (!companyObjectId) {
    return jsonResponse(origin, { ok: false, message: "Ungültige companyId." }, 400);
  }

  const body = await req.json().catch(() => null);
  const steps = normalizeAuftragPipelineSteps(body?.steps);
  const validationError = validateAuftragPipelineSteps(steps);
  if (validationError) {
    return jsonResponse(origin, { ok: false, message: validationError }, 400);
  }

  try {
    const db = await getDb();
    const subscriptionError = await enforceActiveSubscription(db, origin, session);
    if (subscriptionError) return subscriptionError;

    await ensureCompanyAuftragPipelineTemplate(db, companyObjectId, getSessionActor(session));
    await getAuftragPipelineTemplatesCollection(db).updateOne(
      { companyId: companyObjectId },
      {
        $set: {
          steps,
          updatedAt: new Date(),
          updatedBy: getSessionActor(session),
        },
      },
    );

    const migration = await migrateOpenAuftraegeForTemplate(db, companyObjectId, steps);
    await emitCompanyRealtimeEvent(String(session.activeCompanyId), "auftrag-pipeline:updated", {
      companyId: String(session.activeCompanyId),
      migratedAuftraege: migration.modified,
    });

    return jsonResponse(origin, { ok: true, steps }, 200);
  } catch (error: any) {
    console.error("PUT AUFTRAG PIPELINE ERROR:", error);
    return jsonResponse(origin, { ok: false, message: error?.message || "Unknown error" }, 500);
  }
}
