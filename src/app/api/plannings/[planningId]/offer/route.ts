import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db";
import { getCorsHeaders } from "@/lib/cors";
import { enforceActiveSubscription } from "@/lib/subscription";
import { buildPlanningDocumentPdf, resolveDocumentType } from "@/lib/planningDocuments";
import { readSession, safeString } from "@/lib/api-session";

export const runtime = "nodejs";

function jsonError(origin: string | null, message: string, status: number) {
  return new Response(JSON.stringify({ ok: false, message, error: message }), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...getCorsHeaders(origin),
    },
  });
}

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(origin),
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ planningId: string }> },
) {
  const origin = req.headers.get("origin");
  const secret = process.env.SESSION_SECRET;

  if (!secret) {
    return jsonError(origin, "SESSION_SECRET fehlt.", 500);
  }

  const session = readSession(req, secret);
  if (!session?.activeCompanyId) {
    return jsonError(origin, "Nicht eingeloggt.", 401);
  }

  const { planningId } = await params;
  if (!ObjectId.isValid(planningId)) {
    return jsonError(origin, "Ungültige Planning-ID.", 400);
  }

  const body = await req.json().catch(() => ({} as any));
  const requestUrl = new URL(req.url);
  const requestedDocumentType =
    safeString(requestUrl.searchParams.get("documentType")) || body?.documentType;

  try {
    const db = await getDb();
    const subscriptionError = await enforceActiveSubscription(db, origin, session);
    if (subscriptionError) return subscriptionError;

    const planning = await db.collection("plannings").findOne({
      _id: new ObjectId(planningId),
      companyId: String(session.activeCompanyId),
    });

    if (!planning) {
      return jsonError(origin, "Planung nicht gefunden.", 404);
    }

    const company = await db.collection("companies").findOne({
      _id: new ObjectId(String(session.activeCompanyId)),
    });

    const documentType = resolveDocumentType(planning, requestedDocumentType);
    const orderId =
      documentType === "auftrag"
        ? safeString(body?.orderId) || safeString((planning as any)?.orderId)
        : null;
    const orderGeneratedAt =
      documentType === "auftrag"
        ? body?.orderGeneratedAt ?? (planning as any)?.orderGeneratedAt ?? new Date()
        : null;

    const { pdfBytes, fileName } = await buildPlanningDocumentPdf({
      db,
      planning,
      company,
      session,
      documentType,
      orderId,
      orderGeneratedAt,
    });

    return new Response(pdfBytes, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${fileName}"`,
        "Cache-Control": "no-store",
        ...getCorsHeaders(origin),
      },
    });
  } catch (e: any) {
    console.error("OFFER DOCUMENT ERROR:", e);
    return jsonError(origin, "PDF konnte nicht erstellt werden.", 500);
  }
}
