import { getDb } from "@/lib/db";
import { getCorsHeaders } from "@/lib/cors";
import { readSession, safeString } from "@/lib/api-session";
import { enforceActiveSubscription } from "@/lib/subscription";
import { buildSignatureAuditEntry, canManageOrderSignatures, ensureOrderSignatureIndexes, normalizeSignatureFields } from "@/lib/orderSignatures";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function response(origin: string | null, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...getCorsHeaders(origin) } });
}

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: getCorsHeaders(req.headers.get("origin")) });
}

export async function POST(req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const origin = req.headers.get("origin");
  const secret = process.env.SESSION_SECRET;
  if (!secret) return response(origin, { ok: false, message: "SESSION_SECRET fehlt." }, 500);
  const session = readSession(req, secret);
  if (!session?.activeCompanyId) return response(origin, { ok: false, message: "Nicht eingeloggt." }, 401);
  if (!canManageOrderSignatures(session)) return response(origin, { ok: false, message: "Keine Berechtigung." }, 403);
  const { orderId } = await params;
  const normalizedOrderId = safeString(orderId);
  try {
    const db = await getDb();
    const subscriptionError = await enforceActiveSubscription(db, origin, session);
    if (subscriptionError) return subscriptionError;
    await ensureOrderSignatureIndexes(db);
    const planning = await db.collection<any>("plannings").findOne({ companyId: String(session.activeCompanyId), orderId: normalizedOrderId });
    if (!planning) return response(origin, { ok: false, message: "Auftrag nicht gefunden." }, 404);
    if (safeString(planning?.signatureStatus) === "signed") {
      return response(origin, { ok: false, message: "Ein unterschriebener Auftrag kann nicht widerrufen werden." }, 409);
    }
    const now = new Date();
    await db.collection<any>("plannings").updateOne(
      { _id: planning._id },
      {
        $set: { signatureToken: null, signatureTokenHash: null, signatureStatus: "none", updatedAt: now },
        $push: {
          signatureAudit: buildSignatureAuditEntry({ event: "revoked", req, at: now }) as never,
        },
      },
    );
    const updated = await db.collection<any>("plannings").findOne({ _id: planning._id });
    return response(origin, { ok: true, signature: normalizeSignatureFields(updated) }, 200);
  } catch (error) {
    console.error("SIGNATURE CANCEL ERROR:", error);
    return response(origin, { ok: false, message: "Signaturanfrage konnte nicht widerrufen werden." }, 500);
  }
}
